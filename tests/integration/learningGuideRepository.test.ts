import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { prisma } from "../../modules/db/client";
import { SlugConflictError } from "../../modules/mmke/slug/SlugConflictError";
import {
  archiveLearningGuide,
  attachRecordingToLearningGuide,
  attachWorkToLearningGuide,
  createLearningGuide,
  detachRecordingFromLearningGuide,
  detachWorkFromLearningGuide,
  findLearningGuideById,
  findLearningGuideDetailForStudio,
  listLearningGuidesForStudio,
  publishLearningGuide,
  restoreLearningGuide,
  unpublishLearningGuide,
  updateLearningGuide,
} from "../../modules/db/repositories/learningGuideRepository";
import { createComposer } from "../../modules/db/repositories/composerRepository";
import { createMusicalWork } from "../../modules/db/repositories/musicalWorkRepository";
import { createDraftRecording } from "../../modules/db/repositories/recordingRepository";

// Phase 6G-16: proves the LearningGuide repository (schema already
// existed — see prisma/schema.prisma's LearningGuide/LearningGuideWork/
// LearningGuideRecording models — no migration needed) against the real
// database. Real DB, disposable test-prefixed fixtures only — mirrors the
// established pattern in tests/integration/occasionRepository.test.ts.

const TEST_TAG = "phase6g16";

function uniqueSlug(base: string): string {
  return `${TEST_TAG}-${base}-${randomUUID().slice(0, 8)}`;
}

function uniqueTitle(base: string): string {
  return `${base} ${randomUUID().slice(0, 8)}`;
}

async function createTestUser() {
  return prisma.studioUser.create({
    data: {
      id: randomUUID(),
      email: `${TEST_TAG}-${randomUUID().slice(0, 8)}@musicmadras.test`,
      name: "Phase 6G-16 Test User",
      role: "EDITOR",
      status: "ACTIVE",
    },
  });
}

async function cleanupLearningGuide(learningGuideId: string) {
  // LearningGuideWork/LearningGuideRecording rows cascade automatically
  // when the LearningGuide is deleted, but AuditLogEntry has no FK to
  // LearningGuide (entityId is a plain string) — must be removed
  // explicitly, exactly as cleanupOccasion does for Occasion.
  await prisma.auditLogEntry.deleteMany({ where: { entityType: "LearningGuide", entityId: learningGuideId } });
  await prisma.learningGuide.delete({ where: { id: learningGuideId } }).catch(() => {});
}

