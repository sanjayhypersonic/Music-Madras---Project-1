import { prisma } from "../client";
import { writeAuditLog } from "../../audit/writeAuditLog";
import {
  isSupportedContentSuggestionEntityType,
  UnsupportedContentSuggestionEntityTypeError,
} from "../../mmke/contentIntelligence/contentSuggestionEntityType";
import { computeContextFingerprint } from "../../mmke/contentIntelligence/computeContextFingerprint";
import {
  deriveContentSuggestionFreshness,
  type ContentSuggestionFreshness,
} from "../../mmke/contentIntelligence/deriveContentSuggestionFreshness";
import {
  canApproveContentSuggestion,
  canRejectContentSuggestion,
  canRequestContentSuggestionChanges,
  canSubmitContentSuggestionForReview,
} from "../../publishing/contentSuggestionTransitions";
import { getRecordingContext } from "./recordingContextRepository";
import type { ContentSuggestionEvidenceRef } from "../../mmke/contentIntelligence/contentSuggestionEvidence";
import type {
  ContentGenerationRequest,
  ContentGenerationStatus,
  ContentSuggestion,
  ContentSuggestionReviewDecision,
  ContentSuggestionType,
} from "@prisma/client";
import type { Prisma } from "@prisma/client";

// Phase 6H-4 — Content Suggestion persistence (docs/content-intelligence-architecture.md,
// Phase 6H-2 §33/§37, Phase 6H-4 addendum). This is the ONLY file that
// touches the ContentGenerationRequest/ContentSuggestion Prisma tables
// (ADR §3 boundary rule).
//
// This repository never modifies a canonical MMKE entity (Composer, Work,
// Recording, RecordingRevision, Programme, Performance, Venue, Artist,
// Choir, Conductor, Organisation, Collection, LearningGuide, YouTubeVideo,
// or any provenance record) — every function here reads or writes ONLY
// ContentGenerationRequest/ContentSuggestion rows plus the audit log.
// Rejecting, approving, or editing a suggestion never touches the target
// entity: turning an APPROVED suggestion into an actual edit of the real
// editorial field is a deliberately separate, not-yet-built future action
// (docs/content-intelligence-architecture.md Phase 6H-2 §24).

export type CreateGenerationRequestInput = {
  targetEntityType: string;
  targetEntityId: string;
  suggestionType: ContentSuggestionType;
  contextFingerprint?: string | null;
  provider?: string | null;
  model?: string | null;
  promptVersion?: string | null;
  requestedById: string;
};

export async function createGenerationRequest(input: CreateGenerationRequestInput): Promise<ContentGenerationRequest> {
  if (!isSupportedContentSuggestionEntityType(input.targetEntityType)) {
    throw new UnsupportedContentSuggestionEntityTypeError(input.targetEntityType);
  }

  const request = await prisma.contentGenerationRequest.create({
    data: {
      targetEntityType: input.targetEntityType,
      targetEntityId: input.targetEntityId,
      suggestionType: input.suggestionType,
      contextFingerprint: input.contextFingerprint ?? null,
      provider: input.provider ?? null,
      model: input.model ?? null,
      promptVersion: input.promptVersion ?? null,
      requestedById: input.requestedById,
    },
  });

  await writeAuditLog({
    actorId: input.requestedById,
    action: "CONTENT_GENERATION_REQUESTED",
    entityType: "ContentGenerationRequest",
    entityId: request.id,
    afterSnapshot: request,
  });

  return request;
}

/** System-driven transition (no human actor) — PENDING -> GENERATING. */
export async function markGenerationRequestGenerating(id: string): Promise<ContentGenerationRequest> {
  const before = await prisma.contentGenerationRequest.findUnique({ where: { id } });
  if (!before) {
    throw new Error(`ContentGenerationRequest ${id} does not exist.`);
  }
  if (before.status !== "PENDING") {
    throw new Error(`ContentGenerationRequest ${id} is not PENDING (currently ${before.status}).`);
  }

  const updated = await prisma.contentGenerationRequest.update({ where: { id }, data: { status: "GENERATING" } });

  await writeAuditLog({
    actorId: null,
    action: "CONTENT_GENERATION_STARTED",
    entityType: "ContentGenerationRequest",
    entityId: id,
    beforeSnapshot: { status: before.status },
    afterSnapshot: { status: "GENERATING" },
  });

  return updated;
}

