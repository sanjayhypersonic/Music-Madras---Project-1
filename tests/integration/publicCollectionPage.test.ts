import { describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { prisma } from "../../modules/db/client";
import { createComposer } from "../../modules/db/repositories/composerRepository";
import { createMusicalWork, archiveMusicalWork } from "../../modules/db/repositories/musicalWorkRepository";
import { createVenue } from "../../modules/db/repositories/venueRepository";
import { addProgrammeItem, createProgramme } from "../../modules/db/repositories/programmeRepository";
import { createPerformance } from "../../modules/db/repositories/performanceRepository";
import {
  attachWorkToRevision,
  createDraftRecording,
  publishCurrentDraft,
  submitRecordingForReview,
  updateDraftRevisionContent,
  archiveRecording,
} from "../../modules/db/repositories/recordingRepository";
import { attachMediaToRevision } from "../../modules/db/repositories/mediaResourceRepository";
import { createDraftVideoPage, publishVideoPage } from "../../modules/db/repositories/youtubeVideoPageRepository";
import {
  createCollection,
  addRecordingToCollection,
  addMusicalWorkToCollection,
  publishCollection,
  unpublishCollection,
  archiveCollection,
  listPublicCollectionsPage,
} from "../../modules/db/repositories/collectionRepository";
import { getPublicCollectionPageData } from "../../modules/db/repositories/entityRelationshipsRepository";
import type { ObservabilityState } from "@prisma/client";

// Phase 6G-10: proves getPublicCollectionPageData (the public
// /collections/[slug] route's sole data source) and listPublicCollectionsPage
// (the public /collections index's sole data source) against the real
// database. Mirrors the established tests/integration/*.test.ts pattern.
// Real DB, disposable test-prefixed fixtures only.

const TEST_TAG = "phase6g10";

function uniqueSlug(base: string): string {
  return `${TEST_TAG}-${base}-${randomUUID().slice(0, 8)}`;
}

async function createTestUser() {
  return prisma.studioUser.create({
    data: {
      id: randomUUID(),
      email: `${TEST_TAG}-integration-test-${randomUUID().slice(0, 8)}@musicmadras.test`,
      name: "Phase 6G-10 Test User",
      role: "EDITOR",
      status: "ACTIVE",
    },
  });
}

async function createTestVideo(overrides: { privacyStatus?: string; observabilityState?: ObservabilityState } = {}) {
  return prisma.youTubeVideo.create({
    data: {
      youtubeVideoId: uniqueSlug("video"),
      title: "Test Video",
      thumbnailUrl: "https://i.ytimg.com/vi/test/hqdefault.jpg",
      channelId: `${TEST_TAG}-test-channel`,
      privacyStatus: overrides.privacyStatus ?? "public",
      observabilityState: overrides.observabilityState ?? "OBSERVED",
    },
  });
}

interface Fixture {
  user: { id: string };
  composer: { id: string; slug: string; name: string };
  work: { id: string; slug: string };
  venue: { id: string };
  programme: { id: string };
  performance: { id: string; slug: string };
  collectionId: string;
  collectionSlug: string;
  recordingId: string;
  recordingSlug: string;
}

async function createFixture(marker: string): Promise<Fixture> {
  const user = await createTestUser();
  const composer = await createComposer({ slug: uniqueSlug("composer"), name: `Zzp10c Composer ${marker}`, actorId: user.id });
  const work = await createMusicalWork({ slug: uniqueSlug("work"), title: `Zzp10c Work ${marker}`, composerId: composer.id, actorId: user.id });
  const venue = await createVenue({ slug: uniqueSlug("venue"), name: `Zzp10c Venue ${marker}`, type: "CONCERT_HALL", actorId: user.id });
  const programme = await createProgramme({ slug: uniqueSlug("programme"), title: `Zzp10c Programme ${marker}`, actorId: user.id });
  await addProgrammeItem({ programmeId: programme.id, musicalWorkId: work.id, actorId: user.id });
  const performance = await createPerformance({ programmeId: programme.id, venueId: venue.id, performanceDate: new Date("2022-02-02"), actorId: user.id });

  const draft = await createDraftRecording({ slug: uniqueSlug("recording"), actorId: user.id, title: `Zzp10c Recording ${marker}` });
  await updateDraftRevisionContent(draft.id, draft.currentDraftRevision!.updatedAt, user.id, { performanceId: performance.id });
  await attachWorkToRevision(draft.currentDraftRevision!.id, work.id, user.id);
  const published = await publishCurrentDraft(draft.id, user.id);

  const collection = await createCollection({ slug: uniqueSlug("collection"), title: `Zzp10c Collection ${marker}`, description: "A test collection.", actorId: user.id });
  await addRecordingToCollection(collection.id, published.id, user.id);
  await addMusicalWorkToCollection(collection.id, work.id, user.id);
  await publishCollection(collection.id, user.id);

  return {
    user,
    composer: { id: composer.id, slug: composer.slug, name: composer.name },
    work: { id: work.id, slug: work.slug },
    venue: { id: venue.id },
    programme: { id: programme.id },
    performance: { id: performance.id, slug: performance.slug },
    collectionId: collection.id,
    collectionSlug: collection.slug,
    recordingId: published.id,
    recordingSlug: published.slug,
  };
}

async function cleanupFixture(fixture: Fixture, extra: { videoId?: string; videoPageId?: string } = {}) {
  if (extra.videoPageId) {
    await prisma.auditLogEntry.deleteMany({ where: { entityType: "YouTubeVideoPage", entityId: extra.videoPageId } });
    await prisma.youTubeVideoPage.delete({ where: { id: extra.videoPageId } }).catch(() => {});
  }
  if (extra.videoId) {
    await prisma.youTubeVideo.delete({ where: { id: extra.videoId } }).catch(() => {});
  }

  await prisma.auditLogEntry.deleteMany({ where: { entityType: "Collection", entityId: fixture.collectionId } });
  await prisma.collection.delete({ where: { id: fixture.collectionId } }).catch(() => {});

  const revisions = await prisma.recordingRevision.findMany({ where: { recordingId: fixture.recordingId }, select: { id: true } });
  await prisma.auditLogEntry.deleteMany({ where: { entityType: "Recording", entityId: fixture.recordingId } });
  if (revisions.length > 0) {
    await prisma.auditLogEntry.deleteMany({ where: { entityType: "RecordingRevision", entityId: { in: revisions.map((r) => r.id) } } });
  }
  await prisma.recording.delete({ where: { id: fixture.recordingId } }).catch(() => {});

  await prisma.auditLogEntry.deleteMany({ where: { entityType: "Performance", entityId: fixture.performance.id } });
  await prisma.performance.delete({ where: { id: fixture.performance.id } }).catch(() => {});
  await prisma.auditLogEntry.deleteMany({ where: { entityType: "Programme", entityId: fixture.programme.id } });
  await prisma.programme.delete({ where: { id: fixture.programme.id } }).catch(() => {});
  await prisma.auditLogEntry.deleteMany({ where: { entityType: "Venue", entityId: fixture.venue.id } });
  await prisma.venue.delete({ where: { id: fixture.venue.id } }).catch(() => {});

  await prisma.auditLogEntry.deleteMany({ where: { entityType: "MusicalWork", entityId: fixture.work.id } });
  await prisma.musicalWork.delete({ where: { id: fixture.work.id } }).catch(() => {});
  await prisma.auditLogEntry.deleteMany({ where: { entityType: "Composer", entityId: fixture.composer.id } });
  await prisma.composer.delete({ where: { id: fixture.composer.id } });

  await prisma.studioUser.deleteMany({ where: { id: fixture.user.id } });
}

describe("COLLECTION — getPublicCollectionPageData", () => {
  it("resolves a published Collection with its Recordings, Works, Composers, and per-recording context", async () => {
    const marker = randomUUID().slice(0, 8);
    const fixture = await createFixture(marker);
    try {
      const data = await getPublicCollectionPageData(fixture.collectionSlug);
      expect(data).not.toBeNull();
      expect(data!.title).toBe(`Zzp10c Collection ${marker}`);
      expect(data!.description).toBe("A test collection.");
      expect(data!.recordings.map((r) => r.id)).toContain(fixture.recordingId);
      const recording = data!.recordings.find((r) => r.id === fixture.recordingId);
      expect(recording?.slug).toBe(fixture.recordingSlug);
      expect(recording?.context.performance?.slug).toBe(fixture.performance.slug);
      expect(recording?.context.venue?.id).toBe(fixture.venue.id);
      expect(data!.works.map((w) => w.work.id)).toContain(fixture.work.id);
      expect(data!.composers.map((c) => c.id)).toContain(fixture.composer.id);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("returns null for a nonexistent slug", async () => {
    expect(await getPublicCollectionPageData(uniqueSlug("nonexistent"))).toBeNull();
  });

  it("returns null for an unpublished (DRAFT) Collection", async () => {
    const fixture = await createFixture(randomUUID().slice(0, 8));
    try {
      await unpublishCollection(fixture.collectionId, fixture.user.id);
      expect(await getPublicCollectionPageData(fixture.collectionSlug)).toBeNull();
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("returns null for an archived Collection", async () => {
    const fixture = await createFixture(randomUUID().slice(0, 8));
    try {
      await archiveCollection(fixture.collectionId, fixture.user.id);
      expect(await getPublicCollectionPageData(fixture.collectionSlug)).toBeNull();
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("excludes a Recording that is itself DRAFT, IN_REVIEW, or ARCHIVED, even though it is linked to a published Collection", async () => {
    const marker = randomUUID().slice(0, 8);
    const fixture = await createFixture(marker);
    let draftId: string | null = null;
    let inReviewId: string | null = null;
    let archivedRecId: string | null = null;
    try {
      const draft = await createDraftRecording({ slug: uniqueSlug("rec-draft"), actorId: fixture.user.id, title: "Zzp10c Draft" });
      draftId = draft.id;
      await addRecordingToCollection(fixture.collectionId, draft.id, fixture.user.id);

      const inReview = await createDraftRecording({ slug: uniqueSlug("rec-review"), actorId: fixture.user.id, title: "Zzp10c InReview" });
      inReviewId = inReview.id;
      await addRecordingToCollection(fixture.collectionId, inReview.id, fixture.user.id);
      await submitRecordingForReview(inReview.id, fixture.user.id);

      const archivedRec = await createDraftRecording({ slug: uniqueSlug("rec-archived"), actorId: fixture.user.id, title: "Zzp10c Archived" });
      archivedRecId = archivedRec.id;
      await addRecordingToCollection(fixture.collectionId, archivedRec.id, fixture.user.id);
      await publishCurrentDraft(archivedRec.id, fixture.user.id);
      await archiveRecording(archivedRec.id, fixture.user.id);

      const data = await getPublicCollectionPageData(fixture.collectionSlug);
      const ids = data!.recordings.map((r) => r.id);
      expect(ids).toContain(fixture.recordingId);
      expect(ids).not.toContain(draftId);
      expect(ids).not.toContain(inReviewId);
      expect(ids).not.toContain(archivedRecId);
    } finally {
      for (const id of [draftId, inReviewId, archivedRecId]) {
        if (!id) continue;
        const revisions = await prisma.recordingRevision.findMany({ where: { recordingId: id }, select: { id: true } });
        await prisma.auditLogEntry.deleteMany({ where: { entityType: "Recording", entityId: id } });
        if (revisions.length > 0) {
          await prisma.auditLogEntry.deleteMany({ where: { entityType: "RecordingRevision", entityId: { in: revisions.map((r) => r.id) } } });
        }
        await prisma.recording.delete({ where: { id } }).catch(() => {});
      }
      await cleanupFixture(fixture);
    }
  });

  it("excludes an archived Work even though it is linked to a published Collection", async () => {
    const fixture = await createFixture(randomUUID().slice(0, 8));
    const extraWork = await createMusicalWork({ slug: uniqueSlug("work-archived"), title: "Zzp10c Archived Work", composerId: fixture.composer.id, actorId: fixture.user.id });
    try {
      await addMusicalWorkToCollection(fixture.collectionId, extraWork.id, fixture.user.id);
      await archiveMusicalWork(extraWork.id, fixture.user.id);

      const data = await getPublicCollectionPageData(fixture.collectionSlug);
      expect(data!.works.map((w) => w.work.id)).not.toContain(extraWork.id);
      expect(data!.works.map((w) => w.work.id)).toContain(fixture.work.id);
    } finally {
      await prisma.auditLogEntry.deleteMany({ where: { entityType: "MusicalWork", entityId: extraWork.id } });
      await prisma.musicalWork.delete({ where: { id: extraWork.id } }).catch(() => {});
      await cleanupFixture(fixture);
    }
  });

  it("shows a public MusicMadras video via the collection's recording, but excludes a private one", async () => {
    const fixture = await createFixture(randomUUID().slice(0, 8));
    const publicVideo = await createTestVideo();
    const privateVideo = await createTestVideo({ privacyStatus: "private" });
    const publicPage = await createDraftVideoPage({ youtubeVideoId: publicVideo.id, actorId: fixture.user.id });
    const privatePage = await createDraftVideoPage({ youtubeVideoId: privateVideo.id, actorId: fixture.user.id });
    await publishVideoPage(publicPage.id, fixture.user.id);
    await publishVideoPage(privatePage.id, fixture.user.id);
    try {
      const revisionId = (
        await prisma.recording.findUnique({ where: { id: fixture.recordingId }, select: { currentPublishedRevisionId: true } })
      )!.currentPublishedRevisionId!;
      await attachMediaToRevision({ recordingRevisionId: revisionId, provider: "YOUTUBE", role: "PRIMARY_VIDEO", youtubeVideoId: publicVideo.id, actorId: fixture.user.id });
      await attachMediaToRevision({ recordingRevisionId: revisionId, provider: "YOUTUBE", role: "THUMBNAIL", youtubeVideoId: privateVideo.id, actorId: fixture.user.id });

      const data = await getPublicCollectionPageData(fixture.collectionSlug);
      const slugs = data!.videos.map((v) => v.slug);
      expect(slugs).toContain(publicPage.slug);
      expect(slugs).not.toContain(privatePage.slug);
    } finally {
      for (const page of [publicPage, privatePage]) {
        await prisma.auditLogEntry.deleteMany({ where: { entityType: "YouTubeVideoPage", entityId: page.id } });
        await prisma.youTubeVideoPage.delete({ where: { id: page.id } }).catch(() => {});
      }
      for (const video of [publicVideo, privateVideo]) {
        await prisma.youTubeVideo.delete({ where: { id: video.id } }).catch(() => {});
      }
      await cleanupFixture(fixture);
    }
  });

  it("returns a Collection with empty recordings/works/videos when nothing has been added (missing relationships, not an error)", async () => {
    const user = await createTestUser();
    const collection = await createCollection({ slug: uniqueSlug("bare-collection"), title: "Zzp10c Bare Collection", actorId: user.id });
    await publishCollection(collection.id, user.id);
    try {
      const data = await getPublicCollectionPageData(collection.slug);
      expect(data).not.toBeNull();
      expect(data!.recordings).toEqual([]);
      expect(data!.works).toEqual([]);
      expect(data!.composers).toEqual([]);
      expect(data!.videos).toEqual([]);
    } finally {
      await prisma.auditLogEntry.deleteMany({ where: { entityType: "Collection", entityId: collection.id } });
      await prisma.collection.delete({ where: { id: collection.id } });
      await prisma.studioUser.deleteMany({ where: { id: user.id } });
    }
  });
});

describe("COLLECTION — /collections index (listPublicCollectionsPage)", () => {
  it("lists only published, non-archived Collections, with recording/work counts", async () => {
    const marker = randomUUID().slice(0, 8);
    const fixture = await createFixture(marker);
    try {
      const result = await listPublicCollectionsPage(1, 50);
      const found = result.items.find((c) => c.id === fixture.collectionId);
      expect(found).toBeDefined();
      expect(found?.slug).toBe(fixture.collectionSlug);
      expect(found?.recordingCount).toBe(1);
      expect(found?.workCount).toBe(1);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("excludes unpublished and archived Collections", async () => {
    const user = await createTestUser();
    const draftCollection = await createCollection({ slug: uniqueSlug("draft-collection"), title: "Zzp10c Draft Collection", actorId: user.id });
    const archivedCollection = await createCollection({ slug: uniqueSlug("archived-collection"), title: "Zzp10c Archived Collection", actorId: user.id });
    await publishCollection(archivedCollection.id, user.id);
    await archiveCollection(archivedCollection.id, user.id);
    try {
      const result = await listPublicCollectionsPage(1, 100);
      const ids = result.items.map((c) => c.id);
      expect(ids).not.toContain(draftCollection.id);
      expect(ids).not.toContain(archivedCollection.id);
    } finally {
      await prisma.auditLogEntry.deleteMany({ where: { entityType: "Collection", entityId: { in: [draftCollection.id, archivedCollection.id] } } });
      await prisma.collection.deleteMany({ where: { id: { in: [draftCollection.id, archivedCollection.id] } } });
      await prisma.studioUser.deleteMany({ where: { id: user.id } });
    }
  });

  it("paginates with no duplicate/overlapping rows across pages", async () => {
    const user = await createTestUser();
    const marker = randomUUID().slice(0, 8);
    const collections = await Promise.all(
      Array.from({ length: 5 }, (_, i) => createCollection({ slug: uniqueSlug(`page-collection-${i}`), title: `Zzp10c Page Collection ${marker} ${i}`, actorId: user.id }))
    );
    for (const c of collections) {
      await publishCollection(c.id, user.id);
    }
    try {
      const pageOne = await listPublicCollectionsPage(1, 2);
      const allIds = new Set<string>();
      let page = 1;
      let total = 0;
      // Walk pages of size 2 until every fixture collection is accounted for, proving no duplication across pages.
      const ourIds = new Set(collections.map((c) => c.id));
      const collected = new Set<string>();
      while (collected.size < ourIds.size && page <= 50) {
        const result = await listPublicCollectionsPage(page, 2);
        for (const item of result.items) {
          if (ourIds.has(item.id)) {
            expect(collected.has(item.id)).toBe(false);
            collected.add(item.id);
          }
        }
        total = result.total;
        page += 1;
      }
      expect(collected.size).toBe(ourIds.size);
      expect(total).toBeGreaterThanOrEqual(5);
      expect(pageOne.items.length).toBeLessThanOrEqual(2);
      allIds.clear();
    } finally {
      const ids = collections.map((c) => c.id);
      await prisma.auditLogEntry.deleteMany({ where: { entityType: "Collection", entityId: { in: ids } } });
      await prisma.collection.deleteMany({ where: { id: { in: ids } } });
      await prisma.studioUser.deleteMany({ where: { id: user.id } });
    }
  });

  it("returns an empty items array (not an error) when there are no published Collections matching a far-out page", async () => {
    const result = await listPublicCollectionsPage(9999, 20);
    expect(result.items).toEqual([]);
  });
});
