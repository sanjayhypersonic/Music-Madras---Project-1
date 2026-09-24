import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { prisma } from "../../modules/db/client";
import { can } from "../../modules/auth/policy";
import { SlugConflictError } from "../../modules/mmke/slug/SlugConflictError";
import { createComposer } from "../../modules/db/repositories/composerRepository";
import { createMusicalWork } from "../../modules/db/repositories/musicalWorkRepository";
import { createDraftRecording } from "../../modules/db/repositories/recordingRepository";
import {
  addMusicalWorkToCollection,
  addRecordingToCollection,
  archiveCollection,
  createCollection,
  findCollectionById,
  findCollectionBySlug,
  findPublicCollectionsByIds,
  listCollectionsForStudio,
  listPublishedCollections,
  publishCollection,
  reorderCollectionRecordings,
  reorderCollectionWorks,
  removeMusicalWorkFromCollection,
  removeRecordingFromCollection,
  restoreCollection,
  unpublishCollection,
  updateCollection,
} from "../../modules/db/repositories/collectionRepository";

// Phase 6G-4I: proves the Studio Collection catalogue repository against
// the real database, mirroring tests/integration/studioPerformanceCatalogue.test.ts
// and its siblings' pattern exactly. Real DB, disposable test-prefixed
// fixtures only.

const TEST_TAG = "phase6g4i";
const TEST_EMAIL = `${TEST_TAG}-integration-test@musicmadras.test`;

function uniqueSlug(base: string): string {
  return `${TEST_TAG}-${base}-${randomUUID().slice(0, 8)}`;
}

async function createTestUser() {
  return prisma.studioUser.create({
    data: { id: randomUUID(), email: TEST_EMAIL, name: "Phase 6G-4I Test User", role: "EDITOR", status: "ACTIVE" },
  });
}

async function cleanupCollection(collectionId: string) {
  await prisma.auditLogEntry.deleteMany({ where: { entityType: "Collection", entityId: collectionId } });
  await prisma.collection.delete({ where: { id: collectionId } }); // cascades CollectionRecording/CollectionWork
}

async function cleanupRecording(recordingId: string) {
  await prisma.auditLogEntry.deleteMany({ where: { entityType: "Recording", entityId: recordingId } });
  await prisma.recording.delete({ where: { id: recordingId } }); // cascades RecordingRevision
}

async function cleanupWork(workId: string) {
  await prisma.auditLogEntry.deleteMany({ where: { entityType: "MusicalWork", entityId: workId } });
  await prisma.musicalWork.delete({ where: { id: workId } });
}

async function cleanupComposer(composerId: string) {
  await prisma.auditLogEntry.deleteMany({ where: { entityType: "Composer", entityId: composerId } });
  await prisma.composer.delete({ where: { id: composerId } });
}

describe("Studio permission policy for Collection (brief §16, cross-checked against 6G-4C/E/F/G/H)", () => {
  it("CATALOGUE_WRITE is the only permission gating Collection writes — no new permission was introduced", () => {
    expect(can("CONTRIBUTOR", "CATALOGUE_WRITE")).toBe(false);
    expect(can("EDITOR", "CATALOGUE_WRITE")).toBe(true);
    expect(can("ADMINISTRATOR", "CATALOGUE_WRITE")).toBe(true);
  });
});