/** System-driven transition (no human actor) — GENERATING -> SUCCEEDED/FAILED. */
export async function completeGenerationRequest(
  id: string,
  outcome: { status: Extract<ContentGenerationStatus, "SUCCEEDED" | "FAILED">; errorDetails?: string | null }
): Promise<ContentGenerationRequest> {
  const before = await prisma.contentGenerationRequest.findUnique({ where: { id } });
  if (!before) {
    throw new Error(`ContentGenerationRequest ${id} does not exist.`);
  }

  const completedAt = new Date();
  const updated = await prisma.contentGenerationRequest.update({
    where: { id },
    data: { status: outcome.status, completedAt, errorDetails: outcome.errorDetails ?? null },
  });

  await writeAuditLog({
    actorId: null,
    action: outcome.status === "SUCCEEDED" ? "CONTENT_GENERATION_SUCCEEDED" : "CONTENT_GENERATION_FAILED",
    entityType: "ContentGenerationRequest",
    entityId: id,
    beforeSnapshot: { status: before.status },
    afterSnapshot: { status: outcome.status, errorDetails: outcome.errorDetails ?? null },
  });

  return updated;
}

export type CreateSuggestionInput = {
  generationRequestId: string;
  suggestionType: ContentSuggestionType;
  targetEntityType: string;
  targetEntityId: string;
  targetField?: string | null;
  /** Plain text for prose-shaped types; JSON.stringify the structured shape for INFORMATION_GAP (6H-2 §27). */
  proposedContent: string;
  evidenceRefs: ContentSuggestionEvidenceRef[];
};

/**
 * Creates a suggestion attributed to no human actor (the generation
 * itself is a system event) — the human act this phase can audit is the
 * earlier CONTENT_GENERATION_REQUESTED entry. Never writes to any
 * canonical MMKE table.
 */
export async function createSuggestion(input: CreateSuggestionInput): Promise<ContentSuggestion> {
  if (!isSupportedContentSuggestionEntityType(input.targetEntityType)) {
    throw new UnsupportedContentSuggestionEntityTypeError(input.targetEntityType);
  }

  const generationRequest = await prisma.contentGenerationRequest.findUnique({ where: { id: input.generationRequestId } });
  if (!generationRequest) {
    throw new Error(`ContentGenerationRequest ${input.generationRequestId} does not exist.`);
  }

  const suggestion = await prisma.contentSuggestion.create({
    data: {
      generationRequestId: input.generationRequestId,
      suggestionType: input.suggestionType,
      targetEntityType: input.targetEntityType,
      targetEntityId: input.targetEntityId,
      targetField: input.targetField ?? null,
      proposedContent: input.proposedContent,
      evidenceRefs: input.evidenceRefs as unknown as Prisma.InputJsonValue,
    },
  });

  await writeAuditLog({
    actorId: null,
    action: "CONTENT_SUGGESTION_CREATED",
    entityType: "ContentSuggestion",
    entityId: suggestion.id,
    afterSnapshot: suggestion,
  });

  return suggestion;
}

type ReviewTransitionTarget = "EDITOR_REVIEW" | "APPROVED" | "REJECTED" | "CHANGES_REQUESTED";

/**
 * Phase 6J-5 — a review transition the lifecycle (or a concurrent reviewer) refuses is audited and
 * reported, never silently dropped. The audit entry names the attempted target, the actual current
 * status and why, so an ambiguous editorial decision can always be reconstructed.
 */
async function refuseReviewTransition(
  suggestionId: string,
  statusSeen: ContentSuggestion["status"],
  target: ReviewTransitionTarget,
  actorId: string,
  reason: "INVALID_STATE" | "CONCURRENT_UPDATE",
  message: string
): Promise<never> {
  await writeAuditLog({
    actorId,
    action: "CONTENT_SUGGESTION_TRANSITION_REFUSED",
    entityType: "ContentSuggestion",
    entityId: suggestionId,
    beforeSnapshot: { status: statusSeen },
    afterSnapshot: { attempted: target, reason },
  });
  throw new Error(message);
}

/**
 * Phase 6J-5 — the review decision is an atomic compare-and-set on the status the reviewer saw: the
 * UPDATE only matches while the suggestion is still in that status, so of two reviewers acting on the
 * same state exactly one wins and the other is refused (and audited) — never two decisions, never a
 * last-write-wins overwrite of an approval by a rejection. No new column or infrastructure.
 */
