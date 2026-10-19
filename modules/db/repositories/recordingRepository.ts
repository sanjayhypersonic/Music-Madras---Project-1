import { prisma } from "../client";
import { writeAuditLog } from "../../audit/writeAuditLog";
import { canForkNewDraft, canPublishCurrentDraft } from "../../publishing/revisionTransitions";
import { dedupeById } from "../../mmke/relationships/formatComposerCredit";
import { computeNextOrder } from "../../mmke/programme/reorderProgrammeItems";
import { isRecordingPublished } from "../../mmke/catalogue/isRecordingPublished";
import { SlugConflictError } from "../../mmke/slug/SlugConflictError";
import { isUniqueConstraintViolation } from "../isUniqueConstraintViolation";
import { createPerformance, type CreatePerformanceInput } from "./performanceRepository";
import {
  checkRecordingRevisionCompleteness,
  computeRecordingReadiness,
  isReadyToPublish,
  listMissingRequiredCategories,
  type CompletenessReportItem,
  type RecordingReadiness,
} from "../../mmke/completeness/checkRecordingRevisionCompleteness";
import { describeEditableDraftRefusal, type EditableDraftRefusal } from "../../publishing/editableDraftRefusal";
import type { PublishRefusalReason } from "../../publishing/publishRefusal";

export type { PublishRefusalReason };
import type { Prisma, Recording, RecordingRevision } from "@prisma/client";

// Recording / RecordingRevision repository — the mechanical core of the
// Draft & Revision model (ADR §5). This file implements the *mechanics*
// only: creating a draft, forking a new draft from a published revision,
// and publishing by moving the pointer. It deliberately does NOT implement
// completeness gating (modules/mmke/completeness — called by the Studio
// Server Action in a later phase), SEO/JSON-LD generation, or Next.js
// revalidation (ADR §10) — those belong to the Publishing workflow phase,
// not the database foundation.

export class ConcurrentEditError extends Error {
  constructor(recordingId: string) {
    super(
      `Recording ${recordingId} was edited by someone else since it was last loaded. ` +
        `Reload to see the latest draft before saving again.`
    );
    this.name = "ConcurrentEditError";
  }
}

// ---------------------------------------------------------------------------
// Phase 6J-10B — serializing the Recording lifecycle
// ---------------------------------------------------------------------------
//
// Publish, submit-for-review, unpublish, archive and restore all change Recording.status (and
// publish also moves the revision pointers). Each used to read the state, then write
// unconditionally, so two of them racing could produce a state neither would have chosen
// (a publish un-archiving an archived Recording, a late "submit" taking a live Recording
// offline, two publishes each writing a success audit entry).
//
// They now run in ONE transaction that first takes the per-Recording advisory lock
// `recording-edit:<id>` — the same key applyApprovedContentSuggestion already takes, so applying
// AI content, publishing and every lifecycle change for one Recording are serialized — and then
// re-reads the state, re-validates, and writes with conditional updates (updateMany with the
// expected state in the WHERE clause, count checked) so a stale decision can never overwrite a
// newer state. The success audit entry is written in the same transaction, so a failed or
// refused attempt leaves neither a state change nor a success audit entry.
//
// Lock ordering: exactly one lock (this one) is ever taken per transaction and nothing is taken
// while holding it, so these transactions cannot deadlock with each other or with apply. The wait
// is bounded: `lock_timeout` is set LOCAL to the transaction (default 5 s); on expiry the
// operation is refused with RecordingBusyError / reason "BUSY" and nothing has changed.
//
// NOT covered here (later phases): compare-and-swap for draft CONTENT saves, child-row writes
// (works/media/performance) and shared Performance edits do not take this lock.

export class RecordingBusyError extends Error {
  constructor(recordingId: string) {
    super(`Recording ${recordingId} is being changed by someone else right now. Try again in a moment.`);
    this.name = "RecordingBusyError";
  }
}

export const RECORDING_EDIT_LOCK_TIMEOUT_MS = 5000;

/** The advisory-lock key shared with applyApprovedContentSuggestion (hashtext of this string). */
export function recordingEditLockKey(recordingId: string): string {
  return `recording-edit:${recordingId}`;
}

function isLockTimeoutError(err: unknown, depth = 0): boolean {
  if (typeof err !== "object" || err === null || depth > 4) return false;
  const e = err as { message?: unknown; code?: unknown; meta?: { code?: unknown }; cause?: unknown };
  return (
    e.code === "55P03" ||
    e.meta?.code === "55P03" ||
    (typeof e.message === "string" && /lock timeout|55P03/i.test(e.message)) ||
    isLockTimeoutError(e.cause, depth + 1)
  );
}

/**
 * Runs `fn` inside a transaction that holds the per-Recording edit lock. Throws RecordingBusyError if the
 * lock cannot be taken within `lockTimeoutMs`. Everything `fn` reads after this point sees every change
 * committed by earlier holders of the lock.
 */