describe("Collection catalogue management against a real database", () => {
  let collectionId: string | null = null;
  let userId: string | null = null;

  afterEach(async () => {
    if (collectionId) {
      await cleanupCollection(collectionId).catch(() => {});
      collectionId = null;
    }
    if (userId) {
      await prisma.studioUser.deleteMany({ where: { id: userId } });
      userId = null;
    }
  });

  it("creates a Collection and audit-logs the creation", async () => {
    const user = await createTestUser();
    userId = user.id;

    const collection = await createCollection({ slug: uniqueSlug("collection"), title: "QA Curated Highlights", description: "A test note.", actorId: user.id });
    collectionId = collection.id;

    expect(collection.description).toBe("A test note.");
    expect(collection.status).toBe("DRAFT");
    expect(collection.archivedAt).toBeNull();
    const audit = await prisma.auditLogEntry.findMany({ where: { entityType: "Collection", entityId: collection.id, action: "COLLECTION_CREATED" } });
    expect(audit).toHaveLength(1);
  });

  it("rejects a colliding slug for a different Collection", async () => {
    const user = await createTestUser();
    userId = user.id;
    const collidingSlug = uniqueSlug("collision");

    const first = await createCollection({ slug: collidingSlug, title: "First Collection", actorId: user.id });
    collectionId = first.id;

    await expect(createCollection({ slug: collidingSlug, title: "A Different Title", actorId: user.id })).rejects.toThrow(SlugConflictError);
  });

  it("edits a Collection's title and description, keeping the slug immutable, and audit-logs it", async () => {
    const user = await createTestUser();
    userId = user.id;
    const collection = await createCollection({ slug: uniqueSlug("collection"), title: "Editable Collection", actorId: user.id });
    collectionId = collection.id;

    const updated = await updateCollection(collection.id, { title: "Renamed Collection", description: "Updated description.", actorId: user.id });
    expect(updated.title).toBe("Renamed Collection");
    expect(updated.description).toBe("Updated description.");
    expect(updated.slug).toBe(collection.slug);

    const audit = await prisma.auditLogEntry.findMany({ where: { entityType: "Collection", entityId: collection.id, action: "COLLECTION_UPDATED" } });
    expect(audit).toHaveLength(1);
  });

  it("publishes and unpublishes a Collection, audit-logging both", async () => {
    const user = await createTestUser();
    userId = user.id;
    const collection = await createCollection({ slug: uniqueSlug("collection"), title: "Publishable Collection", actorId: user.id });
    collectionId = collection.id;

    const published = await publishCollection(collection.id, user.id);
    expect(published.status).toBe("PUBLISHED");

    const unpublished = await unpublishCollection(collection.id, user.id);
    expect(unpublished.status).toBe("DRAFT");

    const publishAudit = await prisma.auditLogEntry.findMany({ where: { entityType: "Collection", entityId: collection.id, action: "COLLECTION_PUBLISHED" } });
    const unpublishAudit = await prisma.auditLogEntry.findMany({ where: { entityType: "Collection", entityId: collection.id, action: "COLLECTION_UNPUBLISHED" } });
    expect(publishAudit).toHaveLength(1);
    expect(unpublishAudit).toHaveLength(1);
  });

  it("archives and restores a Collection, audit-logging both, without deleting the record", async () => {
    const user = await createTestUser();
    userId = user.id;
    const collection = await createCollection({ slug: uniqueSlug("collection"), title: "Archivable Collection", actorId: user.id });
    collectionId = collection.id;

    const archived = await archiveCollection(collection.id, user.id);
    expect(archived.archivedAt).not.toBeNull();
    expect(await findCollectionById(collection.id)).not.toBeNull();

    const restored = await restoreCollection(collection.id, user.id);
    expect(restored.archivedAt).toBeNull();

    const archiveAudit = await prisma.auditLogEntry.findMany({ where: { entityType: "Collection", entityId: collection.id, action: "COLLECTION_ARCHIVED" } });
    const restoreAudit = await prisma.auditLogEntry.findMany({ where: { entityType: "Collection", entityId: collection.id, action: "COLLECTION_RESTORED" } });
    expect(archiveAudit).toHaveLength(1);
    expect(restoreAudit).toHaveLength(1);
  });

  it("lists and searches Collections for Studio, including archived ones, with membership counts", async () => {
    const user = await createTestUser();
    userId = user.id;
    const uniqueMarker = randomUUID().slice(0, 8);
    const collection = await createCollection({ slug: uniqueSlug("collection"), title: `Searchable ${uniqueMarker} Collection`, actorId: user.id });
    collectionId = collection.id;

    const found = await listCollectionsForStudio(uniqueMarker);
    expect(found.map((c) => c.id)).toContain(collection.id);
    const foundEntry = found.find((c) => c.id === collection.id);
    expect(foundEntry?._count.recordingLinks).toBe(0);
    expect(foundEntry?._count.workLinks).toBe(0);

    await archiveCollection(collection.id, user.id);
    const foundAfterArchive = await listCollectionsForStudio(uniqueMarker);
    expect(foundAfterArchive.map((c) => c.id)).toContain(collection.id); // Studio list includes archived
  });

  it("does not break the existing public-read functions (listPublishedCollections/findPublicCollectionsByIds/findCollectionBySlug)", async () => {
    const user = await createTestUser();
    userId = user.id;
    const collection = await createCollection({ slug: uniqueSlug("collection"), title: "Public Read Regression Collection", actorId: user.id });
    collectionId = collection.id;

    // Not published yet — must not appear in the public-read paths.
    expect((await listPublishedCollections()).map((c) => c.id)).not.toContain(collection.id);
    expect(await findPublicCollectionsByIds([collection.id])).toHaveLength(0);

    await publishCollection(collection.id, user.id);

    expect((await listPublishedCollections()).map((c) => c.id)).toContain(collection.id);
    expect((await findPublicCollectionsByIds([collection.id])).map((c) => c.id)).toContain(collection.id);
    const bySlug = await findCollectionBySlug(collection.slug);
    expect(bySlug?.id).toBe(collection.id);
    expect(bySlug?.recordingLinks).toEqual([]);
    expect(bySlug?.workLinks).toEqual([]);
  });
});