async function transitionReviewStatus(
  before: ContentSuggestion,
  target: ReviewTransitionTarget,
  actorId: string,
  data: Prisma.ContentSuggestionUncheckedUpdateManyInput
): Promise<ContentSuggestion> {
  const result = await prisma.contentSuggestion.updateMany({
    where: { id: before.id, status: before.status },
    data: { ...data, status: target },
  });
  if (result.count !== 1) {
    const current = await prisma.contentSuggestion.findUnique({ where: { id: before.id }, select: { status: true } });
    return refuseReviewTransition(
      before.id,
      current?.status ?? before.status,
      target,
      actorId,
      "CONCURRENT_UPDATE",
      `ContentSuggestion ${before.id} was changed by someone else (now ${current?.status ?? "missing"}); it can no longer move to ${target}.`
    );
  }
  return prisma.contentSuggestion.findUniqueOrThrow({ where: { id: before.id } });
}

export async function submitSuggestionForReview(id: string, actorId: string): Promise<ContentSuggestion> {
  const before = await prisma.contentSuggestion.findUnique({ where: { id } });
  if (!before) {
    throw new Error(`ContentSuggestion ${id} does not exist.`);
  }
  if (!canSubmitContentSuggestionForReview(before.status)) {
    return refuseReviewTransition(id, before.status, "EDITOR_REVIEW", actorId, "INVALID_STATE", `ContentSuggestion ${id} cannot move to EDITOR_REVIEW from its current status (${before.status}).`);
  }

  const updated = await transitionReviewStatus(before, "EDITOR_REVIEW", actorId, {});

  await writeAuditLog({
    actorId,
    action: "CONTENT_SUGGESTION_SUBMITTED_FOR_REVIEW",
    entityType: "ContentSuggestion",
    entityId: id,
    beforeSnapshot: { status: before.status },
    afterSnapshot: { status: "EDITOR_REVIEW" },
  });

  return updated;
}

export type ApproveSuggestionInput = {
  /** The editor's own final wording — populated ONLY when they changed the proposal. `proposedContent` is never overwritten. */
  finalContent?: string | null;
  reviewNote?: string | null;
};

/**
 * Approval never touches the target entity — it only records that a human
 * accepted the proposal (or their edited version of it). Turning this into
 * an actual write on the real editorial field is a separate, not-yet-built
 * future action (6H-2 §24).
 */
export async function approveContentSuggestion(id: string, actorId: string, input: ApproveSuggestionInput = {}): Promise<ContentSuggestion> {
  const before = await prisma.contentSuggestion.findUnique({ where: { id } });
  if (!before) {
    throw new Error(`ContentSuggestion ${id} does not exist.`);
  }
  if (!canApproveContentSuggestion(before.status)) {
    return refuseReviewTransition(id, before.status, "APPROVED", actorId, "INVALID_STATE", `ContentSuggestion ${id} cannot be approved from its current status (${before.status}).`);
  }

  const hasEdit = Boolean(input.finalContent && input.finalContent.trim().length > 0);
  const reviewDecision: ContentSuggestionReviewDecision = hasEdit ? "EDIT_AND_ACCEPT" : "ACCEPT";
  const reviewedAt = new Date();

  const updated = await transitionReviewStatus(before, "APPROVED", actorId, {
    reviewDecision,
    reviewedById: actorId,
    reviewedAt,
    reviewNote: input.reviewNote ?? null,
    finalContent: hasEdit ? input.finalContent : null,
  });

  await writeAuditLog({
    actorId,
    action: "CONTENT_SUGGESTION_APPROVED",
    entityType: "ContentSuggestion",
    entityId: id,
    beforeSnapshot: { status: before.status },
    afterSnapshot: { status: "APPROVED", reviewDecision },
  });

  return updated;
}

export type RejectSuggestionReason = "UNSUPPORTED" | "INCORRECT" | "DUPLICATE" | "OTHER";

export async function rejectContentSuggestion(
  id: string,
  actorId: string,
  input: { reason: RejectSuggestionReason; reviewNote?: string | null }
): Promise<ContentSuggestion> {
  const before = await prisma.contentSuggestion.findUnique({ where: { id } });
  if (!before) {
    throw new Error(`ContentSuggestion ${id} does not exist.`);
  }
  if (!canRejectContentSuggestion(before.status)) {
    return refuseReviewTransition(id, before.status, "REJECTED", actorId, "INVALID_STATE", `ContentSuggestion ${id} cannot be rejected from its current status (${before.status}).`);
  }

  const reviewDecision = `REJECT_${input.reason}` as ContentSuggestionReviewDecision;
  const reviewedAt = new Date();

  const updated = await transitionReviewStatus(before, "REJECTED", actorId, {
    reviewDecision,
    reviewedById: actorId,
    reviewedAt,
    reviewNote: input.reviewNote ?? null,
  });

  await writeAuditLog({
    actorId,
    action: "CONTENT_SUGGESTION_REJECTED",
    entityType: "ContentSuggestion",
    entityId: id,
    beforeSnapshot: { status: before.status },
    afterSnapshot: { status: "REJECTED", reviewDecision },
  });

  return updated;
}

