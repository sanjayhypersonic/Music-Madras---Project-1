import { prisma } from "../client";
import { writeAuditLog } from "../../audit/writeAuditLog";
import { SlugConflictError } from "../../mmke/slug/SlugConflictError";
import { isUniqueConstraintViolation } from "../isUniqueConstraintViolation";
import type { LearningGuide, LearningGuideRecording, LearningGuideWork } from "@prisma/client";

// Repository foundation for LearningGuide (Phase 6G-16) — a structured
// editorial resource, following the Collection precedent rather than the
// Composer/Occasion one: like Collection, a LearningGuide's title is not a
// controlled-vocabulary canonical name (two guides may legitimately share
// a similar title, e.g. two different "Guided Listening" guides for
// different works), so no exact-normalized-duplicate-name guard is
// applied here — only the slug's own @unique constraint protects against
// collision, exactly as Collection's own createCollection does.
//
// LearningGuideWork/LearningGuideRecording are pre-existing schema (see
// prisma/schema.prisma's LearningGuide model, and ADR §4: "EducationalContent
// / LearningGuide — structured guide content with associatedWorkIds/
// associatedRecordingIds") — no migration was needed for this phase.
// Deliberately NOT using the generic EntityX polymorphic-join pattern
// (EntitySource/EntityRights/EntityOccasion/EntityEducationalContent):
// LearningGuide's relationships are pre-modeled as two dedicated
// composite-key join tables, one per canonical entity type it supports
// (MusicalWork, Recording) — extending to further entity types would be a
// new, unrequested schema decision, out of this phase's scope.

export interface CreateLearningGuideInput {
  slug: string;
  title: string;
  difficultyLevel?: string;
  contentMarkdown?: string;
  estimatedReadingTimeMinutes?: number;
  actorId: string;
}

export async function createLearningGuide(input: CreateLearningGuideInput): Promise<LearningGuide> {
  let guide: LearningGuide;
  try {
    guide = await prisma.learningGuide.create({
      data: {
        slug: input.slug,
        title: input.title,
        difficultyLevel: input.difficultyLevel,
        contentMarkdown: input.contentMarkdown,
        estimatedReadingTimeMinutes: input.estimatedReadingTimeMinutes,
        createdById: input.actorId,
        updatedById: input.actorId,
      },
    });
  } catch (err) {
    if (isUniqueConstraintViolation(err, "slug")) {
      throw new SlugConflictError(input.slug);
    }
    throw err;
  }

  await writeAuditLog({
    actorId: input.actorId,
    action: "LEARNING_GUIDE_CREATED",
    entityType: "LearningGuide",
    entityId: guide.id,
    afterSnapshot: guide,
  });

  return guide;
}

export function findLearningGuideById(id: string): Promise<LearningGuide | null> {
  return prisma.learningGuide.findUnique({ where: { id } });
}

export function findLearningGuideBySlug(slug: string): Promise<LearningGuide | null> {
  return prisma.learningGuide.findUnique({ where: { slug } });
}

export interface LearningGuideDetailForStudio extends LearningGuide {
  workLinks: (LearningGuideWork & { musicalWork: { id: string; title: string; archivedAt: Date | null } })[];
  recordingLinks: (LearningGuideRecording & {
    recording: {
      id: string;
      slug: string;
      status: string;
      currentPublishedRevision: { title: string | null } | null;
      currentDraftRevision: { title: string | null } | null;
    };
  })[];
}

export function findLearningGuideDetailForStudio(id: string): Promise<LearningGuideDetailForStudio | null> {
  return prisma.learningGuide.findUnique({
    where: { id },
    include: {
      workLinks: { include: { musicalWork: { select: { id: true, title: true, archivedAt: true } } } },
      recordingLinks: {
        include: {
          recording: {
            select: {
              id: true,
              slug: true,
              status: true,
              currentPublishedRevision: { select: { title: true } },
              currentDraftRevision: { select: { title: true } },
            },
          },
        },
      },
    },
  });
}

/**
 * Studio-facing list: every LearningGuide regardless of archived state,
 * with an optional case-insensitive title filter — mirrors
 * listOccasionsForStudio/listComposersForStudio exactly.
 */
export function listLearningGuidesForStudio(searchQuery?: string): Promise<LearningGuide[]> {
  return prisma.learningGuide.findMany({
    where: searchQuery ? { title: { contains: searchQuery, mode: "insensitive" } } : undefined,
    orderBy: { title: "asc" },
  });
}

export interface UpdateLearningGuideInput {
  title?: string;
  difficultyLevel?: string | null;
  contentMarkdown?: string | null;
  estimatedReadingTimeMinutes?: number | null;
  actorId: string;
}

/**
 * Edits the guide's own fields in place — deliberately never accepts
 * `slug` (kept immutable, mirroring updateComposer/updateOccasion), so an
 * ordinary title edit never silently regenerates a stable identity.
 */