describe("Collection Recording membership (add/remove/reorder) against a real database", () => {
  let collectionId: string | null = null;
  let recordingIds: string[] = [];
  let userId: string | null = null;

  afterEach(async () => {
    if (collectionId) {
      await cleanupCollection(collectionId).catch(() => {});
      collectionId = null;
    }
    for (const recordingId of recordingIds) {
      await cleanupRecording(recordingId).catch(() => {});
    }
    recordingIds = [];
    if (userId) {
      await prisma.studioUser.deleteMany({ where: { id: userId } });
      userId = null;
    }
  });

  it("adds a Recording to a collection, audit-logging it, without duplicating the relationship on a repeat add", async () => {
    const user = await createTestUser();
    userId = user.id;
    const recording = await createDraftRecording({ slug: uniqueSlug("recording"), title: "QA Recording", actorId: user.id });
    recordingIds.push(recording.id);
    const collection = await createCollection({ slug: uniqueSlug("collection"), title: "QA Collection", actorId: user.id });
    collectionId = collection.id;

    await addRecordingToCollection(collection.id, recording.id, user.id);
    const withOne = await findCollectionById(collection.id);
    expect(withOne?.recordingLinks).toHaveLength(1);

    // Duplicate add: existing repository convention is upsert-as-no-op, never a duplicate row.
    await addRecordingToCollection(collection.id, recording.id, user.id);
    const stillOne = await findCollectionById(collection.id);
    expect(stillOne?.recordingLinks).toHaveLength(1);

    const audit = await prisma.auditLogEntry.findMany({ where: { entityType: "Collection", entityId: collection.id, action: "RECORDING_ADDED_TO_COLLECTION" } });
    expect(audit.length).toBeGreaterThanOrEqual(1);
  });

  it("removes a Recording from a collection without deleting the Recording itself, audit-logging the removal", async () => {
    const user = await createTestUser();
    userId = user.id;
    const recording = await createDraftRecording({ slug: uniqueSlug("recording"), title: "QA Recording 2", actorId: user.id });
    recordingIds.push(recording.id);
    const collection = await createCollection({ slug: uniqueSlug("collection"), title: "QA Collection 2", actorId: user.id });
    collectionId = collection.id;
    await addRecordingToCollection(collection.id, recording.id, user.id);

    await removeRecordingFromCollection(collection.id, recording.id, user.id);

    const loaded = await findCollectionById(collection.id);
    expect(loaded?.recordingLinks).toHaveLength(0);
    expect(await prisma.recording.findUnique({ where: { id: recording.id } })).not.toBeNull(); // Recording itself survives

    const audit = await prisma.auditLogEntry.findMany({ where: { entityType: "Collection", entityId: collection.id, action: "RECORDING_REMOVED_FROM_COLLECTION" } });
    expect(audit).toHaveLength(1);
  });

  it("reorders a collection's Recordings deterministically, audit-logging the new order", async () => {
    const user = await createTestUser();
    userId = user.id;
    const recordingA = await createDraftRecording({ slug: uniqueSlug("recording-a"), title: "Recording A", actorId: user.id });
    const recordingB = await createDraftRecording({ slug: uniqueSlug("recording-b"), title: "Recording B", actorId: user.id });
    recordingIds.push(recordingA.id, recordingB.id);
    const collection = await createCollection({ slug: uniqueSlug("collection"), title: "QA Collection 3", actorId: user.id });
    collectionId = collection.id;

    await addRecordingToCollection(collection.id, recordingA.id, user.id);
    await addRecordingToCollection(collection.id, recordingB.id, user.id);

    // Move Recording A (currently order 1, index 0) to index 1 (after B).
    await reorderCollectionRecordings(collection.id, recordingA.id, 1, user.id);

    const loaded = await findCollectionById(collection.id);
    expect(loaded?.recordingLinks.map((l) => l.recordingId)).toEqual([recordingB.id, recordingA.id]);
    expect(loaded?.recordingLinks.map((l) => l.order)).toEqual([1, 2]);

    const audit = await prisma.auditLogEntry.findMany({ where: { entityType: "Collection", entityId: collection.id, action: "COLLECTION_RECORDINGS_REORDERED" } });
    expect(audit).toHaveLength(1);
  });
});