export async function requestContentSuggestionChanges(id: string, actorId: string, reviewNote: string): Promise<ContentSuggestion> {
  const before = await prisma.contentSuggestion.findUnique({ where: { id } });
  if (!before) {
    throw new Error(`ContentSuggestion ${id} does not exist.`);
  }
  if (!canRequestContentSuggestionChanges(before.status)) {
    return refuseReviewTransition(id, before.status, "CHANGES_REQUESTED", actorId, "INVALID_STATE", `ContentSuggestion ${id} cannot move to CHANGES_REQUESTED from its current status (${before.status}).`);
  }

  const updated = await transitionReviewStatus(before, "CHANGES_REQUESTED", actorId, {
    reviewedById: actorId,
    reviewedAt: new Date(),
    reviewNote,
  });

  await writeAuditLog({
    actorId,
    action: "CONTENT_SUGGESTION_CHANGES_REQUESTED",
    entityType: "ContentSuggestion",
    entityId: id,
    beforeSnapshot: { status: before.status },
    afterSnapshot: { status: "CHANGES_REQUESTED" },
  });

  return updated;
}

export function findContentSuggestionById(id: string) {
  return prisma.contentSuggestion.findUnique({
    where: { id },
    include: { generationRequest: { include: { requestedBy: true } }, reviewedBy: true },
  });
}

export function findGenerationRequestById(id: string) {
  return prisma.contentGenerationRequest.findUnique({ where: { id }, include: { requestedBy: true } });
}

/**
 * Phase 6H-6 — the duplicate-generation guard: is a generation already
 * in flight for this target? PENDING/GENERATING are the only non-terminal
 * statuses (modules/publishing's equivalent for ContentGenerationRequest is
 * simply "not SUCCEEDED and not FAILED" — there is no separate transitions
 * module for it since it has only one legal path). Used to refuse starting
 * a second generation while one is active, never to silently overwrite or
 * cancel it. A request stuck in GENERATING because its server process
 * crashed mid-call would block further generation for that target until an
 * operator manually completes it — an accepted, documented limitation
 * rather than building retry/timeout job infrastructure for it.
 */
export function findActiveGenerationRequestForEntity(targetEntityType: string, targetEntityId: string) {
  return prisma.contentGenerationRequest.findFirst({
    where: { targetEntityType, targetEntityId, status: { in: ["PENDING", "GENERATING"] } },
    orderBy: { requestedAt: "desc" },
  });
}

export interface ListContentSuggestionsFilters {
  status?: ContentSuggestion["status"];
  suggestionType?: ContentSuggestionType;
  targetEntityType?: string;
  targetEntityId?: string;
}

/** Studio-facing list (brief: "list / filter"). No pagination — MVP-scale volume, mirroring listRecordingsForStudio/listVideoPages. */
export function listContentSuggestionsForStudio(filters: ListContentSuggestionsFilters = {}) {
  return prisma.contentSuggestion.findMany({
    where: {
      status: filters.status,
      suggestionType: filters.suggestionType,
      targetEntityType: filters.targetEntityType,
      targetEntityId: filters.targetEntityId,
    },
    include: { generationRequest: { include: { requestedBy: true } }, reviewedBy: true },
    orderBy: { createdAt: "desc" },
  });
}

export type { ContentSuggestionFreshness };

/**
 * Re-assembles the CURRENT RecordingContext (Phase 6H-3) for the
 * suggestion's target and compares its fingerprint against the one stored
 * on the originating ContentGenerationRequest (6H-2 §31/§41). Never
 * mutates the suggestion, never triggers regeneration — purely informative.
 * UNKNOWN covers both "no fingerprint was ever recorded" and "the target
 * Recording is no longer available to re-assemble" (e.g. archived since).
 */
export async function checkContentSuggestionFreshness(suggestionId: string): Promise<ContentSuggestionFreshness> {
  const suggestion = await prisma.contentSuggestion.findUnique({
    where: { id: suggestionId },
    include: { generationRequest: true },
  });
  if (!suggestion || !suggestion.generationRequest.contextFingerprint) {
    return "UNKNOWN";
  }
  if (suggestion.targetEntityType !== "RECORDING") {
    return "UNKNOWN";
  }

  const currentContext = await getRecordingContext(suggestion.targetEntityId);
  return deriveContentSuggestionFreshness(
    suggestion.generationRequest.contextFingerprint,
    currentContext.ok ? computeContextFingerprint(currentContext.context) : null
  );
}
