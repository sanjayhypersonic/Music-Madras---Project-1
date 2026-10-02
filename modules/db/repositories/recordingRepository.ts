import { prisma } from "../client";
import { writeAuditLog } from "../../audit/writeAuditLog";
import { canForkNewDraft, canPublishCurrentDraft } from "../../publishing/revisionTransitions";
import { dedupeById } from "../../mmke/relationships/formatComposerCredit";
import { computeNextOrder } from "../../mmke/programme/reorderProgrammeItems";
import { isRecordingPublished } from "../../mmke/catalogue/isRecordingPublished";
import { SlugConflictError } from "../../mmke/slug/SlugConflictError";
import { isUniqueConstraintViolation } from "../isUniqueConstraintViolation";
import {
  checkRecordingRevisionCompleteness,
  computeRecordingReadiness,
  type CompletenessReportItem,
  type RecordingReadiness,
} from "../../mmke/completeness/checkRecordingRevisionCompleteness";
import type { EditableDraftRefusal } from "../../publishing/editableDraftRefusal";
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
 * Updates fields on the current draft revision, guarded by optimistic
 * concurrency (ADR §5.4): the caller must pass the `updatedAt` value it
 * last read, or a ConcurrentEditError is thrown instead of silently
 * overwriting a concurrent edit.
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
  client: Prisma.TransactionClient | typeof prisma = prisma
): Promise<RecordingRevision> {
  const recording = await client.recording.findUnique({
    where: { id: recordingId },
    include: { currentDraftRevision: true },
  });

  if (!recording?.currentDraftRevision) {
    throw new Error(`Recording ${recordingId} has no open draft revision to update.`);
  }
  if (recording.status === "ARCHIVED") {
    throw new Error(`Recording ${recordingId} is archived and cannot be edited. Restore it first.`);
  }

  if (recording.currentDraftRevision.updatedAt.getTime() !== expectedRevisionUpdatedAt.getTime()) {
    throw new ConcurrentEditError(recordingId);
  }

  const updated = await client.recordingRevision.update({
    where: { id: recording.currentDraftRevision.id },
    data: { ...patch, updatedById: actorId },
  });

  return updated;
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
 * `client` is optional: omitted by every pre-existing caller, supplied by
 * apply-approved-suggestion so the fork, the edit, and the audit are atomic.
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

    await tx.recording.update({
      where: { id: recordingId },
      data: {
        currentDraftRevisionId: draft.id,
        // A live Recording stays live while its new draft is edited; anything
        // else keeps the pre-existing "pending update" status.
        status: recording.status === "PUBLISHED" ? "PUBLISHED" : "IN_REVIEW",
      },
    });

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

  return client ? run(client) : prisma.$transaction(run, { timeout: 30000, maxWait: 10000 });
}

/**
 * Publishing by moving the pointer (ADR §5.3, second bullet; §5.5): the
 * current draft revision becomes PUBLISHED, any previously published
 * revision becomes SUPERSEDED, and Recording.currentPublishedRevisionId is
 * updated. This is deliberately just the pointer-move mechanic — the
 * completeness gate (ADR §4) and Next.js revalidation call (ADR §10) are
 * the Publishing workflow phase's responsibility, invoked around this
 * function, not inside it.
 */
