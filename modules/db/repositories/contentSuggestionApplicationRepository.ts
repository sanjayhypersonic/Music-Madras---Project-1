import { prisma } from "../client";
import { writeAuditLog } from "../../audit/writeAuditLog";
import { getApplicableTargetField, resolveContentToApply } from "../../mmke/contentIntelligence/applyContentSuggestionRules";
import type { RecordingEditorialTargetField } from "../../mmke/contentIntelligence/recordingEditorialTargetFields";
import type { ApplyContentSuggestionRefusal } from "../../mmke/contentIntelligence/applyContentSuggestionRefusal";
import { checkContentSuggestionFreshness } from "./contentSuggestionRepository";
import {
  RecordingBusyError,
  RevisionNotEditableError,
  forkDraftFromPublished,
  updateDraftRevisionContent,
  withRecordingEditLock,
} from "./recordingRepository";
import type { RecordingRevision } from "@prisma/client";

// Phase 6I-2 — the editorial application boundary
// (docs/content-intelligence-architecture.md, Phase 6I-2 section):
//
//   APPROVED ContentSuggestion -> targetField + (finalContent ?? proposedContent)
//     -> the Recording's DRAFT revision -> normal review/publish lifecycle
//
// This is the ONLY place AI-originated text is written into a Recording, and
// it never publishes. It reuses the existing revision machinery — the
// existing draft is edited with updateDraftRevisionContent, and a missing
// draft is created with forkDraftFromPublished — and writes exactly ONE
// whitelisted RecordingRevision column per suggestion. Approval and
// application are deliberately separate: APPROVED means "a human accepted
// this wording"; applying is a second, explicit action by someone allowed to
// edit the Recording.
//
// It never calls an AI provider, never retrieves external sources, and never
// regenerates anything. It refuses (never silently proceeds) when the
// suggestion's context is no longer current.
//
// "Applied" state is NOT a schema column (no migration was needed or made):
// it is derived from the append-only CONTENT_SUGGESTION_APPLIED audit entry,
// written in the same transaction as the edit and checked under a lock, so
// duplicate application is impossible even under concurrency. If applied
// state ever needs to be filtered/queried (e.g. an operational queue), an
// explicit `appliedAt` column is the natural future addition.

export type ApplyContentSuggestionResult =
  | {
      ok: true;
      suggestionId: string;
      recordingId: string;
      recordingRevisionId: string;
      targetField: RecordingEditorialTargetField;
      contentSource: "finalContent" | "proposedContent";
      /** True when no draft existed and one was created from the published revision. */
      forkedDraft: boolean;
    }
  | { ok: false; reason: ApplyContentSuggestionRefusal };

export { getApplicableTargetField, resolveContentToApply };

export interface ContentSuggestionApplication {
  appliedAt: Date;
  actorName: string | null;
  recordingRevisionId: string | null;
  contentSource: string | null;
  forkedDraft: boolean | null;
}

/** The recorded application of a suggestion, if any — the audit entry is the record. */
export async function findContentSuggestionApplication(suggestionId: string): Promise<ContentSuggestionApplication | null> {
  const entry = await prisma.auditLogEntry.findFirst({
    where: { entityType: "ContentSuggestion", entityId: suggestionId, action: "CONTENT_SUGGESTION_APPLIED" },
    include: { actor: { select: { name: true } } },
    orderBy: { timestamp: "asc" },
  });
  if (!entry) return null;
  const snapshot = (entry.afterSnapshot ?? {}) as { recordingRevisionId?: string; contentSource?: string; forkedDraft?: boolean };
  return {
    appliedAt: entry.timestamp,
    actorName: entry.actor?.name ?? null,
    recordingRevisionId: snapshot.recordingRevisionId ?? null,
    contentSource: snapshot.contentSource ?? null,
    forkedDraft: snapshot.forkedDraft ?? null,
  };
}