export async function withRecordingEditLock<T>(
  recordingId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  lockTimeoutMs: number = RECORDING_EDIT_LOCK_TIMEOUT_MS
): Promise<T> {
  try {
    return await prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT set_config('lock_timeout', ${`${Math.max(1, Math.floor(lockTimeoutMs))}ms`}, true)`;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${recordingEditLockKey(recordingId)}))`;
        return fn(tx);
      },
      { timeout: 30000, maxWait: 10000 }
    );
  } catch (err) {
    if (isLockTimeoutError(err)) throw new RecordingBusyError(recordingId);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Phase 6J-10C — revision-safe writes
// ---------------------------------------------------------------------------
//
// Two invariants are enforced HERE, at the repository boundary, for every caller (a Studio action, an AI
// application, a script, a test), not only by the Studio actions:
//
//  1. Draft CONTENT saves are a real compare-and-swap. updateDraftRevisionContent writes with ONE conditional
//     UPDATE whose WHERE clause carries the token the editor read (`updatedAt`), `revisionStatus = DRAFT` and
//     "this revision is still the current draft of a non-archived Recording"; the write advances the token to a
//     strictly greater value. Two writers holding the same token cannot both succeed: the second UPDATE waits
//     for the first to commit, re-evaluates its WHERE clause against the new row, matches nothing, and the
//     caller gets ConcurrentEditError. No advisory lock is taken, so saves for different Recordings (and
//     frequent autosaves) never serialize against each other. Publication holds the draft ROW lock for its
//     whole transaction (publishRecordingDraft), so a save can neither slip in between its completeness check
//     and the state change, nor land afterwards on the now-PUBLISHED revision (its WHERE no longer matches).
//
//  2. Child rows of a revision (works, media, rights on media) are only written to an EDITABLE draft: the
//     revision must be a DRAFT revision that is the Recording's current draft, on a non-archived Recording. The
//     check and the write happen in one transaction under the per-Recording edit lock from 6J-10B (same
//     lock as publish, apply and the lifecycle changes), so a child write is serialized with publication:
//     it either completes against the still-valid draft before the publication, or is refused after it, and
//     it can never change a published or superseded revision.
//
// Child writes do NOT advance the content token: they change rows the token does not protect, and bumping it
// would turn an unrelated attach into a false conflict for an editor typing in another step.

/** A write targeted a revision that is not (or is no longer) an editable draft. The message is safe to show. */
export class RevisionNotEditableError extends Error {
  constructor(readonly reason: EditableDraftRefusal) {
    super(describeEditableDraftRefusal(reason));
    this.name = "RevisionNotEditableError";
  }
}

type DbClient = Prisma.TransactionClient | typeof prisma;

/** Throws RevisionNotEditableError unless `revisionId` is a DRAFT revision that is the current draft of a non-archived Recording. */
async function assertEditableDraftRevision(client: DbClient, revisionId: string): Promise<string> {
  const revision = await client.recordingRevision.findUnique({
    where: { id: revisionId },
    select: { id: true, recordingId: true, revisionStatus: true, recording: { select: { status: true, currentDraftRevisionId: true } } },
  });
  if (!revision) throw new RevisionNotEditableError("STALE_REVISION");
  if (revision.recording.status === "ARCHIVED") throw new RevisionNotEditableError("RECORDING_ARCHIVED");
  if (revision.revisionStatus !== "DRAFT" || revision.recording.currentDraftRevisionId !== revision.id) throw new RevisionNotEditableError("STALE_REVISION");
  return revision.recordingId;
}

/**
 * Runs `fn` against an editable draft revision: inside a transaction holding the per-Recording edit lock, with the
 * revision's eligibility re-verified after the lock is taken. If the caller already owns a transaction (`client`),
 * eligibility is verified on it and the caller keeps responsibility for locking (used by Recording intake, where
 * the Recording was created in that same transaction).
 */
export async function withEditableDraftRevision<T>(
  revisionId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  client?: DbClient
): Promise<T> {
  if (client !== undefined && client !== prisma) {
    await assertEditableDraftRevision(client, revisionId);
    return fn(client as Prisma.TransactionClient);
  }
  const owner = await prisma.recordingRevision.findUnique({ where: { id: revisionId }, select: { recordingId: true } });
  if (!owner) throw new RevisionNotEditableError("STALE_REVISION");
  return withRecordingEditLock(owner.recordingId, async (tx) => {
    await assertEditableDraftRevision(tx, revisionId);
    return fn(tx);
  });
}

export interface CreateDraftRecordingInput {
  slug: string;
  actorId: string;
  title?: string;
  description?: string;
}

export interface RecordingWithRevisions extends Recording {
  currentDraftRevision: RecordingRevision | null;
  currentPublishedRevision: RecordingRevision | null;
}

/**
 * Creates a brand-new Recording identity plus its first DRAFT revision, in
 * one transaction. This is the entry point for both manual creation and
 * (in a later phase) YouTube-ingestion-created drafts — ADR §5.3, first
 * bullet.
 *
 * Phase 6G-5A: catches the slug @unique collision the same way
 * createComposer/createVenue/createProgramme/createCollection already do —
 * this was previously unguarded (a raw P2002 would have reached the
 * caller as an unhandled 500). Slug generation semantics are unchanged —
 * the caller still supplies the slug, and it remains immutable once set,
 * exactly as before.
 */
export async function createDraftRecording(
  input: CreateDraftRecordingInput,
  /**
   * Phase 6I-1 — optional: run inside a caller-owned transaction instead of
   * opening a new one, so a larger operation (recording intake from a synced
   * YouTube video) can create the draft, attach its media, and audit it
   * atomically using this same function rather than a second copy of its
   * logic. Omitted by every existing caller; behavior without it is unchanged.
   */
  client?: Prisma.TransactionClient
): Promise<RecordingWithRevisions> {
  const run = async (tx: Prisma.TransactionClient): Promise<RecordingWithRevisions> => {
    const recording = await tx.recording.create({
      data: {
        slug: input.slug,
        createdById: input.actorId,
        updatedById: input.actorId,
      },
    });

    const revision = await tx.recordingRevision.create({
      data: {
        recordingId: recording.id,
        revisionNumber: 1,
        revisionStatus: "DRAFT",
        title: input.title,
        description: input.description,
        createdById: input.actorId,
        updatedById: input.actorId,
      },
    });

    const updated = await tx.recording.update({
      where: { id: recording.id },
      data: { currentDraftRevisionId: revision.id },
    });

    await writeAuditLog(
      {
        actorId: input.actorId,
        action: "RECORDING_DRAFT_CREATED",
        entityType: "Recording",
        entityId: recording.id,
        afterSnapshot: { recording: updated, revision },
      },
      tx
    );

    return { ...updated, currentDraftRevision: revision, currentPublishedRevision: null };
  };

  try {
    return client ? await run(client) : await prisma.$transaction(run);
  } catch (err) {
    if (isUniqueConstraintViolation(err, "slug")) {
      throw new SlugConflictError(input.slug);
    }
    throw err;
  }
}

export type EditableDraftResolution =
  | { ok: true; recordingId: string; revisionId: string; revisionUpdatedAt: Date; performanceId: string | null }
  | { ok: false; reason: EditableDraftRefusal };

/**
 * Phase 6J-1 — the authoritative answer to "which revision may a Studio edit
 * to this Recording touch?". The server resolves it from the Recording id, so a
 * client-supplied revision id is never trusted on its own: it is only an
 * `expectedRevisionId` token proving the form was rendered for THIS draft.
 * Refused (never silently redirected to a different revision):
 *   - an unknown or ARCHIVED Recording
 *   - a Recording with no open draft (e.g. its draft was just published)
 *   - a revision that is not this Recording's current DRAFT: a stale one, an
 *     already-published or superseded one, or another Recording's revision
 * It does not weaken updateDraftRevisionContent's optimistic concurrency or the
 * advisory locks used by apply/intake — it is checked before them.
 */
export async function resolveEditableDraftRevision(recordingId: string, expectedRevisionId?: string): Promise<EditableDraftResolution> {
  const recording = await prisma.recording.findUnique({
    where: { id: recordingId },
    select: {
      id: true,
      status: true,
      currentDraftRevision: { select: { id: true, recordingId: true, revisionStatus: true, updatedAt: true, performanceId: true } },
    },
  });

  if (!recording) return { ok: false, reason: "RECORDING_NOT_FOUND" };
  if (recording.status === "ARCHIVED") return { ok: false, reason: "RECORDING_ARCHIVED" };

  const draft = recording.currentDraftRevision;
  if (!draft || draft.recordingId !== recording.id || draft.revisionStatus !== "DRAFT") return { ok: false, reason: "NO_OPEN_DRAFT" };
  if (expectedRevisionId !== undefined && expectedRevisionId !== draft.id) return { ok: false, reason: "STALE_REVISION" };

  return { ok: true, recordingId: recording.id, revisionId: draft.id, revisionUpdatedAt: draft.updatedAt, performanceId: draft.performanceId };
}

/**
 * Updates fields on the current draft revision as a DATABASE-ENFORCED compare-and-swap (ADR §5.4, hardened
 * in 6J-10C; serialized with the lifecycle operations in 6J-10D). The caller passes the token (`updatedAt`) it last read — and, from the Studio, the id of the
 * revision it rendered (`options.expectedRevisionId`). The write is ONE conditional UPDATE:
 *
 *   UPDATE recording_revisions SET <patch>, updatedAt = <strictly greater token>
 *    WHERE id = <draft> AND revisionStatus = 'DRAFT' AND updatedAt = <expected token>
 *      AND <draft> is the current draft of a Recording whose status is not ARCHIVED
 *
 * so the decision "is this still the revision/state the editor saw" and the write are the same statement.
 * When two writers hold the same token the second blocks on the first's row lock, re-evaluates the WHERE
 * clause after the first commits, matches zero rows and gets a ConcurrentEditError; it never overwrites. A
 * save that arrives after publication (the revision is no longer a DRAFT / no longer the current draft) also
 * matches nothing. The token is a millisecond timestamp, so it is advanced to max(now, expected + 1ms): it
 * can never repeat or move backwards, even for two saves inside the same millisecond (no ABA on `updatedAt`).
 *
 * Errors (all typed, all with editor-safe messages): ConcurrentEditError (stale token/revision, or the draft
 * changed state under the save), RecordingBusyError (the edit lock or the row lock could not be had within the
 * bounded wait), RevisionNotEditableError (reason RECORDING_NOT_FOUND / RECORDING_ARCHIVED / NO_OPEN_DRAFT).
 *
 * `client` is an optional caller-owned transaction (apply-approved-suggestion, intake); in that case the
 * caller owns locking and the write simply joins its transaction.
 */
export async function updateDraftRevisionContent(
  recordingId: string,
  expectedRevisionUpdatedAt: Date,
  actorId: string,
  patch: Partial<
    Pick<
      RecordingRevision,
      | "title"
      | "description"
      | "performanceId"
      | "seoMetaTitle"
      | "seoMetaDescription"
      | "seoCanonicalPath"
      | "educationalDifficultyLevel"
      | "educationalListeningGuide"
      | "educationalAnalysis"
    >
  >,
  /** Phase 6I-2 — optional caller-owned transaction (see createDraftRecording). Omitted by every existing caller. */
  client: Prisma.TransactionClient | typeof prisma = prisma,
  /** Phase 6J-10C — the revision the editor rendered; a different current draft is a conflict, not a redirect. */
  options: { expectedRevisionId?: string } = {}
): Promise<RecordingRevision> {
  const run = async (tx: Prisma.TransactionClient): Promise<RecordingRevision> => {
    const recording = await tx.recording.findUnique({
      where: { id: recordingId },
      select: { status: true, currentDraftRevisionId: true },
    });
    if (!recording) throw new RevisionNotEditableError("RECORDING_NOT_FOUND");
    if (recording.status === "ARCHIVED") throw new RevisionNotEditableError("RECORDING_ARCHIVED");
    if (!recording.currentDraftRevisionId) throw new RevisionNotEditableError("NO_OPEN_DRAFT");
    const draftId = recording.currentDraftRevisionId;
    if (options.expectedRevisionId !== undefined && options.expectedRevisionId !== draftId) {
      throw new ConcurrentEditError(recordingId);
    }

    const nextToken = new Date(Math.max(Date.now(), expectedRevisionUpdatedAt.getTime() + 1));
    const { count } = await tx.recordingRevision.updateMany({
      where: {
        id: draftId,
        revisionStatus: "DRAFT",
        updatedAt: expectedRevisionUpdatedAt,
        currentDraftOf: { is: { id: recordingId, status: { not: "ARCHIVED" } } },
      },
      data: { ...patch, updatedById: actorId, updatedAt: nextToken },
    });
    if (count !== 1) throw new ConcurrentEditError(recordingId);

    // The matched row stays locked until this transaction ends, so this reads exactly what was just written.
    return tx.recordingRevision.findUniqueOrThrow({ where: { id: draftId } });
  };

  // Phase 6J-10D: a save takes the SAME per-Recording edit lock as archive/restore/fork/publish and the child
  // writes, BEFORE it touches the draft row (advisory lock first, row lock second — the one order used everywhere).
  // A save therefore cannot interleave with a lifecycle change: it runs entirely before it or entirely after it,
  // and in the second case the first read below already sees ARCHIVED / no draft / a new draft. The CAS in the
  // UPDATE stays as the database-level backstop for everything the lock cannot see (a different writer, a token
  // that went stale). With a caller-owned transaction the caller holds the lock (apply-approved-suggestion).
  if (client !== prisma) return run(client as Prisma.TransactionClient);
  return withRecordingEditLock(recordingId, run);
}

/**
 * Creates a Performance and links it to the current draft in ONE transaction (6J-10C). The link is the same
 * compare-and-swap as every other content save, so a stale form (token mismatch, draft published or replaced
 * meanwhile) is refused with ConcurrentEditError and the Performance insert rolls back with it: no orphan
 * Performance row is left behind and no audit row claims it was created.
 */
export async function createPerformanceForDraft(
  recordingId: string,
  expectedRevisionId: string,
  expectedRevisionUpdatedAt: Date,
  input: CreatePerformanceInput
) {
  // Same lock protocol as every other draft write (6J-10D): edit lock first, then the draft row.
  return withRecordingEditLock(recordingId, async (tx) => {
    const performance = await createPerformance(input, tx);
    await updateDraftRevisionContent(
      recordingId,
      expectedRevisionUpdatedAt,
      input.actorId,
      { performanceId: performance.id },
      tx,
      { expectedRevisionId }
    );
    return performance;
  });
}

/**
 * Edit-after-publish (ADR §5.3, third bullet): forks a new DRAFT revision
 * as a copy of the currently published one, without altering what the
 * public Museum serves until the new draft is itself published.
 *
 * Phase 6I-2 — two corrections so that is actually true:
 * - The draft now carries forward the published revision's Works
 *   (RecordingRevisionWork) and MediaResources (including the PRIMARY_VIDEO's
 *   youtubeVideoId link). Previously only the revision's own columns were
 *   copied, so an edit-after-publish silently lost both and the draft could
 *   not pass the completeness gate (Works and Media are REQUIRED) until an
 *   editor re-attached them by hand. Rights links are shared, not duplicated.
 * - A Recording that is PUBLISHED stays PUBLISHED while its new draft is
 *   open, so the public page keeps serving the published revision (the public
 *   gate, isRecordingPublished, requires status PUBLISHED; the old
 *   unconditional IN_REVIEW took the live page offline for the whole edit).
 *   A Recording in any other status (e.g. DRAFT after unpublish/restore)
 *   still lands in IN_REVIEW exactly as before — forking never makes a
 *   non-public Recording public.
 *
 * Phase 6J-10D — safe against the other lifecycle operations. Without a caller transaction it runs under the
 * per-Recording edit lock (bounded wait, RecordingBusyError); inside the transaction it re-reads the Recording and
 * refuses an ARCHIVED one (RevisionNotEditableError RECORDING_ARCHIVED — nothing is created, no audit is written),
 * and the final pointer move is conditional (still no open draft, same status, not archived), so two forks, or a
 * fork racing archive/restore, can never create a second open draft or a draft on an archived Recording.
 *
 * `client` is optional: omitted by every pre-existing caller, supplied by
 * apply-approved-suggestion so the fork, the edit, and the audit are atomic. With a caller-owned transaction the
 * caller holds the edit lock (apply does).
 */
export async function forkDraftFromPublished(
  recordingId: string,
  actorId: string,
  client?: Prisma.TransactionClient
): Promise<RecordingRevision> {
  const run = async (tx: Prisma.TransactionClient): Promise<RecordingRevision> => {
    const recording = await tx.recording.findUnique({
      where: { id: recordingId },
      include: { currentPublishedRevision: true },
    });

    if (!recording) {
      throw new Error(`Recording ${recordingId} does not exist.`);
    }
    if (recording.status === "ARCHIVED") {
      throw new RevisionNotEditableError("RECORDING_ARCHIVED");
    }

    const hasOpenDraft = recording.currentDraftRevisionId !== null;
    const publishedRevision = recording.currentPublishedRevision;

    if (!canForkNewDraft({ hasOpenDraft, hasPublishedRevision: publishedRevision !== null })) {
      throw new Error(
        hasOpenDraft
          ? `Recording ${recordingId} already has an open draft revision; cannot fork a second one.`
          : `Recording ${recordingId} has no published revision to fork from.`
      );
    }
    if (!publishedRevision) {
      // Unreachable: canForkNewDraft already guarantees this, but needed
      // for TypeScript to narrow the type below.
      throw new Error(`Recording ${recordingId} has no published revision to fork from.`);
    }

    const published = publishedRevision;
    const latest = await tx.recordingRevision.findFirst({
      where: { recordingId },
      orderBy: { revisionNumber: "desc" },
    });
    const nextRevisionNumber = (latest?.revisionNumber ?? 0) + 1;

    const draft = await tx.recordingRevision.create({
      data: {
        recordingId,
        revisionNumber: nextRevisionNumber,
        revisionStatus: "DRAFT",
        title: published.title,
        description: published.description,
        performanceId: published.performanceId,
        seoMetaTitle: published.seoMetaTitle,
        seoMetaDescription: published.seoMetaDescription,
        seoCanonicalPath: published.seoCanonicalPath,
        educationalDifficultyLevel: published.educationalDifficultyLevel,
        educationalListeningGuide: published.educationalListeningGuide,
        educationalAnalysis: published.educationalAnalysis,
        createdById: actorId,
        updatedById: actorId,
      },
    });

    // Carry the published revision's relationships forward (Phase 6I-2).
    const publishedWorks = await tx.recordingRevisionWork.findMany({ where: { revisionId: published.id } });
    if (publishedWorks.length > 0) {
      await tx.recordingRevisionWork.createMany({
        data: publishedWorks.map((link) => ({
          revisionId: draft.id,
          musicalWorkId: link.musicalWorkId,
          order: link.order,
          catalogueNumberOverride: link.catalogueNumberOverride,
        })),
      });
    }

    const publishedMedia = await tx.mediaResource.findMany({ where: { recordingRevisionId: published.id } });
    if (publishedMedia.length > 0) {
      await tx.mediaResource.createMany({
        data: publishedMedia.map((media) => ({
          recordingRevisionId: draft.id,
          provider: media.provider,
          role: media.role,
          url: media.url,
          providerResourceId: media.providerResourceId,
          youtubeVideoId: media.youtubeVideoId,
          rightsInformationId: media.rightsInformationId,
        })),
      });
    }

    const pointed = await tx.recording.updateMany({
      where: { id: recordingId, currentDraftRevisionId: null, status: recording.status },
      data: {
        currentDraftRevisionId: draft.id,
        // A live Recording stays live while its new draft is edited; anything
        // else keeps the pre-existing "pending update" status.
        status: recording.status === "PUBLISHED" ? "PUBLISHED" : "IN_REVIEW",
      },
    });
    if (pointed.count !== 1) {
      // Rolls back the new revision, its copied works/media and everything else in this transaction.
      throw new Error(`Recording ${recordingId} changed while a new draft was being started. Reload and try again.`);
    }

    await writeAuditLog(
      {
        actorId,
        action: "RECORDING_DRAFT_FORKED_FROM_PUBLISHED",
        entityType: "Recording",
        entityId: recordingId,
        beforeSnapshot: { publishedRevisionId: published.id },
        afterSnapshot: {
          newDraftRevisionId: draft.id,
          copiedWorkCount: publishedWorks.length,
          copiedMediaCount: publishedMedia.length,
        },
      },
      tx
    );

    return draft;
  };

  return client ? run(client) : withRecordingEditLock(recordingId, run);
}

export type PublishRecordingResult =
  | { ok: true; recording: RecordingWithRevisions }
  | { ok: false; reason: PublishRefusalReason; /** Names of the REQUIRED completeness categories still missing (reason NOT_READY). */ missingCategories: string[] };

class PublishRefused extends Error {
  constructor(readonly reason: PublishRefusalReason, readonly missingCategories: string[] = []) {
    super(`Publication refused: ${reason}`);
    this.name = "PublishRefused";
  }
}

export interface PublishRecordingInput {
  recordingId: string;
  actorId: string;
  /** The draft revision the caller saw. If given and no longer current, the publish is refused (STALE_REVISION). */
  expectedDraftRevisionId?: string;
  /** Default true: the REQUIRED completeness categories are re-checked INSIDE the publishing transaction. */
  enforceCompleteness?: boolean;
  lockTimeoutMs?: number;
}

/**
 * Publishing by moving the pointer (ADR §5.3, second bullet; §5.5): the current draft revision becomes
 * PUBLISHED, any previously published revision becomes SUPERSEDED, Recording.currentPublishedRevisionId
 * moves, and the success audit entry is written — all in ONE transaction.
 *
 * Phase 6J-10B — atomic and race-safe. Inside the transaction, after taking the per-Recording edit lock
 * (see withRecordingEditLock) it re-reads and re-validates everything the publication depends on:
 *   - the Recording exists and is not ARCHIVED;
 *   - it has an open draft that is a DRAFT revision of this Recording, and (if the caller named one)
 *     that draft is still THE expected one;
 *   - the draft row is locked (FOR UPDATE) so no concurrent writer changes it between the completeness
 *     check and the state change, and the REQUIRED completeness categories still hold.
 * Every write is conditional (the expected state is in the WHERE clause and the row count is checked), so
 * a stale decision refuses and rolls back instead of overwriting newer state. A refused, stale or failed
 * attempt changes nothing — the currently published revision stays published — and writes no success audit.
 * The result is explicit; no database error reaches the caller.
 */
export async function publishRecordingDraft(input: PublishRecordingInput): Promise<PublishRecordingResult> {
  const { recordingId, actorId } = input;
  try {
    const recording = await withRecordingEditLock(
      recordingId,
      async (tx) => {
        const current = await tx.recording.findUnique({
          where: { id: recordingId },
          include: { currentDraftRevision: true, currentPublishedRevision: true },
        });
        if (!current) throw new PublishRefused("RECORDING_NOT_FOUND");
        if (current.status === "ARCHIVED") throw new PublishRefused("RECORDING_ARCHIVED");

        const draft = current.currentDraftRevision;
        if (!draft || !canPublishCurrentDraft({ hasOpenDraft: true }) || draft.recordingId !== current.id || draft.revisionStatus !== "DRAFT") {
          throw new PublishRefused("NO_OPEN_DRAFT");
        }
        if (input.expectedDraftRevisionId !== undefined && input.expectedDraftRevisionId !== draft.id) {
          throw new PublishRefused("STALE_REVISION");
        }

        // Hold the draft row for the rest of the transaction, then validate against what is committed NOW.
        await tx.$queryRaw`SELECT id FROM recording_revisions WHERE id = ${draft.id} FOR UPDATE`;
        if (input.enforceCompleteness !== false) {
          const completeness = await getRecordingRevisionCompletenessReport(draft.id, tx);
          if (!completeness || !isReadyToPublish(completeness.report)) {
            throw new PublishRefused("NOT_READY", completeness ? listMissingRequiredCategories(completeness.report).map((item) => item.category) : []);
          }
        }

        const previousPublished = current.currentPublishedRevision;

        const promoted = await tx.recordingRevision.updateMany({
          where: { id: draft.id, recordingId: current.id, revisionStatus: "DRAFT" },
          data: { revisionStatus: "PUBLISHED" },
        });
        if (promoted.count !== 1) throw new PublishRefused("STATE_CHANGED");

        if (previousPublished) {
          const superseded = await tx.recordingRevision.updateMany({
            where: { id: previousPublished.id, revisionStatus: "PUBLISHED" },
            data: { revisionStatus: "SUPERSEDED" },
          });
          if (superseded.count !== 1) throw new PublishRefused("STATE_CHANGED");
        }

        const moved = await tx.recording.updateMany({
          where: { id: current.id, currentDraftRevisionId: draft.id, status: { not: "ARCHIVED" } },
          data: { status: "PUBLISHED", currentPublishedRevisionId: draft.id, currentDraftRevisionId: null, updatedById: actorId },
        });
        if (moved.count !== 1) throw new PublishRefused("STATE_CHANGED");

        await writeAuditLog(
          {
            actorId,
            action: "RECORDING_PUBLISHED",
            entityType: "Recording",
            entityId: recordingId,
            beforeSnapshot: previousPublished ? { previousPublishedRevisionId: previousPublished.id } : null,
            afterSnapshot: { publishedRevisionId: draft.id },
          },
          tx
        );

        return tx.recording.findUniqueOrThrow({
          where: { id: recordingId },
          include: { currentDraftRevision: true, currentPublishedRevision: true },
        });
      },
      input.lockTimeoutMs
    );
    return { ok: true, recording };
  } catch (err) {
    if (err instanceof PublishRefused) return { ok: false, reason: err.reason, missingCategories: err.missingCategories };
    if (err instanceof RecordingBusyError) return { ok: false, reason: "BUSY", missingCategories: [] };
    // Unexpected: the transaction rolled back (the published revision is untouched). Log the class only — never the message or values.
    console.error(`[publish] unexpected failure while publishing recording ${recordingId}: ${err instanceof Error ? err.name : "unknown error"}`);
    return { ok: false, reason: "FAILED", missingCategories: [] };
  }
}

/**
 * The pointer-move mechanic without the completeness gate (the Studio action uses publishRecordingDraft,
 * which enforces completeness). Same atomic, race-safe core; throws on refusal, as it always has.
 */
export async function publishCurrentDraft(recordingId: string, actorId: string): Promise<RecordingWithRevisions> {
  const result = await publishRecordingDraft({ recordingId, actorId, enforceCompleteness: false });
  if (result.ok) return result.recording;
  if (result.reason === "RECORDING_ARCHIVED") throw new Error(`Recording ${recordingId} is archived. Restore it before publishing.`);
  if (result.reason === "NO_OPEN_DRAFT" || result.reason === "RECORDING_NOT_FOUND") throw new Error(`Recording ${recordingId} has no open draft revision to publish.`);
  if (result.reason === "BUSY") throw new RecordingBusyError(recordingId);
  throw new Error(`Recording ${recordingId} could not be published (${result.reason}).`);
}
export function findRecordingById(id: string): Promise<RecordingWithRevisions | null> {
  return prisma.recording.findUnique({
    where: { id },
    include: { currentDraftRevision: true, currentPublishedRevision: true },
  });
}

/**
 * Studio recordings list (Phase 4, brief §4/§22) — every recording with
 * enough of its current draft/published revision to render a list and
 * decide "needs attention," without each list row issuing its own query.
 */
export function listRecordingsForStudio(): Promise<RecordingWithRevisions[]> {
  return prisma.recording.findMany({
    include: { currentDraftRevision: true, currentPublishedRevision: true },
    orderBy: { updatedAt: "desc" },
  });
}

/**
 * Editorial submission (Phase 4, brief §5): moves a Recording that has
 * never been published out of plain DRAFT and into IN_REVIEW so an
 * Editor/Reviewer picks it up. Distinct from forkDraftFromPublished, which
 * sets the same aggregate status for a different reason (a published
 * recording gaining a pending update) — modules/publishing/editorialPhase
 * tells the two apart for display using hasPublishedRevision.
 */
export async function submitRecordingForReview(recordingId: string, actorId: string): Promise<Recording> {
  // Phase 6J-10B: serialized with publish and the other lifecycle changes (see withRecordingEditLock);
  // the state is re-read under the lock, the write is conditional, and the audit entry commits with it.
  return withRecordingEditLock(recordingId, async (tx) => {
    const recording = await tx.recording.findUnique({ where: { id: recordingId } });
    if (!recording) {
      throw new Error(`Recording ${recordingId} does not exist.`);
    }
    if (recording.status !== "DRAFT") {
      throw new Error(`Recording ${recordingId} is not in DRAFT status (currently ${recording.status}).`);
    }
    // Phase 6J-4: there must be a draft to review. A Recording that was unpublished has status DRAFT
    // but NO open draft revision (its last published version is kept as history); "submitting" it
    // would move it to IN_REVIEW with nothing in review. It must start a new draft first.
    if (recording.currentDraftRevisionId === null) {
      throw new Error(`Recording ${recordingId} has no open draft revision to submit for review. Start a new draft first.`);
    }

    const moved = await tx.recording.updateMany({
      where: { id: recordingId, status: "DRAFT", currentDraftRevisionId: { not: null } },
      data: { status: "IN_REVIEW", updatedById: actorId },
    });
    if (moved.count !== 1) {
      throw new Error(`Recording ${recordingId} changed while it was being submitted for review. Reload and try again.`);
    }

    await writeAuditLog({ actorId, action: "RECORDING_SUBMITTED_FOR_REVIEW", entityType: "Recording", entityId: recordingId }, tx);

    return tx.recording.findUniqueOrThrow({ where: { id: recordingId } });
  });
}

/**
 * Phase 6G-5A: deliberately does NOT clear currentPublishedRevisionId or
 * currentDraftRevisionId — the previously-published revision remains
 * intact as historical metadata, never deleted, never resurrected as a
 * separate copy. Public safety comes entirely from the read side:
 * isRecordingPublished requires `status === "PUBLISHED"`, so as soon as
 * status flips to ARCHIVED here, findPublishedRecordingBySlug and
 * resolveRelatedContent both stop returning this Recording, even though
 * currentPublishedRevisionId still points at real revision history.
 */
export async function archiveRecording(recordingId: string, actorId: string): Promise<Recording> {
  // Phase 6J-10B: serialized with publish (see withRecordingEditLock): an archive can no longer be
  // overwritten by a publish that read the Recording before it, and the audit entry commits with it.
  return withRecordingEditLock(recordingId, async (tx) => {
    const existing = await tx.recording.findUnique({ where: { id: recordingId } });
    if (!existing) {
      throw new Error(`Recording ${recordingId} does not exist.`);
    }
    // Phase 6J-1: idempotent — archiving an already-archived Recording (a double-click,
    // a replayed form) changes nothing and writes no second audit entry.
    if (existing.status === "ARCHIVED") {
      return existing;
    }

    const moved = await tx.recording.updateMany({
      where: { id: recordingId, status: { not: "ARCHIVED" } },
      data: { status: "ARCHIVED", updatedById: actorId },
    });
    if (moved.count !== 1) {
      throw new Error(`Recording ${recordingId} changed while it was being archived. Reload and try again.`);
    }

    await writeAuditLog({ actorId, action: "RECORDING_ARCHIVED", entityType: "Recording", entityId: recordingId }, tx);

    return tx.recording.findUniqueOrThrow({ where: { id: recordingId } });
  });
}

/**
 * Phase 6G-5A: restores an ARCHIVED Recording to a safe, non-public
 * editorial state — DRAFT, uniformly, regardless of what status it held
 * before archiving. Deliberately does NOT restore whatever status
 * preceded the archive (that would require either a schema field to
 * remember it, or reading application state out of the audit log, both
 * rejected as needlessly complex for what this needs to guarantee: a
 * predictable, always-non-public landing state). Never touches
 * currentPublishedRevisionId — if this Recording had a published
 * revision before archiving, that revision row is untouched and
 * canForkNewDraft (modules/publishing/revisionTransitions.ts) already
 * allows forking a new draft from it regardless of Recording.status, so
 * a future editor can still fork and republish without this function
 * doing anything special to enable that. Restoring never republishes —
 * publication remains a separate, intentional action via publishCurrentDraft.
 */
export async function restoreRecording(recordingId: string, actorId: string): Promise<Recording> {
  // Phase 6J-10B: serialized with publish; conditional write; audit in the same transaction.
  return withRecordingEditLock(recordingId, async (tx) => {
    const recording = await tx.recording.findUnique({ where: { id: recordingId } });
    if (!recording) {
      throw new Error(`Recording ${recordingId} does not exist.`);
    }
    if (recording.status !== "ARCHIVED") {
      throw new Error(`Recording ${recordingId} is not ARCHIVED (currently ${recording.status}).`);
    }

    const moved = await tx.recording.updateMany({
      where: { id: recordingId, status: "ARCHIVED" },
      data: { status: "DRAFT", updatedById: actorId },
    });
    if (moved.count !== 1) {
      throw new Error(`Recording ${recordingId} changed while it was being restored. Reload and try again.`);
    }

    await writeAuditLog({ actorId, action: "RECORDING_RESTORED", entityType: "Recording", entityId: recordingId }, tx);

    return tx.recording.findUniqueOrThrow({ where: { id: recordingId } });
  });
}

/**
 * Phase 6G-5A: makes a PUBLISHED Recording non-public without touching
 * revision history at all. The published RecordingRevision keeps
 * `revisionStatus: "PUBLISHED"` forever — isValidRevisionTransition
 * (modules/publishing/revisionTransitions.ts) explicitly forbids moving a
 * PUBLISHED revision back to DRAFT, and this function does not attempt
 * to; it only changes Recording.status, leaving currentPublishedRevisionId
 * untouched so the historical revision remains reachable exactly as
 * archiveRecording's history is. Lands on DRAFT, same landing state as
 * restoreRecording, for the same reason: a predictable, always-non-public
 * state a future editor can act on (fork a new draft, or edit directly if
 * one is still open) without this operation silently deciding what
 * happens next.
 */
export async function unpublishRecording(recordingId: string, actorId: string): Promise<Recording> {
  // Phase 6J-10B: serialized with publish; conditional write; audit in the same transaction.
  return withRecordingEditLock(recordingId, async (tx) => {
    const recording = await tx.recording.findUnique({ where: { id: recordingId } });
    if (!recording) {
      throw new Error(`Recording ${recordingId} does not exist.`);
    }
    if (recording.status !== "PUBLISHED") {
      throw new Error(`Recording ${recordingId} is not PUBLISHED (currently ${recording.status}).`);
    }

    const moved = await tx.recording.updateMany({
      where: { id: recordingId, status: "PUBLISHED" },
      data: { status: "DRAFT", updatedById: actorId },
    });
    if (moved.count !== 1) {
      throw new Error(`Recording ${recordingId} changed while it was being unpublished. Reload and try again.`);
    }

    await writeAuditLog({ actorId, action: "RECORDING_UNPUBLISHED", entityType: "Recording", entityId: recordingId }, tx);

    return tx.recording.findUniqueOrThrow({ where: { id: recordingId } });
  });
}

/**
 * Attaches a MusicalWork directly to a RecordingRevision (brief §4's
 * "Composer/Works" wizard step) — distinct from ProgrammeItem, which
 * orders works within a Programme's running order. This is "what this
 * specific recording features," which is also what
 * checkRecordingRevisionCompleteness's "Musical Works" category counts.
 */
export async function attachWorkToRevision(
  revisionId: string,
  musicalWorkId: string,
  actorId: string
) {
  // 6J-10C: eligibility (editable draft) is verified inside the same transaction as the write, under the
  // per-Recording edit lock, so this can never add a work to a published or superseded revision.
  return withEditableDraftRevision(revisionId, async (tx) => {
    const existingLinks = await tx.recordingRevisionWork.findMany({
      where: { revisionId },
      select: { musicalWorkId: true, order: true },
    });

    if (existingLinks.some((link) => link.musicalWorkId === musicalWorkId)) {
      throw new Error("This work is already attached to the recording.");
    }

    const link = await tx.recordingRevisionWork.create({
      data: {
        revisionId,
        musicalWorkId,
        order: computeNextOrder(existingLinks.map((l, index) => ({ id: String(index), order: l.order }))),
      },
    });

    await writeAuditLog(
      {
        actorId,
        action: "WORK_ATTACHED_TO_RECORDING_REVISION",
        entityType: "RecordingRevision",
        entityId: revisionId,
        afterSnapshot: { musicalWorkId },
      },
      tx
    );

    return link;
  });
}

export async function detachWorkFromRevision(
  revisionId: string,
  musicalWorkId: string,
  actorId: string
): Promise<void> {
  // 6J-10C: same protocol as attach — eligibility, delete and audit are one transaction under the edit lock.
  await withEditableDraftRevision(revisionId, async (tx) => {
    await tx.recordingRevisionWork.delete({
      where: { revisionId_musicalWorkId: { revisionId, musicalWorkId } },
    });

    await writeAuditLog(
      {
        actorId,
        action: "WORK_DETACHED_FROM_RECORDING_REVISION",
        entityType: "RecordingRevision",
        entityId: revisionId,
        beforeSnapshot: { musicalWorkId },
      },
      tx
    );
  });
}

/**
 * Public-facing lookup (ADR §5.5 / §9): the Museum reads ONLY through
 * currentPublishedRevisionId, never by querying revisions directly by
 * status, so there is exactly one unambiguous definition of "what's live."
 *
 * Phase 6G-5A: now gated by isRecordingPublished (modules/mmke/catalogue),
 * the same predicate entityRelationshipsRepository.ts's resolveRelatedContent
 * uses. Before this phase, this function only checked
 * `currentPublishedRevision` truthiness, which an ARCHIVED Recording still
 * satisfies (archiveRecording never clears the pointer — see its own
 * comment) — so an archived Recording would have been returned here as
 * "published" while resolveRelatedContent correctly excluded it. Both now
 * agree by construction.
 */
export async function findPublishedRecordingBySlug(
  slug: string
): Promise<{ recording: Recording; publishedRevision: RecordingRevision } | null> {
  const recording = await prisma.recording.findUnique({
    where: { slug },
    include: { currentPublishedRevision: true },
  });

  if (!recording?.currentPublishedRevision || !isRecordingPublished(recording)) {
    return null;
  }

  return { recording, publishedRevision: recording.currentPublishedRevision };
}

/**
 * Phase 6G-5B: the dedicated public-page data source for
 * /recordings/[slug] — loads the published revision's full canonical
 * context (works+composer, programme+items, performance+venue+
 * organisation+participants, media resources) in one query, gated by the
 * same isRecordingPublished predicate as findPublishedRecordingBySlug
 * above. Deliberately a fresh query rather than widening
 * getCanonicalContextForRevision (used by three existing Studio pages) —
 * this needs Venue.organisation, which those callers never asked for, and
 * this phase's boundary is explicitly "no Studio Recording redesign."
 * Never queries by status directly (ADR §5.5) — always through the
 * identity row's currentPublishedRevisionId pointer.
 */
export async function getPublishedRecordingContextBySlug(slug: string) {
  const recording = await prisma.recording.findUnique({
    where: { slug },
    include: {
      currentPublishedRevision: {
        include: {
          works: {
            include: { musicalWork: { include: { composer: true } } },
            orderBy: { order: "asc" },
          },
          mediaResources: { include: { youtubeVideo: true } },
          performance: {
            include: {
              venue: { include: { organisation: true } },
              programme: {
                // composer included so the public page can tell an archived Work/Composer
                // (omitted from the public programme) from an active one (Phase 6J-1).
                include: { items: { include: { musicalWork: { include: { composer: true } } }, orderBy: { order: "asc" } } },
              },
              performers: { include: { artist: true } },
              choirs: { include: { choir: true } },
              conductors: { include: { conductor: true } },
            },
          },
        },
      },
    },
  });

  if (!recording?.currentPublishedRevision || !isRecordingPublished(recording)) {
    return null;
  }

  return { recording, revision: recording.currentPublishedRevision };
}

// ---------------------------------------------------------------------------
// Relationship traversal (Phase 2, brief §3) — the canonical chain
// Recording -> [Works -> Composers] and Recording -> Performance ->
// [Programme -> ProgrammeItems -> Works, Venue, Performers/Choirs/Conductors].
// These are real Prisma queries, so they live here (modules/db), not in
// modules/mmke/relationships, which stays Prisma-free per the ADR §3
// boundary rule — see that directory's README for the distinction.
// ---------------------------------------------------------------------------

export async function getCanonicalContextForRevision(
  revisionId: string,
  /** Phase 6J-10B — optional caller-owned transaction, so publication can validate inside its own transaction. */
  client: Prisma.TransactionClient | typeof prisma = prisma
) {
  const revision = await client.recordingRevision.findUnique({
    where: { id: revisionId },
    include: {
      works: {
        include: { musicalWork: { include: { composer: true } } },
        orderBy: { order: "asc" },
      },
      performance: {
        include: {
          venue: true,
          programme: { include: { items: { include: { musicalWork: true }, orderBy: { order: "asc" } } } },
          performers: { include: { artist: true } },
          choirs: { include: { choir: true } },
          conductors: { include: { conductor: true } },
        },
      },
      mediaResources: { include: { youtubeVideo: true, rightsInformation: true } },
    },
  });

  if (!revision) {
    return null;
  }

  const directWorks = revision.works.map((link) => link.musicalWork);
  const composers = dedupeById(directWorks.map((work) => work.composer));

  return {
    revision,
    directWorks,
    composers,
    performance: revision.performance,
    venue: revision.performance?.venue ?? null,
    programme: revision.performance?.programme ?? null,
    performers: revision.performance?.performers.map((link) => link.artist) ?? [],
    choirs: revision.performance?.choirs.map((link) => link.choir) ?? [],
    conductors: revision.performance?.conductors.map((link) => link.conductor) ?? [],
    mediaResources: revision.mediaResources,
  };
}

export interface RecordingRevisionCompletenessReport {
  report: CompletenessReportItem[];
  readiness: RecordingReadiness;
}

/**
 * Loads a revision's canonical context and maps it into the pure
 * completeness checker's input shape (ADR §4, brief §13) — the Studio
 * wizard's Review & Publish step and the recording layout's status badge
 * both need exactly this, so it lives here once rather than duplicated at
 * each call site.
 */
export async function getRecordingRevisionCompletenessReport(
  revisionId: string,
  client: Prisma.TransactionClient | typeof prisma = prisma
): Promise<RecordingRevisionCompletenessReport | null> {
  const context = await getCanonicalContextForRevision(revisionId, client);
  if (!context) {
    return null;
  }

  const participantCount = context.performers.length + context.choirs.length + context.conductors.length;
  const hasPrimaryVideo = context.mediaResources.some((media) => media.role === "PRIMARY_VIDEO");

  const report = checkRecordingRevisionCompleteness({
    title: context.revision.title,
    linkedWorkCount: context.directWorks.length,
    hasPerformance: context.performance !== null,
    hasVenue: context.venue !== null,
    participantCount,
    hasPrimaryVideo,
    hasEducationalContent: Boolean(
      context.revision.educationalListeningGuide || context.revision.educationalAnalysis
    ),
    hasSeoMetaTitle: Boolean(context.revision.seoMetaTitle),
  });

  return { report, readiness: computeRecordingReadiness(report) };
}