export async function publishCurrentDraft(
  recordingId: string,
  actorId: string
): Promise<RecordingWithRevisions> {
  return prisma.$transaction(async (tx) => {
    const recording = await tx.recording.findUnique({
      where: { id: recordingId },
      include: { currentDraftRevision: true, currentPublishedRevision: true },
    });

    if (!recording || !canPublishCurrentDraft({ hasOpenDraft: recording.currentDraftRevision !== null })) {
      throw new Error(`Recording ${recordingId} has no open draft revision to publish.`);
    }
    if (!recording.currentDraftRevision) {
      // Unreachable given the check above; needed for TypeScript narrowing.
      throw new Error(`Recording ${recordingId} has no open draft revision to publish.`);
    }
    // Phase 6J-1: publishing must never silently un-archive a Recording. An archived
    // Recording keeps any open draft (archive does not clear it); it must be restored
    // deliberately first, so restore stays the only way back from ARCHIVED.
    if (recording.status === "ARCHIVED") {
      throw new Error(`Recording ${recordingId} is archived. Restore it before publishing.`);
    }

    const draft = recording.currentDraftRevision;
    const previousPublished = recording.currentPublishedRevision;

    await tx.recordingRevision.update({
      where: { id: draft.id },
      data: { revisionStatus: "PUBLISHED" },
    });

    if (previousPublished) {
      await tx.recordingRevision.update({
        where: { id: previousPublished.id },
        data: { revisionStatus: "SUPERSEDED" },
      });
    }

    const updated = await tx.recording.update({
      where: { id: recordingId },
      data: {
        status: "PUBLISHED",
        currentPublishedRevisionId: draft.id,
        currentDraftRevisionId: null,
        updatedById: actorId,
      },
    });

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

    return {
      ...updated,
      currentDraftRevision: null,
      currentPublishedRevision: { ...draft, revisionStatus: "PUBLISHED" },
    };
  }, { timeout: 30000, maxWait: 10000 });
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
  const recording = await prisma.recording.findUnique({ where: { id: recordingId } });
  if (!recording) {
    throw new Error(`Recording ${recordingId} does not exist.`);
  }
  if (recording.status !== "DRAFT") {
    throw new Error(`Recording ${recordingId} is not in DRAFT status (currently ${recording.status}).`);
  }

  const updated = await prisma.recording.update({
    where: { id: recordingId },
    data: { status: "IN_REVIEW", updatedById: actorId },
  });

  await writeAuditLog({
    actorId,
    action: "RECORDING_SUBMITTED_FOR_REVIEW",
    entityType: "Recording",
    entityId: recordingId,
  });

  return updated;
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
  const existing = await prisma.recording.findUnique({ where: { id: recordingId } });
  if (!existing) {
    throw new Error(`Recording ${recordingId} does not exist.`);
  }
  // Phase 6J-1: idempotent — archiving an already-archived Recording (a double-click,
  // a replayed form) changes nothing and writes no second audit entry.
  if (existing.status === "ARCHIVED") {
    return existing;
  }

  const updated = await prisma.recording.update({
    where: { id: recordingId },
    data: { status: "ARCHIVED", updatedById: actorId },
  });

  await writeAuditLog({
    actorId,
    action: "RECORDING_ARCHIVED",
    entityType: "Recording",
    entityId: recordingId,
  });

  return updated;
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
  const recording = await prisma.recording.findUnique({ where: { id: recordingId } });
  if (!recording) {
    throw new Error(`Recording ${recordingId} does not exist.`);
  }
  if (recording.status !== "ARCHIVED") {
    throw new Error(`Recording ${recordingId} is not ARCHIVED (currently ${recording.status}).`);
  }

  const updated = await prisma.recording.update({
    where: { id: recordingId },
    data: { status: "DRAFT", updatedById: actorId },
  });

  await writeAuditLog({
    actorId,
    action: "RECORDING_RESTORED",
    entityType: "Recording",
    entityId: recordingId,
  });

  return updated;
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
  const recording = await prisma.recording.findUnique({ where: { id: recordingId } });
  if (!recording) {
    throw new Error(`Recording ${recordingId} does not exist.`);
  }
  if (recording.status !== "PUBLISHED") {
    throw new Error(`Recording ${recordingId} is not PUBLISHED (currently ${recording.status}).`);
  }

  const updated = await prisma.recording.update({
    where: { id: recordingId },
    data: { status: "DRAFT", updatedById: actorId },
  });

  await writeAuditLog({
    actorId,
    action: "RECORDING_UNPUBLISHED",
    entityType: "Recording",
    entityId: recordingId,
  });

  return updated;
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
  return prisma.$transaction(async (tx) => {
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
  await prisma.recordingRevisionWork.delete({
    where: { revisionId_musicalWorkId: { revisionId, musicalWorkId } },
  });

  await writeAuditLog({
    actorId,
    action: "WORK_DETACHED_FROM_RECORDING_REVISION",
    entityType: "RecordingRevision",
    entityId: revisionId,
    beforeSnapshot: { musicalWorkId },
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

export async function getCanonicalContextForRevision(revisionId: string) {
  const revision = await prisma.recordingRevision.findUnique({
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
  revisionId: string
): Promise<RecordingRevisionCompletenessReport | null> {
  const context = await getCanonicalContextForRevision(revisionId);
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