describe("LearningGuide CRUD against a real database", () => {
  let learningGuideId: string | null = null;
  let userId: string | null = null;

  afterEach(async () => {
    if (learningGuideId) {
      await cleanupLearningGuide(learningGuideId).catch(() => {});
      learningGuideId = null;
    }
    if (userId) {
      await prisma.studioUser.deleteMany({ where: { id: userId } });
      userId = null;
    }
  });

  it("creates a LearningGuide and audit-logs the creation", async () => {
    const user = await createTestUser();
    userId = user.id;

    const guide = await createLearningGuide({
      slug: uniqueSlug("messiah-guide"),
      title: uniqueTitle("Understanding Handel's Messiah"),
      difficultyLevel: "Beginner",
      contentMarkdown: "# Introduction\n\nMessiah is an oratorio...",
      estimatedReadingTimeMinutes: 8,
      actorId: user.id,
    });
    learningGuideId = guide.id;

    expect(guide.archivedAt).toBeNull();
    expect(guide.difficultyLevel).toBe("Beginner");
    expect(guide.estimatedReadingTimeMinutes).toBe(8);

    const audit = await prisma.auditLogEntry.findMany({
      where: { entityType: "LearningGuide", entityId: guide.id, action: "LEARNING_GUIDE_CREATED" },
    });
    expect(audit).toHaveLength(1);
  });

  it("allows two LearningGuides to share a similar title (not a controlled-vocabulary canonical entity)", async () => {
    const user = await createTestUser();
    userId = user.id;
    const title = uniqueTitle("Guided Listening");

    const first = await createLearningGuide({ slug: uniqueSlug("gl-1"), title, actorId: user.id });
    learningGuideId = first.id;

    const second = await createLearningGuide({ slug: uniqueSlug("gl-2"), title, actorId: user.id });
    try {
      expect(second.title).toBe(title);
      expect(second.id).not.toBe(first.id);
    } finally {
      await cleanupLearningGuide(second.id);
    }
  });

  it("rejects a colliding slug", async () => {
    const user = await createTestUser();
    userId = user.id;
    const slug = uniqueSlug("collision");

    const first = await createLearningGuide({ slug, title: uniqueTitle("First Guide"), actorId: user.id });
    learningGuideId = first.id;

    await expect(createLearningGuide({ slug, title: uniqueTitle("Second Guide"), actorId: user.id })).rejects.toThrow(SlugConflictError);
  });

  it("edits a LearningGuide's fields, keeping the slug stable, and audit-logs before/after", async () => {
    const user = await createTestUser();
    userId = user.id;
    const guide = await createLearningGuide({ slug: uniqueSlug("advent-guide"), title: uniqueTitle("Advent Guide"), actorId: user.id });
    learningGuideId = guide.id;

    const updated = await updateLearningGuide(guide.id, {
      title: "Renamed Guide",
      difficultyLevel: "Advanced",
      contentMarkdown: "Updated content.",
      estimatedReadingTimeMinutes: 15,
      actorId: user.id,
    });
    expect(updated.title).toBe("Renamed Guide");
    expect(updated.slug).toBe(guide.slug); // ordinary edits never regenerate the slug

    const audit = await prisma.auditLogEntry.findMany({
      where: { entityType: "LearningGuide", entityId: guide.id, action: "LEARNING_GUIDE_UPDATED" },
    });
    expect(audit).toHaveLength(1);
  });

  it("lists and searches LearningGuides for Studio, including archived ones", async () => {
    const user = await createTestUser();
    userId = user.id;
    const marker = randomUUID().slice(0, 8);
    const guide = await createLearningGuide({ slug: uniqueSlug("search"), title: `Searchable ${marker} Guide`, actorId: user.id });
    learningGuideId = guide.id;

    const found = await listLearningGuidesForStudio(marker);
    expect(found.map((g) => g.id)).toContain(guide.id);

    await archiveLearningGuide(guide.id, user.id);
    const foundAfterArchive = await listLearningGuidesForStudio(marker);
    expect(foundAfterArchive.map((g) => g.id)).toContain(guide.id); // Studio list includes archived
  });

  it("archives and restores a LearningGuide, audit-logging both, without deleting the record", async () => {
    const user = await createTestUser();
    userId = user.id;
    const guide = await createLearningGuide({ slug: uniqueSlug("goodfriday"), title: uniqueTitle("Good Friday Guide"), actorId: user.id });
    learningGuideId = guide.id;

    const archived = await archiveLearningGuide(guide.id, user.id);
    expect(archived.archivedAt).not.toBeNull();
    expect(await findLearningGuideById(guide.id)).not.toBeNull();

    const restored = await restoreLearningGuide(guide.id, user.id);
    expect(restored.archivedAt).toBeNull();

    const archiveAudit = await prisma.auditLogEntry.findMany({
      where: { entityType: "LearningGuide", entityId: guide.id, action: "LEARNING_GUIDE_ARCHIVED" },
    });
    const restoreAudit = await prisma.auditLogEntry.findMany({
      where: { entityType: "LearningGuide", entityId: guide.id, action: "LEARNING_GUIDE_RESTORED" },
    });
    expect(archiveAudit).toHaveLength(1);
    expect(restoreAudit).toHaveLength(1);
  });

  it("publishes and unpublishes a LearningGuide, audit-logging both", async () => {
    const user = await createTestUser();
    userId = user.id;
    const guide = await createLearningGuide({ slug: uniqueSlug("publish"), title: uniqueTitle("Publish Guide"), actorId: user.id });
    learningGuideId = guide.id;
    expect(guide.status).toBe("DRAFT");

    const published = await publishLearningGuide(guide.id, user.id);
    expect(published.status).toBe("PUBLISHED");

    const unpublished = await unpublishLearningGuide(guide.id, user.id);
    expect(unpublished.status).toBe("DRAFT");

    const publishAudit = await prisma.auditLogEntry.findMany({
      where: { entityType: "LearningGuide", entityId: guide.id, action: "LEARNING_GUIDE_PUBLISHED" },
    });
    const unpublishAudit = await prisma.auditLogEntry.findMany({
      where: { entityType: "LearningGuide", entityId: guide.id, action: "LEARNING_GUIDE_UNPUBLISHED" },
    });
    expect(publishAudit).toHaveLength(1);
    expect(unpublishAudit).toHaveLength(1);
  });

  it("keeps archive/restore and publish/unpublish fully orthogonal: archiving a published guide never unpublishes it, and restoring it never republishes it", async () => {
    const user = await createTestUser();
    userId = user.id;
    const guide = await createLearningGuide({ slug: uniqueSlug("orthogonal"), title: uniqueTitle("Orthogonal Guide"), actorId: user.id });
    learningGuideId = guide.id;

    await publishLearningGuide(guide.id, user.id);
    const archived = await archiveLearningGuide(guide.id, user.id);
    expect(archived.status).toBe("PUBLISHED"); // archiving never unpublishes
    expect(archived.archivedAt).not.toBeNull();

    const restored = await restoreLearningGuide(guide.id, user.id);
    expect(restored.status).toBe("PUBLISHED"); // restoring never re-publishes anything it didn't already have
    expect(restored.archivedAt).toBeNull();

    // The reverse: a DRAFT guide that gets archived then restored stays DRAFT.
    const draftGuide = await createLearningGuide({ slug: uniqueSlug("stays-draft"), title: uniqueTitle("Stays Draft Guide"), actorId: user.id });
    await archiveLearningGuide(draftGuide.id, user.id);
    const restoredDraft = await restoreLearningGuide(draftGuide.id, user.id);
    expect(restoredDraft.status).toBe("DRAFT");
    await cleanupLearningGuide(draftGuide.id);
  });
});

