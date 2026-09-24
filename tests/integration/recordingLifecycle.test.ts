import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { prisma } from "../../modules/db/client";
import { SlugConflictError } from "../../modules/mmke/slug/SlugConflictError";
import { createComposer } from "../../modules/db/repositories/composerRepository";
import { createMusicalWork } from "../../modules/db/repositories/musicalWorkRepository";
import { getComposerRelatedContent } from "../../modules/db/repositories/entityRelationshipsRepository";
import {
  archiveRecording,
  attachWorkToRevision,
  createDraftRecording,
  findPublishedRecordingBySlug,
  forkDraftFromPublished,
  publishCurrentDraft,
  restoreRecording,
  submitRecordingForReview,
  unpublishRecording,
} from "../../modules/db/repositories/recordingRepository";

// Phase 6G-5A: proves the hardened Recording lifecycle (slug collision,
// the single isRecordingPublished predicate, archive/unpublish/restore)
// against the real database, mirroring the established
// tests/integration/*.test.ts pattern exactly. Real DB, disposable
// test-prefixed fixtures only.

const TEST_TAG = "phase6g5a";
const TEST_EMAIL = `${TEST_TAG}-integration-test@musicmadras.test`;

function uniqueSlug(base: string): string {
  return `${TEST_TAG}-${base}-${randomUUID().slice(0, 8)}`;
}

async function createTestUser() {
  return prisma.studioUser.create({
    data: { id: randomUUID(), email: TEST_EMAIL, name: "Phase 6G-5A Test User", role: "EDITOR", status: "ACTIVE" },
  });
}

async function cleanupRecording(recordingId: string) {
  const revisions = await prisma.recordingRevision.findMany({ where: { recordingId }, select: { id: true } });
  const revisionIds = revisions.map((r) => r.id);
  await prisma.auditLogEntry.deleteMany({ where: { entityType: "Recording", entityId: recordingId } });
  if (revisionIds.length > 0) {
    await prisma.auditLogEntry.deleteMany({ where: { entityType: "RecordingRevision", entityId: { in: revisionIds } } });
  }
  await prisma.recording.delete({ where: { id: recordingId } }); // cascades RecordingRevision -> RecordingRevisionWork
}

async function cleanupWork(workId: string) {
  await prisma.auditLogEntry.deleteMany({ where: { entityType: "MusicalWork", entityId: workId } });
  await prisma.musicalWork.delete({ where: { id: workId } });
}

async function cleanupComposer(composerId: string) {
  await prisma.auditLogEntry.deleteMany({ where: { entityType: "Composer", entityId: composerId } });
  await prisma.composer.delete({ where: { id: composerId } });
}

describe("A. createDraftRecording against a real database", () => {
  let recordingId: string | null = null;
  let userId: string | null = null;

  afterEach(async () => {
    if (recordingId) {
      await cleanupRecording(recordingId).catch(() => {});
      recordingId = null;
    }
    if (userId) {
      await prisma.studioUser.deleteMany({ where: { id: userId } });
      userId = null;
    }
  });

  it("creates a Recording with a first DRAFT revision, audit-logged", async () => {
    const user = await createTestUser();
    userId = user.id;

    const recording = await createDraftRecording({ slug: uniqueSlug("recording"), actorId: user.id, title: "QA Recording" });
    recordingId = recording.id;

    expect(recording.status).toBe("DRAFT");
    expect(recording.currentDraftRevision?.revisionStatus).toBe("DRAFT");
    expect(recording.currentDraftRevision?.title).toBe("QA Recording");
    expect(recording.currentPublishedRevision).toBeNull();

    const audit = await prisma.auditLogEntry.findMany({ where: { entityType: "Recording", entityId: recording.id, action: "RECORDING_DRAFT_CREATED" } });
    expect(audit).toHaveLength(1);
  });

  it("rejects a colliding slug with the established SlugConflictError, not a raw Prisma error", async () => {
    const user = await createTestUser();
    userId = user.id;
    const collidingSlug = uniqueSlug("collision");

    const first = await createDraftRecording({ slug: collidingSlug, actorId: user.id });
    recordingId = first.id;

    await expect(createDraftRecording({ slug: collidingSlug, actorId: user.id })).rejects.toThrow(SlugConflictError);
  });
});