export async function applyApprovedContentSuggestion(input: { suggestionId: string; actorId: string }): Promise<ApplyContentSuggestionResult> {
  const suggestion = await prisma.contentSuggestion.findUnique({
    where: { id: input.suggestionId },
    include: { generationRequest: { select: { contextFingerprint: true } } },
  });
  if (!suggestion) return { ok: false, reason: "SUGGESTION_NOT_FOUND" };
  if (suggestion.status !== "APPROVED") return { ok: false, reason: "NOT_APPROVED" };

  const targetField = getApplicableTargetField(suggestion);
  if (!targetField) return { ok: false, reason: "UNSUPPORTED_TARGET" };

  const { content, contentSource } = resolveContentToApply(suggestion);
  if (content.trim().length === 0) return { ok: false, reason: "EMPTY_CONTENT" };

  // Checked before freshness: an already-applied suggestion is usually stale
  // too (the edit changed the context), and "already applied" is the truthful answer.
  if (await findContentSuggestionApplication(suggestion.id)) return { ok: false, reason: "ALREADY_APPLIED" };

  // The strict gate. Review-time freshness is only informational; APPLYING
  // stale AI text is refused outright. The refusal is audited but changes
  // nothing — the suggestion keeps its review state and is never regenerated.
  const freshness = await checkContentSuggestionFreshness(suggestion.id);
  if (freshness !== "CURRENT") {
    const reason = freshness === "STALE" ? "CONTENT_SUGGESTION_STALE" : "FRESHNESS_UNKNOWN";
    await writeAuditLog({
      actorId: input.actorId,
      action: "CONTENT_SUGGESTION_APPLY_REFUSED",
      entityType: "ContentSuggestion",
      entityId: suggestion.id,
      afterSnapshot: { reason, freshness, contextFingerprint: suggestion.generationRequest.contextFingerprint },
    });
    return { ok: false, reason };
  }

  const recordingId = suggestion.targetEntityId;

  // Phase 6J-10D: runs under withRecordingEditLock, the one implementation of the shared
  // `recording-edit:<id>` protocol (same lock key, same 30 s transaction, and the documented 5 s bounded
  // wait). Serializes every application against this Recording and against publish, archive, restore,
  // fork and content saves: two suggestions (or a double-click on one) cannot race to fork the same
  // published revision or both pass the already-applied check. fork and save below join this transaction.
  try {
    return await withRecordingEditLock(
      recordingId,
      async (tx): Promise<ApplyContentSuggestionResult> => {
        const current = await tx.contentSuggestion.findUnique({ where: { id: suggestion.id }, select: { status: true } });
        if (!current || current.status !== "APPROVED") return { ok: false, reason: "NOT_APPROVED" };

        const alreadyApplied = await tx.auditLogEntry.findFirst({
          where: { entityType: "ContentSuggestion", entityId: suggestion.id, action: "CONTENT_SUGGESTION_APPLIED" },
          select: { id: true },
        });
        if (alreadyApplied) return { ok: false, reason: "ALREADY_APPLIED" };

        const recording = await tx.recording.findUnique({ where: { id: recordingId }, include: { currentDraftRevision: true } });
        if (!recording) return { ok: false, reason: "RECORDING_NOT_FOUND" };
        if (recording.status === "ARCHIVED") return { ok: false, reason: "RECORDING_ARCHIVED" };

        let draft: RecordingRevision | null = recording.currentDraftRevision;
        let forkedDraft = false;
        if (!draft) {
          if (!recording.currentPublishedRevisionId) return { ok: false, reason: "NO_REVISION" };
          draft = await forkDraftFromPublished(recordingId, input.actorId, tx);
          forkedDraft = true;
        }

        const before = draft[targetField];
        await updateDraftRevisionContent(recordingId, draft.updatedAt, input.actorId, { [targetField]: content }, tx);

        await writeAuditLog(
          {
            actorId: input.actorId,
            action: "CONTENT_SUGGESTION_APPLIED",
            entityType: "ContentSuggestion",
            entityId: suggestion.id,
            afterSnapshot: {
              recordingId,
              recordingRevisionId: draft.id,
              targetField,
              contentSource,
              forkedDraft,
              contextFingerprint: suggestion.generationRequest.contextFingerprint,
            },
          },
          tx
        );
        // Also on the Recording's own history, with what was replaced, so an
        // editor reading the Recording's activity can see (and undo) the change.
        await writeAuditLog(
          {
            actorId: input.actorId,
            action: "RECORDING_DRAFT_CONTENT_APPLIED",
            entityType: "Recording",
            entityId: recordingId,
            beforeSnapshot: { [targetField]: before },
            afterSnapshot: { [targetField]: content, recordingRevisionId: draft.id, contentSuggestionId: suggestion.id, contentSource },
          },
          tx
        );

        return { ok: true, suggestionId: suggestion.id, recordingId, recordingRevisionId: draft.id, targetField, contentSource, forkedDraft };
      }
    );
  } catch (err) {
    // Lock contention is a typed, safe refusal (never a raw database error): nothing was changed.
    if (err instanceof RecordingBusyError) return { ok: false, reason: "BUSY" };
    // The shared helpers can refuse with a typed error if the Recording changed state outside the lock protocol;
    // the whole transaction has rolled back.
    if (err instanceof RevisionNotEditableError) {
      if (err.reason === "RECORDING_ARCHIVED") return { ok: false, reason: "RECORDING_ARCHIVED" };
      if (err.reason === "RECORDING_NOT_FOUND") return { ok: false, reason: "RECORDING_NOT_FOUND" };
      return { ok: false, reason: "NO_REVISION" };
    }
    throw err;
  }
}