describe("LearningGuide canonical relationships (LearningGuideWork / LearningGuideRecording) against a real database", () => {
  let learningGuideId: string | null = null;
  let userId: string | null = null;
  let composerId: string | null = null;
  let musicalWorkId: string | null = null;
  let recordingId: string | null = null;

  afterEach(async () => {
    if (learningGuideId) {
      await cleanupLearningGuide(learningGuideId).catch(() => {});
      learningGuideId = null;
    }
    if (recordingId) {
      await prisma.auditLogEntry.deleteMany({ where: { entityType: "Recording", entityId: recordingId } });
      await prisma.recording.delete({ where: { id: recordingId } }).catch(() => {});
      recordingId = null;
    }
    if (musicalWorkId) {
      await prisma.auditLogEntry.deleteMany({ where: { entityType: "MusicalWork", entityId: musicalWorkId } });
      await prisma.musicalWork.delete({ where: { id: musicalWorkId } }).catch(() => {});
      musicalWorkId = null;
    }
    if (composerId) {
      await prisma.auditLogEntry.deleteMany({ where: { entityType: "Composer", entityId: composerId } });
      await prisma.composer.delete({ where: { id: composerId } }).catch(() => {});
      composerId = null;
    }
    if (userId) {
      await prisma.studioUser.deleteMany({ where: { id: userId } });
      userId = null;
    }
  });

  it("attaches a Work and a Recording to a LearningGuide by canonical ID, each audit-logged", async () => {
    const user = await createTestUser();
    userId = user.id;
    const guide = await createLearningGuide({ slug: uniqueSlug("messiah"), title: uniqueTitle("Understanding Messiah"), actorId: user.id });
    learningGuideId = guide.id;
    const composer = await createComposer({ slug: uniqueSlug("handel"), name: uniqueTitle("Handel"), actorId: user.id });
    composerId = composer.id;
    const work = await createMusicalWork({ slug: uniqueSlug("messiah-work"), title: "Messiah", composerId: composer.id, actorId: user.id });
    musicalWorkId = work.id;
    const recording = await createDraftRecording({ slug: uniqueSlug("messiah-recording"), actorId: user.id, title: "Messiah — Live" });
    recordingId = recording.id;

    await attachWorkToLearningGuide(guide.id, work.id, user.id);
    await attachRecordingToLearningGuide(guide.id, recording.id, user.id);

    const detail = await findLearningGuideDetailForStudio(guide.id);
    expect(detail?.workLinks.map((l) => l.musicalWorkId)).toEqual([work.id]);
    expect(detail?.recordingLinks.map((l) => l.recordingId)).toEqual([recording.id]);

    const workAudit = await prisma.auditLogEntry.findMany({
      where: { entityType: "LearningGuide", entityId: guide.id, action: "WORK_ADDED_TO_LEARNING_GUIDE" },
    });
    const recordingAudit = await prisma.auditLogEntry.findMany({
      where: { entityType: "LearningGuide", entityId: guide.id, action: "RECORDING_ADDED_TO_LEARNING_GUIDE" },
    });
    expect(workAudit).toHaveLength(1);
    expect(recordingAudit).toHaveLength(1);
  });

  it("treats attaching the same Work twice as a safe no-op, not an error", async () => {
    const user = await createTestUser();
    userId = user.id;
    const guide = await createLearningGuide({ slug: uniqueSlug("noop"), title: uniqueTitle("No-op Guide"), actorId: user.id });
    learningGuideId = guide.id;
    const composer = await createComposer({ slug: uniqueSlug("composer"), name: uniqueTitle("Composer"), actorId: user.id });
    composerId = composer.id;
    const work = await createMusicalWork({ slug: uniqueSlug("work"), title: "A Work", composerId: composer.id, actorId: user.id });
    musicalWorkId = work.id;

    await attachWorkToLearningGuide(guide.id, work.id, user.id);
    await expect(attachWorkToLearningGuide(guide.id, work.id, user.id)).resolves.toBeDefined();

    const detail = await findLearningGuideDetailForStudio(guide.id);
    expect(detail?.workLinks).toHaveLength(1);
  });

  it("detaches a Work and a Recording, each audit-logging it, without affecting the other", async () => {
    const user = await createTestUser();
    userId = user.id;
    const guide = await createLearningGuide({ slug: uniqueSlug("detach"), title: uniqueTitle("Detach Guide"), actorId: user.id });
    learningGuideId = guide.id;
    const composer = await createComposer({ slug: uniqueSlug("composer2"), name: uniqueTitle("Composer Two"), actorId: user.id });
    composerId = composer.id;
    const work = await createMusicalWork({ slug: uniqueSlug("work2"), title: "Another Work", composerId: composer.id, actorId: user.id });
    musicalWorkId = work.id;
    const recording = await createDraftRecording({ slug: uniqueSlug("recording2"), actorId: user.id, title: "Another Recording" });
    recordingId = recording.id;

    await attachWorkToLearningGuide(guide.id, work.id, user.id);
    await attachRecordingToLearningGuide(guide.id, recording.id, user.id);

    await detachWorkFromLearningGuide(guide.id, work.id, user.id);

    const detail = await findLearningGuideDetailForStudio(guide.id);
    expect(detail?.workLinks).toHaveLength(0);
    expect(detail?.recordingLinks.map((l) => l.recordingId)).toEqual([recording.id]); // unaffected

    const detachAudit = await prisma.auditLogEntry.findMany({
      where: { entityType: "LearningGuide", entityId: guide.id, action: "WORK_REMOVED_FROM_LEARNING_GUIDE" },
    });
    expect(detachAudit).toHaveLength(1);

    await detachRecordingFromLearningGuide(guide.id, recording.id, user.id);
    const detailAfter = await findLearningGuideDetailForStudio(guide.id);
    expect(detailAfter?.recordingLinks).toHaveLength(0);
  });

  it("rejects attaching a nonexistent Work (invalid relationship), never creating a dangling link", async () => {
    const user = await createTestUser();
    userId = user.id;
    const guide = await createLearningGuide({ slug: uniqueSlug("invalid"), title: uniqueTitle("Invalid Guide"), actorId: user.id });
    learningGuideId = guide.id;

    await expect(attachWorkToLearningGuide(guide.id, randomUUID(), user.id)).rejects.toThrow();

    const detail = await findLearningGuideDetailForStudio(guide.id);
    expect(detail?.workLinks).toHaveLength(0);
  });

  it("keeps an existing Work attachment intact and resolvable after the Work is later archived", async () => {
    const user = await createTestUser();
    userId = user.id;
    const guide = await createLearningGuide({ slug: uniqueSlug("archived-work"), title: uniqueTitle("Archived Work Guide"), actorId: user.id });
    learningGuideId = guide.id;
    const composer = await createComposer({ slug: uniqueSlug("composer3"), name: uniqueTitle("Composer Three"), actorId: user.id });
    composerId = composer.id;
    const work = await createMusicalWork({ slug: uniqueSlug("work3"), title: "Soon Archived Work", composerId: composer.id, actorId: user.id });
    musicalWorkId = work.id;

    await attachWorkToLearningGuide(guide.id, work.id, user.id);
    await prisma.musicalWork.update({ where: { id: work.id }, data: { archivedAt: new Date() } });

    const detail = await findLearningGuideDetailForStudio(guide.id);
    expect(detail?.workLinks).toHaveLength(1);
    expect(detail?.workLinks[0].musicalWork.archivedAt).not.toBeNull(); // historically resolvable, correctly flagged
  });
});