describe("B. forkDraftFromPublished against a real database", () => {
  let recordingId: string | null = null;
  let userId: string | null = null;

  afterEach(async () => {
    if (recordingId) {
      await cleanupRecording(recordingId).catch(() => {});
      recordingId = null;
    }
    if (userId) {
      await prisma.studioUser.deleteMany({ where: { id: userId } });
      userId = null;
    }
  });

  it("forks a new draft from a published Recording, copying the published content", async () => {
    const user = await createTestUser();
    userId = user.id;
    const draft = await createDraftRecording({ slug: uniqueSlug("recording"), actorId: user.id, title: "Original Title" });
    recordingId = draft.id;
    const published = await publishCurrentDraft(draft.id, user.id);
    const publishedRevisionId = published.currentPublishedRevision!.id;

    const forked = await forkDraftFromPublished(draft.id, user.id);
    expect(forked.revisionStatus).toBe("DRAFT");
    expect(forked.title).toBe("Original Title"); // copied content

    const afterFork = await prisma.recording.findUnique({ where: { id: draft.id }, include: { currentDraftRevision: true, currentPublishedRevision: true } });
    expect(afterFork?.status).toBe("IN_REVIEW");
    expect(afterFork?.currentDraftRevisionId).toBe(forked.id);

    // The published revision remains unchanged.
    const stillPublished = await prisma.recordingRevision.findUnique({ where: { id: publishedRevisionId } });
    expect(stillPublished?.revisionStatus).toBe("PUBLISHED");
    expect(stillPublished?.title).toBe("Original Title");
  });

  it("rejects forking a second draft while one is already open", async () => {
    const user = await createTestUser();
    userId = user.id;
    const draft = await createDraftRecording({ slug: uniqueSlug("recording"), actorId: user.id });
    recordingId = draft.id;
    await publishCurrentDraft(draft.id, user.id);
    await forkDraftFromPublished(draft.id, user.id);

    await expect(forkDraftFromPublished(draft.id, user.id)).rejects.toThrow();
  });

  it("rejects forking when there is no published revision to fork from", async () => {
    const user = await createTestUser();
    userId = user.id;
    const draft = await createDraftRecording({ slug: uniqueSlug("recording"), actorId: user.id });
    recordingId = draft.id;

    await expect(forkDraftFromPublished(draft.id, user.id)).rejects.toThrow();
  });
});

describe("C. submitRecordingForReview against a real database", () => {
  let recordingId: string | null = null;
  let userId: string | null = null;

  afterEach(async () => {
    if (recordingId) {
      await cleanupRecording(recordingId).catch(() => {});
      recordingId = null;
    }
    if (userId) {
      await prisma.studioUser.deleteMany({ where: { id: userId } });
      userId = null;
    }
  });

  it("submits a DRAFT Recording for review, audit-logged", async () => {
    const user = await createTestUser();
    userId = user.id;
    const draft = await createDraftRecording({ slug: uniqueSlug("recording"), actorId: user.id });
    recordingId = draft.id;

    const updated = await submitRecordingForReview(draft.id, user.id);
    expect(updated.status).toBe("IN_REVIEW");

    const audit = await prisma.auditLogEntry.findMany({ where: { entityType: "Recording", entityId: draft.id, action: "RECORDING_SUBMITTED_FOR_REVIEW" } });
    expect(audit).toHaveLength(1);
  });

  it("rejects submitting a Recording that is not in DRAFT status", async () => {
    const user = await createTestUser();
    userId = user.id;
    const draft = await createDraftRecording({ slug: uniqueSlug("recording"), actorId: user.id });
    recordingId = draft.id;
    await submitRecordingForReview(draft.id, user.id); // now IN_REVIEW

    await expect(submitRecordingForReview(draft.id, user.id)).rejects.toThrow();
  });
});

