import { prisma } from "../client";
import { writeAuditLog } from "../../audit/writeAuditLog";
import type { Recording, RecordingRevision } from "@prisma/client";

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
 */
export async function createDraftRecording(
  input: CreateDraftRecordingInput
): Promise<RecordingWithRevisions> {
  const result = await prisma.$transaction(async (tx) => {
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
  });

  return result;
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
  >
): Promise<RecordingRevision> {
  const recording = await prisma.recording.findUnique({
    where: { id: recordingId },
    include: { currentDraftRevision: true },
  });

  if (!recording?.currentDraftRevision) {
    throw new Error(`Recording ${recordingId} has no open draft revision to update.`);
  }

  if (recording.currentDraftRevision.updatedAt.getTime() !== expectedRevisionUpdatedAt.getTime()) {
    throw new ConcurrentEditError(recordingId);
  }

  const updated = await prisma.recordingRevision.update({
    where: { id: recording.currentDraftRevision.id },
    data: { ...patch, updatedById: actorId },
  });

  return updated;
}

/**
 * Edit-after-publish (ADR §5.3, third bullet): forks a new DRAFT revision
 * as a copy of the currently published one, without altering what the
 * public Museum serves until the new draft is itself published.
 */
export async function forkDraftFromPublished(
  recordingId: string,
  actorId: string
): Promise<RecordingRevision> {
  return prisma.$transaction(async (tx) => {
    const recording = await tx.recording.findUnique({
      where: { id: recordingId },
      include: { currentPublishedRevision: true },
    });

    if (!recording) {
      throw new Error(`Recording ${recordingId} does not exist.`);
    }
    if (recording.currentDraftRevisionId) {
      throw new Error(
        `Recording ${recordingId} already has an open draft revision; cannot fork a second one.`
      );
    }
    if (!recording.currentPublishedRevision) {
      throw new Error(
        `Recording ${recordingId} has no published revision to fork from.`
      );
    }

    const published = recording.currentPublishedRevision;
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

    await tx.recording.update({
      where: { id: recordingId },
      data: { currentDraftRevisionId: draft.id, status: "IN_REVIEW" },
    });

    await writeAuditLog(
      {
        actorId,
        action: "RECORDING_DRAFT_FORKED_FROM_PUBLISHED",
        entityType: "Recording",
        entityId: recordingId,
        beforeSnapshot: { publishedRevisionId: published.id },
        afterSnapshot: { newDraftRevisionId: draft.id },
      },
      tx
    );

    return draft;
  });
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

    if (!recording?.currentDraftRevision) {
      throw new Error(`Recording ${recordingId} has no open draft revision to publish.`);
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
  });
}

export function findRecordingById(id: string): Promise<RecordingWithRevisions | null> {
  return prisma.recording.findUnique({
    where: { id },
    include: { currentDraftRevision: true, currentPublishedRevision: true },
  });
}

/**
 * Public-facing lookup (ADR §5.5 / §9): the Museum reads ONLY through
 * currentPublishedRevisionId, never by querying revisions directly by
 * status, so there is exactly one unambiguous definition of "what's live."
 */
export async function findPublishedRecordingBySlug(
  slug: string
): Promise<{ recording: Recording; publishedRevision: RecordingRevision } | null> {
  const recording = await prisma.recording.findUnique({
    where: { slug },
    include: { currentPublishedRevision: true },
  });

  if (!recording?.currentPublishedRevision) {
    return null;
  }

  return { recording, publishedRevision: recording.currentPublishedRevision };
}