describe("Collection Musical Work membership (add/remove/reorder) against a real database", () => {
  let collectionId: string | null = null;
  let workIds: string[] = [];
  let composerId: string | null = null;
  let userId: string | null = null;

  afterEach(async () => {
    if (collectionId) {
      await cleanupCollection(collectionId).catch(() => {});
      collectionId = null;
    }
    for (const workId of workIds) {
      await cleanupWork(workId).catch(() => {});
    }
    workIds = [];
    if (composerId) {
      await cleanupComposer(composerId).catch(() => {});
      composerId = null;
    }
    if (userId) {
      await prisma.studioUser.deleteMany({ where: { id: userId } });
      userId = null;
    }
  });

  it("adds a Musical Work to a collection, audit-logging it, without duplicating the relationship on a repeat add", async () => {
    const user = await createTestUser();
    userId = user.id;
    const composer = await createComposer({ slug: uniqueSlug("composer"), name: "QA Composer", actorId: user.id });
    composerId = composer.id;
    const work = await createMusicalWork({ slug: uniqueSlug("work"), title: "QA Work", composerId: composer.id, actorId: user.id });
    workIds.push(work.id);
    const collection = await createCollection({ slug: uniqueSlug("collection"), title: "QA Work Collection", actorId: user.id });
    collectionId = collection.id;

    await addMusicalWorkToCollection(collection.id, work.id, user.id);
    const withOne = await findCollectionById(collection.id);
    expect(withOne?.workLinks).toHaveLength(1);

    await addMusicalWorkToCollection(collection.id, work.id, user.id);
    const stillOne = await findCollectionById(collection.id);
    expect(stillOne?.workLinks).toHaveLength(1);

    const audit = await prisma.auditLogEntry.findMany({ where: { entityType: "Collection", entityId: collection.id, action: "WORK_ADDED_TO_COLLECTION" } });
    expect(audit.length).toBeGreaterThanOrEqual(1);
  });

  it("removes a Musical Work from a collection without deleting the Work itself, audit-logging the removal", async () => {
    const user = await createTestUser();
    userId = user.id;
    const composer = await createComposer({ slug: uniqueSlug("composer"), name: "QA Composer 2", actorId: user.id });
    composerId = composer.id;
    const work = await createMusicalWork({ slug: uniqueSlug("work"), title: "QA Work 2", composerId: composer.id, actorId: user.id });
    workIds.push(work.id);
    const collection = await createCollection({ slug: uniqueSlug("collection"), title: "QA Work Collection 2", actorId: user.id });
    collectionId = collection.id;
    await addMusicalWorkToCollection(collection.id, work.id, user.id);

    await removeMusicalWorkFromCollection(collection.id, work.id, user.id);

    const loaded = await findCollectionById(collection.id);
    expect(loaded?.workLinks).toHaveLength(0);
    expect(await prisma.musicalWork.findUnique({ where: { id: work.id } })).not.toBeNull(); // Work itself survives

    const audit = await prisma.auditLogEntry.findMany({ where: { entityType: "Collection", entityId: collection.id, action: "WORK_REMOVED_FROM_COLLECTION" } });
    expect(audit).toHaveLength(1);
  });

  it("reorders a collection's Musical Works deterministically, audit-logging the new order", async () => {
    const user = await createTestUser();
    userId = user.id;
    const composer = await createComposer({ slug: uniqueSlug("composer"), name: "QA Composer 3", actorId: user.id });
    composerId = composer.id;
    const workA = await createMusicalWork({ slug: uniqueSlug("work-a"), title: "Work A", composerId: composer.id, actorId: user.id });
    const workB = await createMusicalWork({ slug: uniqueSlug("work-b"), title: "Work B", composerId: composer.id, actorId: user.id });
    workIds.push(workA.id, workB.id);
    const collection = await createCollection({ slug: uniqueSlug("collection"), title: "QA Work Collection 3", actorId: user.id });
    collectionId = collection.id;

    await addMusicalWorkToCollection(collection.id, workA.id, user.id);
    await addMusicalWorkToCollection(collection.id, workB.id, user.id);

    await reorderCollectionWorks(collection.id, workA.id, 1, user.id);

    const loaded = await findCollectionById(collection.id);
    expect(loaded?.workLinks.map((l) => l.musicalWorkId)).toEqual([workB.id, workA.id]);
    expect(loaded?.workLinks.map((l) => l.order)).toEqual([1, 2]);

    const audit = await prisma.auditLogEntry.findMany({ where: { entityType: "Collection", entityId: collection.id, action: "COLLECTION_WORKS_REORDERED" } });
    expect(audit).toHaveLength(1);
  });
});