describe("D. publishCurrentDraft against a real database", () => {
  let recordingId: string | null = null;
  let userId: string | null = null;

  afterEach(async () => {
    if (recordingId) {
      await cleanupRecording(recordingId).catch(() => {});
      recordingId = null;
    }
    if (userId) {
      await prisma.studioUser.deleteMany({ where: { id: userId } });
      userId = null;
    }
  });

  it("publishes the current draft, superseding the previous published revision, audit-logged", async () => {
    const user = await createTestUser();
    userId = user.id;
    const draft = await createDraftRecording({ slug: uniqueSlug("recording"), actorId: user.id });
    recordingId = draft.id;

    const firstPublish = await publishCurrentDraft(draft.id, user.id);
    const firstRevisionId = firstPublish.currentPublishedRevision!.id;
    expect(firstPublish.status).toBe("PUBLISHED");
    expect(firstPublish.currentDraftRevisionId).toBeNull();
    expect(firstPublish.currentPublishedRevisionId).toBe(firstRevisionId);

    await forkDraftFromPublished(draft.id, user.id);
    const secondPublish = await publishCurrentDraft(draft.id, user.id);
    const secondRevisionId = secondPublish.currentPublishedRevision!.id;

    expect(secondPublish.status).toBe("PUBLISHED");
    expect(secondPublish.currentDraftRevisionId).toBeNull();
    expect(secondPublish.currentPublishedRevisionId).toBe(secondRevisionId);
    expect(secondRevisionId).not.toBe(firstRevisionId);

    const firstRevisionAfter = await prisma.recordingRevision.findUnique({ where: { id: firstRevisionId } });
    expect(firstRevisionAfter?.revisionStatus).toBe("SUPERSEDED");

    const audit = await prisma.auditLogEntry.findMany({ where: { entityType: "Recording", entityId: draft.id, action: "RECORDING_PUBLISHED" } });
    expect(audit).toHaveLength(2);
  });

  it("rejects publishing when there is no open draft", async () => {
    const user = await createTestUser();
    userId = user.id;
    const draft = await createDraftRecording({ slug: uniqueSlug("recording"), actorId: user.id });
    recordingId = draft.id;
    await publishCurrentDraft(draft.id, user.id); // clears the draft pointer

    await expect(publishCurrentDraft(draft.id, user.id)).rejects.toThrow();
  });
});