export async function updateLearningGuide(id: string, input: UpdateLearningGuideInput): Promise<LearningGuide> {
  const before = await prisma.learningGuide.findUnique({ where: { id } });
  if (!before) {
    throw new Error(`LearningGuide ${id} does not exist.`);
  }

  const updated = await prisma.learningGuide.update({
    where: { id },
    data: {
      title: input.title,
      difficultyLevel: input.difficultyLevel,
      contentMarkdown: input.contentMarkdown,
      estimatedReadingTimeMinutes: input.estimatedReadingTimeMinutes,
      updatedById: input.actorId,
    },
  });

  await writeAuditLog({
    actorId: input.actorId,
    action: "LEARNING_GUIDE_UPDATED",
    entityType: "LearningGuide",
    entityId: id,
    beforeSnapshot: before,
    afterSnapshot: updated,
  });

  return updated;
}

/**
 * Archiving/restoring reuses the existing archivedAt convention every
 * other simple entity already has — never deletes the row, never touches
 * LearningGuideWork/LearningGuideRecording. This phase has no public
 * surface and no Draft/Published status field on LearningGuide, so
 * archive/restore is the entire lifecycle this foundation supports (brief
 * §5: "if the underlying model already contains publication state,
 * preserve it... do not create a public publishing surface" — the model
 * has no such state to preserve).
 */
export async function archiveLearningGuide(id: string, actorId: string): Promise<LearningGuide> {
  const guide = await prisma.learningGuide.update({
    where: { id },
    data: { archivedAt: new Date(), updatedById: actorId },
  });

  await writeAuditLog({
    actorId,
    action: "LEARNING_GUIDE_ARCHIVED",
    entityType: "LearningGuide",
    entityId: id,
  });

  return guide;
}

export async function restoreLearningGuide(id: string, actorId: string): Promise<LearningGuide> {
  const guide = await prisma.learningGuide.update({
    where: { id },
    data: { archivedAt: null, updatedById: actorId },
  });

  await writeAuditLog({
    actorId,
    action: "LEARNING_GUIDE_RESTORED",
    entityType: "LearningGuide",
    entityId: id,
  });

  return guide;
}

// ---------------------------------------------------------------------------
// Canonical relationships (LearningGuideWork / LearningGuideRecording) —
// mirrors addRecordingToCollection/addMusicalWorkToCollection exactly: an
// upsert against the composite primary key makes re-attaching the same
// entity a safe no-op rather than an error (brief §9), and there is no
// `order` column on either join table (unlike Collection's), so no
// reordering support is needed.
// ---------------------------------------------------------------------------

export async function attachWorkToLearningGuide(
  learningGuideId: string,
  musicalWorkId: string,
  actorId: string
): Promise<LearningGuideWork> {
  const link = await prisma.learningGuideWork.upsert({
    where: { learningGuideId_musicalWorkId: { learningGuideId, musicalWorkId } },
    create: { learningGuideId, musicalWorkId },
    update: {},
  });

  await writeAuditLog({
    actorId,
    action: "WORK_ADDED_TO_LEARNING_GUIDE",
    entityType: "LearningGuide",
    entityId: learningGuideId,
    afterSnapshot: { musicalWorkId },
  });

  return link;
}

export async function detachWorkFromLearningGuide(learningGuideId: string, musicalWorkId: string, actorId: string): Promise<void> {
  await prisma.learningGuideWork.delete({
    where: { learningGuideId_musicalWorkId: { learningGuideId, musicalWorkId } },
  });

  await writeAuditLog({
    actorId,
    action: "WORK_REMOVED_FROM_LEARNING_GUIDE",
    entityType: "LearningGuide",
    entityId: learningGuideId,
    beforeSnapshot: { musicalWorkId },
  });
}

export async function attachRecordingToLearningGuide(
  learningGuideId: string,
  recordingId: string,
  actorId: string
): Promise<LearningGuideRecording> {
  const link = await prisma.learningGuideRecording.upsert({
    where: { learningGuideId_recordingId: { learningGuideId, recordingId } },
    create: { learningGuideId, recordingId },
    update: {},
  });

  await writeAuditLog({
    actorId,
    action: "RECORDING_ADDED_TO_LEARNING_GUIDE",
    entityType: "LearningGuide",
    entityId: learningGuideId,
    afterSnapshot: { recordingId },
  });

  return link;
}

export async function detachRecordingFromLearningGuide(learningGuideId: string, recordingId: string, actorId: string): Promise<void> {
  await prisma.learningGuideRecording.delete({
    where: { learningGuideId_recordingId: { learningGuideId, recordingId } },
  });

  await writeAuditLog({
    actorId,
    action: "RECORDING_REMOVED_FROM_LEARNING_GUIDE",
    entityType: "LearningGuide",
    entityId: learningGuideId,
    beforeSnapshot: { recordingId },
  });
}