describe("Collection relationship safety across archive/restore", () => {
  let collectionId: string | null = null;
  let recordingIds: string[] = [];
  let workIds: string[] = [];
  let composerId: string | null = null;
  let userId: string | null = null;

  afterEach(async () => {
    if (collectionId) {
      await cleanupCollection(collectionId).catch(() => {});
      collectionId = null;
    }
    for (const recordingId of recordingIds) {
      await cleanupRecording(recordingId).catch(() => {});
    }
    recordingIds = [];
    for (const workId of workIds) {
      await cleanupWork(workId).catch(() => {});
    }
    workIds = [];
    if (composerId) {
      await cleanupComposer(composerId).catch(() => {});
      composerId = null;
    }
    if (userId) {
      await prisma.studioUser.deleteMany({ where: { id: userId } });
      userId = null;
    }
  });

  it("preserves both Recording and Musical Work memberships when the Collection is archived and restored", async () => {
    const user = await createTestUser();
    userId = user.id;
    const recording = await createDraftRecording({ slug: uniqueSlug("recording"), title: "QA Preserved Recording", actorId: user.id });
    recordingIds.push(recording.id);
    const composer = await createComposer({ slug: uniqueSlug("composer"), name: "QA Preserved Composer", actorId: user.id });
    composerId = composer.id;
    const work = await createMusicalWork({ slug: uniqueSlug("work"), title: "QA Preserved Work", composerId: composer.id, actorId: user.id });
    workIds.push(work.id);
    const collection = await createCollection({ slug: uniqueSlug("collection"), title: "QA Preserved Collection", actorId: user.id });
    collectionId = collection.id;

    await addRecordingToCollection(collection.id, recording.id, user.id);
    await addMusicalWorkToCollection(collection.id, work.id, user.id);

    await archiveCollection(collection.id, user.id);
    const whileArchived = await findCollectionById(collection.id);
    expect(whileArchived?.recordingLinks).toHaveLength(1);
    expect(whileArchived?.workLinks).toHaveLength(1);

    await restoreCollection(collection.id, user.id);
    const afterRestore = await findCollectionById(collection.id);
    expect(afterRestore?.recordingLinks).toHaveLength(1);
    expect(afterRestore?.workLinks).toHaveLength(1);
  });
});