describe("Publication lifecycle (unpublish/archive/restore) and predicate consistency", () => {
  let recordingId: string | null = null;
  let workId: string | null = null;
  let composerId: string | null = null;
  let userId: string | null = null;

  afterEach(async () => {
    if (recordingId) {
      await cleanupRecording(recordingId).catch(() => {});
      recordingId = null;
    }
    if (workId) {
      await cleanupWork(workId).catch(() => {});
      workId = null;
    }
    if (composerId) {
      await cleanupComposer(composerId).catch(() => {});
      composerId = null;
    }
    if (userId) {
      await prisma.studioUser.deleteMany({ where: { id: userId } });
      userId = null;
    }
  });

  /** A published Recording, canonically linked to a Composer via a directly-attached MusicalWork, so getComposerRelatedContent (which wraps resolveRelatedContent) can be checked alongside findPublishedRecordingBySlug. */
  async function createPublishedRecordingLinkedToComposer(user: { id: string }) {
    const composer = await createComposer({ slug: uniqueSlug("composer"), name: "QA Composer", actorId: user.id });
    composerId = composer.id;
    const work = await createMusicalWork({ slug: uniqueSlug("work"), title: "QA Work", composerId: composer.id, actorId: user.id });
    workId = work.id;

    const draft = await createDraftRecording({ slug: uniqueSlug("recording"), actorId: user.id, title: "QA Recording" });
    recordingId = draft.id;
    await attachWorkToRevision(draft.currentDraftRevision!.id, work.id, user.id);
    const published = await publishCurrentDraft(draft.id, user.id);

    return { composer, work, recording: published };
  }

  /**
   * forkDraftFromPublished (unchanged by this phase, out of scope to
   * modify) only copies the published revision's title/description/
   * performance/SEO/educational fields — never its RecordingRevisionWork
   * rows. A caller that wants the fork to remain related to the same
   * canonical Work must re-attach it explicitly, exactly as a Studio
   * editor using the Works wizard step after forking would.
   */
  async function forkAndReattachWork(recordingId: string, workId: string, actorId: string) {
    const forked = await forkDraftFromPublished(recordingId, actorId);
    await attachWorkToRevision(forked.id, workId, actorId);
    return forked;
  }

  it("E. unpublish: a PUBLISHED Recording becomes non-public, preserving the historical published revision", async () => {
    const user = await createTestUser();
    userId = user.id;
    const { composer, recording } = await createPublishedRecordingLinkedToComposer(user);
    const publishedRevisionId = recording.currentPublishedRevision!.id;

    // Sanity: while published, both predicates agree it IS public.
    expect(await findPublishedRecordingBySlug(recording.slug)).not.toBeNull();
    expect((await getComposerRelatedContent(composer.id)).recordings.map((r) => r.id)).toContain(recording.id);

    const unpublished = await unpublishRecording(recording.id, user.id);
    expect(unpublished.status).toBe("DRAFT");
    expect(unpublished.currentPublishedRevisionId).toBe(publishedRevisionId); // history preserved, not cleared

    const revisionAfter = await prisma.recordingRevision.findUnique({ where: { id: publishedRevisionId } });
    expect(revisionAfter).not.toBeNull(); // historical revision still exists
    expect(revisionAfter?.revisionStatus).toBe("PUBLISHED"); // never mutated — the rule forbids PUBLISHED -> DRAFT on the revision itself

    expect(await findPublishedRecordingBySlug(recording.slug)).toBeNull();
    expect((await getComposerRelatedContent(composer.id)).recordings.map((r) => r.id)).not.toContain(recording.id);

    const audit = await prisma.auditLogEntry.findMany({ where: { entityType: "Recording", entityId: recording.id, action: "RECORDING_UNPUBLISHED" } });
    expect(audit).toHaveLength(1);
  });

  it("rejects unpublishing a Recording that is not PUBLISHED", async () => {
    const user = await createTestUser();
    userId = user.id;
    const draft = await createDraftRecording({ slug: uniqueSlug("recording"), actorId: user.id });
    recordingId = draft.id;

    await expect(unpublishRecording(draft.id, user.id)).rejects.toThrow();
  });

  it("F. archive: a PUBLISHED Recording becomes non-public, preserving the historical published revision", async () => {
    const user = await createTestUser();
    userId = user.id;
    const { composer, recording } = await createPublishedRecordingLinkedToComposer(user);
    const publishedRevisionId = recording.currentPublishedRevision!.id;

    const archived = await archiveRecording(recording.id, user.id);
    expect(archived.status).toBe("ARCHIVED");
    expect(archived.currentPublishedRevisionId).toBe(publishedRevisionId); // history preserved, not cleared

    const revisionAfter = await prisma.recordingRevision.findUnique({ where: { id: publishedRevisionId } });
    expect(revisionAfter).not.toBeNull();
    expect(revisionAfter?.revisionStatus).toBe("PUBLISHED");

    expect(await findPublishedRecordingBySlug(recording.slug)).toBeNull();
    expect((await getComposerRelatedContent(composer.id)).recordings.map((r) => r.id)).not.toContain(recording.id);

    const audit = await prisma.auditLogEntry.findMany({ where: { entityType: "Recording", entityId: recording.id, action: "RECORDING_ARCHIVED" } });
    expect(audit).toHaveLength(1);
  });

  it("G. restore: an ARCHIVED Recording returns to a non-public editorial state without republishing", async () => {
    const user = await createTestUser();
    userId = user.id;
    const { composer, recording } = await createPublishedRecordingLinkedToComposer(user);
    const publishedRevisionId = recording.currentPublishedRevision!.id;
    await archiveRecording(recording.id, user.id);

    const restored = await restoreRecording(recording.id, user.id);
    expect(restored.status).toBe("DRAFT");
    expect(restored.currentPublishedRevisionId).toBe(publishedRevisionId); // history preserved, not cleared

    const revisionAfter = await prisma.recordingRevision.findUnique({ where: { id: publishedRevisionId } });
    expect(revisionAfter).not.toBeNull();
    expect(revisionAfter?.revisionStatus).toBe("PUBLISHED");

    // Restoring must NOT silently make it public again.
    expect(await findPublishedRecordingBySlug(recording.slug)).toBeNull();
    expect((await getComposerRelatedContent(composer.id)).recordings.map((r) => r.id)).not.toContain(recording.id);

    const audit = await prisma.auditLogEntry.findMany({ where: { entityType: "Recording", entityId: recording.id, action: "RECORDING_RESTORED" } });
    expect(audit).toHaveLength(1);
  });

  it("rejects restoring a Recording that is not ARCHIVED", async () => {
    const user = await createTestUser();
    userId = user.id;
    const draft = await createDraftRecording({ slug: uniqueSlug("recording"), actorId: user.id });
    recordingId = draft.id;

    await expect(restoreRecording(draft.id, user.id)).rejects.toThrow();
  });

  it("H. publication predicate consistency: findPublishedRecordingBySlug and resolveRelatedContent (via getComposerRelatedContent) always agree", async () => {
    const user = await createTestUser();
    userId = user.id;
    const { composer, work, recording } = await createPublishedRecordingLinkedToComposer(user);

    async function agree(): Promise<boolean> {
      const bySlug = await findPublishedRecordingBySlug(recording.slug);
      const related = await getComposerRelatedContent(composer.id);
      const isPublicBySlug = bySlug !== null;
      const isPublicByRelated = related.recordings.some((r) => r.id === recording.id);
      return isPublicBySlug === isPublicByRelated;
    }

    // PUBLISHED: both say public.
    expect(await agree()).toBe(true);
    expect((await findPublishedRecordingBySlug(recording.slug)) !== null).toBe(true);

    // ARCHIVED: both say not public.
    await archiveRecording(recording.id, user.id);
    expect(await agree()).toBe(true);
    expect(await findPublishedRecordingBySlug(recording.slug)).toBeNull();

    // Restored to DRAFT: both still say not public.
    await restoreRecording(recording.id, user.id);
    expect(await agree()).toBe(true);
    expect(await findPublishedRecordingBySlug(recording.slug)).toBeNull();

    // Republished: both say public again — forking from the
    // still-preserved published revision, since restore leaves no open
    // draft (this is the exact "future editor can fork and republish"
    // path restoreRecording's own comment describes). The work is
    // re-attached to the new draft (see forkAndReattachWork) since
    // forking never copies RecordingRevisionWork rows forward — a
    // separate, pre-existing behavior this phase does not change.
    await forkAndReattachWork(recording.id, work.id, user.id);
    await publishCurrentDraft(recording.id, user.id);
    expect(await agree()).toBe(true);
    expect(await findPublishedRecordingBySlug(recording.slug)).not.toBeNull();

    // Unpublished: both say not public.
    await unpublishRecording(recording.id, user.id);
    expect(await agree()).toBe(true);
    expect(await findPublishedRecordingBySlug(recording.slug)).toBeNull();
  });

  it("H (IN_REVIEW case): a Recording that has never been published is excluded by both predicates", async () => {
    const user = await createTestUser();
    userId = user.id;
    const composer = await createComposer({ slug: uniqueSlug("composer"), name: "QA Composer 2", actorId: user.id });
    composerId = composer.id;
    const work = await createMusicalWork({ slug: uniqueSlug("work"), title: "QA Work 2", composerId: composer.id, actorId: user.id });
    workId = work.id;
    const draft = await createDraftRecording({ slug: uniqueSlug("recording"), actorId: user.id });
    recordingId = draft.id;
    await attachWorkToRevision(draft.currentDraftRevision!.id, work.id, user.id);
    await submitRecordingForReview(draft.id, user.id); // IN_REVIEW, never published

    expect(await findPublishedRecordingBySlug(draft.slug)).toBeNull();
    expect((await getComposerRelatedContent(composer.id)).recordings.map((r) => r.id)).not.toContain(draft.id);
  });
});
