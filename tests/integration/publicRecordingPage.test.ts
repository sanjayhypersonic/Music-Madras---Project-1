import { describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { prisma } from "../../modules/db/client";
import { createComposer } from "../../modules/db/repositories/composerRepository";
import { createMusicalWork } from "../../modules/db/repositories/musicalWorkRepository";
import { createProgramme, addProgrammeItem } from "../../modules/db/repositories/programmeRepository";
import { createVenue } from "../../modules/db/repositories/venueRepository";
import { createOrganisation } from "../../modules/db/repositories/organisationRepository";
import { createChoir } from "../../modules/db/repositories/choirRepository";
import { createConductor } from "../../modules/db/repositories/conductorRepository";
import { createArtist } from "../../modules/db/repositories/artistRepository";
import { addChoirToPerformance, addConductorToPerformance, addPerformerToPerformance, createPerformance } from "../../modules/db/repositories/performanceRepository";
import {
  attachWorkToRevision,
  createDraftRecording,
  forkDraftFromPublished,
  publishCurrentDraft,
  submitRecordingForReview,
  updateDraftRevisionContent,
} from "../../modules/db/repositories/recordingRepository";
import { attachMediaToRevision } from "../../modules/db/repositories/mediaResourceRepository";
import { approveUnlistedPublication, createDraftVideoPage, publishVideoPage } from "../../modules/db/repositories/youtubeVideoPageRepository";
import { createCollection, addRecordingToCollection, publishCollection, archiveCollection } from "../../modules/db/repositories/collectionRepository";
import { getPublicRecordingPageData } from "../../modules/db/repositories/entityRelationshipsRepository";
import { generateMetadata } from "../../app/(museum)/recordings/[slug]/page";
import type { ObservabilityState } from "@prisma/client";

// Phase 6G-5B: proves getPublicRecordingPageData (the public
// /recordings/[slug] route's sole data source) against the real database,
// mirroring tests/integration/entityRelationshipsRepository.test.ts's
// pattern exactly. Real DB, disposable test-prefixed fixtures only.

const TEST_TAG = "phase6g5b";
const TEST_EMAIL = `${TEST_TAG}-integration-test@musicmadras.test`;

function uniqueSlug(base: string): string {
  return `${TEST_TAG}-${base}-${randomUUID().slice(0, 8)}`;
}

async function createTestUser() {
  return prisma.studioUser.create({
    data: { id: randomUUID(), email: TEST_EMAIL, name: "Phase 6G-5B Test User", role: "EDITOR", status: "ACTIVE" },
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
  composer: { id: string; slug: string };
  work: { id: string };
  programme: { id: string };
  venue: { id: string };
  organisation: { id: string };
  choir: { id: string };
  conductor: { id: string };
  artist: { id: string };
  performance: { id: string };
  recordingId: string;
  slug: string;
}

/** Full canonical chain, published, with no media/collection attached yet — callers add those as needed. */
async function createPublishedRecordingFixture(): Promise<Fixture> {
  const user = await createTestUser();
  const organisation = await createOrganisation({ slug: uniqueSlug("organisation"), name: `Test Organisation ${randomUUID().slice(0, 8)}`, actorId: user.id });
  const composer = await createComposer({ slug: uniqueSlug("composer"), name: `Test Composer ${randomUUID().slice(0, 8)}`, actorId: user.id });
  const work = await createMusicalWork({ slug: uniqueSlug("work"), title: "Test Work", composerId: composer.id, actorId: user.id });
  const programme = await createProgramme({ slug: uniqueSlug("programme"), title: "Test Programme", actorId: user.id });
  await addProgrammeItem({ programmeId: programme.id, musicalWorkId: work.id, movement: "I. Allegro", actorId: user.id });
  const venue = await createVenue({ slug: uniqueSlug("venue"), name: "Test Venue", type: "CHURCH", organisationId: organisation.id, actorId: user.id });
  const performance = await createPerformance({ programmeId: programme.id, venueId: venue.id, performanceDate: new Date("2020-05-01"), actorId: user.id });
  const choir = await createChoir({ slug: uniqueSlug("choir"), name: `Test Choir ${randomUUID().slice(0, 8)}`, actorId: user.id });
  const conductor = await createConductor({ slug: uniqueSlug("conductor"), name: `Test Conductor ${randomUUID().slice(0, 8)}`, actorId: user.id });
  const artist = await createArtist({ slug: uniqueSlug("artist"), name: `Test Artist ${randomUUID().slice(0, 8)}`, actorId: user.id });
  await addChoirToPerformance(performance.id, choir.id, user.id);
  await addConductorToPerformance(performance.id, conductor.id, user.id);
  await addPerformerToPerformance(performance.id, artist.id, "Soloist", user.id);

  const draft = await createDraftRecording({ slug: uniqueSlug("recording"), actorId: user.id, title: "Test Recording" });
  await updateDraftRevisionContent(draft.id, draft.currentDraftRevision!.updatedAt, user.id, { performanceId: performance.id });
  await attachWorkToRevision(draft.currentDraftRevision!.id, work.id, user.id);
  const published = await publishCurrentDraft(draft.id, user.id);

  return {
    user,
    composer,
    work,
    programme,
    venue,
    organisation,
    choir,
    conductor,
    artist,
    performance,
    recordingId: published.id,
    slug: published.slug,
  };
}

async function cleanupFixture(fixture: Fixture, extra: { videoId?: string; videoPageId?: string; collectionId?: string } = {}) {
  if (extra.collectionId) {
    await prisma.auditLogEntry.deleteMany({ where: { entityType: "Collection", entityId: extra.collectionId } });
    await prisma.collection.delete({ where: { id: extra.collectionId } });
  }
  if (extra.videoPageId) {
    await prisma.auditLogEntry.deleteMany({ where: { entityType: "YouTubeVideoPage", entityId: extra.videoPageId } });
    await prisma.youTubeVideoPage.delete({ where: { id: extra.videoPageId } });
  }
  if (extra.videoId) {
    await prisma.youTubeVideo.delete({ where: { id: extra.videoId } });
  }

  const revisions = await prisma.recordingRevision.findMany({ where: { recordingId: fixture.recordingId }, select: { id: true } });
  const revisionIds = revisions.map((r) => r.id);
  await prisma.auditLogEntry.deleteMany({ where: { entityType: "Recording", entityId: fixture.recordingId } });
  if (revisionIds.length > 0) {
    await prisma.auditLogEntry.deleteMany({ where: { entityType: "RecordingRevision", entityId: { in: revisionIds } } });
  }
  await prisma.recording.delete({ where: { id: fixture.recordingId } }); // cascades RecordingRevision -> RecordingRevisionWork/MediaResource

  await prisma.auditLogEntry.deleteMany({ where: { entityType: "Performance", entityId: fixture.performance.id } });
  await prisma.performance.delete({ where: { id: fixture.performance.id } }); // cascades PerformanceChoir/Performer/Conductor
  await prisma.auditLogEntry.deleteMany({ where: { entityType: "Choir", entityId: fixture.choir.id } });
  await prisma.choir.delete({ where: { id: fixture.choir.id } });
  await prisma.auditLogEntry.deleteMany({ where: { entityType: "Conductor", entityId: fixture.conductor.id } });
  await prisma.conductor.delete({ where: { id: fixture.conductor.id } });
  await prisma.auditLogEntry.deleteMany({ where: { entityType: "Artist", entityId: fixture.artist.id } });
  await prisma.artist.delete({ where: { id: fixture.artist.id } });

  await prisma.auditLogEntry.deleteMany({ where: { entityType: "Programme", entityId: fixture.programme.id } });
  await prisma.programme.delete({ where: { id: fixture.programme.id } }); // cascades ProgrammeItem
  await prisma.auditLogEntry.deleteMany({ where: { entityType: "Venue", entityId: fixture.venue.id } });
  await prisma.venue.delete({ where: { id: fixture.venue.id } });
  await prisma.auditLogEntry.deleteMany({ where: { entityType: "Organisation", entityId: fixture.organisation.id } });
  await prisma.organisation.delete({ where: { id: fixture.organisation.id } });

  await prisma.auditLogEntry.deleteMany({ where: { entityType: "MusicalWork", entityId: fixture.work.id } });
  await prisma.musicalWork.delete({ where: { id: fixture.work.id } });
  await prisma.auditLogEntry.deleteMany({ where: { entityType: "Composer", entityId: fixture.composer.id } });
  await prisma.composer.delete({ where: { id: fixture.composer.id } });

  await prisma.studioUser.deleteMany({ where: { id: fixture.user.id } });
}

describe("A. Public route/data safety — getPublicRecordingPageData", () => {
  it("returns null for an unknown slug", async () => {
    expect(await getPublicRecordingPageData(uniqueSlug("nonexistent"))).toBeNull();
  });

  it("returns null for a DRAFT Recording (never published)", async () => {
    const user = await createTestUser();
    const draft = await createDraftRecording({ slug: uniqueSlug("recording"), actorId: user.id });
    try {
      expect(await getPublicRecordingPageData(draft.slug)).toBeNull();
    } finally {
      await prisma.auditLogEntry.deleteMany({ where: { entityType: "Recording", entityId: draft.id } });
      await prisma.recording.delete({ where: { id: draft.id } });
      await prisma.studioUser.deleteMany({ where: { id: user.id } });
    }
  });

  it("returns null for an IN_REVIEW Recording", async () => {
    const user = await createTestUser();
    const draft = await createDraftRecording({ slug: uniqueSlug("recording"), actorId: user.id });
    await submitRecordingForReview(draft.id, user.id);
    try {
      expect(await getPublicRecordingPageData(draft.slug)).toBeNull();
    } finally {
      await prisma.auditLogEntry.deleteMany({ where: { entityType: "Recording", entityId: draft.id } });
      await prisma.recording.delete({ where: { id: draft.id } });
      await prisma.studioUser.deleteMany({ where: { id: user.id } });
    }
  });

  it("resolves a PUBLISHED Recording using its currentPublishedRevision, and superseded revisions never leak through", async () => {
    const fixture = await createPublishedRecordingFixture();
    try {
      const first = await getPublicRecordingPageData(fixture.slug);
      expect(first).not.toBeNull();
      expect(first?.title).toBe("Test Recording");

      // Fork + edit + republish: the page must show the NEW title, never the stale one.
      // Phase 6I-2: the fork carries the Work forward itself; re-attaching it
      // by hand (the old workaround) now correctly throws "already attached".
      const forked = await forkDraftFromPublished(fixture.recordingId, fixture.user.id);
      await updateDraftRevisionContent(fixture.recordingId, forked.updatedAt, fixture.user.id, { title: "Updated Recording Title" });
      await publishCurrentDraft(fixture.recordingId, fixture.user.id);

      const second = await getPublicRecordingPageData(fixture.slug);
      expect(second?.title).toBe("Updated Recording Title");
    } finally {
      await cleanupFixture(fixture);
    }
  });
});

describe("B. Relationship rendering — getPublicRecordingPageData", () => {
  it("surfaces Performance (venue, organisation, artists, choir, conductor), Programme (with items), Works, and Composer", async () => {
    const fixture = await createPublishedRecordingFixture();
    try {
      const data = await getPublicRecordingPageData(fixture.slug);
      expect(data).not.toBeNull();

      expect(data!.works).toHaveLength(1);
      expect(data!.works[0].id).toBe(fixture.work.id);
      expect(data!.composers.map((c) => c.id)).toContain(fixture.composer.id);

      expect(data!.programme?.id).toBe(fixture.programme.id);
      expect(data!.programme?.items).toHaveLength(1);
      expect(data!.programme?.items[0].movement).toBe("I. Allegro");

      expect(data!.performance?.id).toBe(fixture.performance.id);
      expect(data!.performance?.venue?.id).toBe(fixture.venue.id);
      expect(data!.performance?.venue?.organisation?.id).toBe(fixture.organisation.id);
      expect(data!.performance?.artists.map((a) => a.id)).toContain(fixture.artist.id);
      expect(data!.performance?.choirs.map((c) => c.id)).toContain(fixture.choir.id);
      expect(data!.performance?.conductors.map((c) => c.id)).toContain(fixture.conductor.id);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("includes a published Collection but excludes a draft and an archived Collection", async () => {
    const fixture = await createPublishedRecordingFixture();
    let publishedCollectionId: string | null = null;
    let draftCollectionId: string | null = null;
    let archivedCollectionId: string | null = null;
    try {
      const publishedCollection = await createCollection({ slug: uniqueSlug("collection-published"), title: "Published Collection", actorId: fixture.user.id });
      publishedCollectionId = publishedCollection.id;
      await addRecordingToCollection(publishedCollection.id, fixture.recordingId, fixture.user.id);
      await publishCollection(publishedCollection.id, fixture.user.id);

      const draftCollection = await createCollection({ slug: uniqueSlug("collection-draft"), title: "Draft Collection", actorId: fixture.user.id });
      draftCollectionId = draftCollection.id;
      await addRecordingToCollection(draftCollection.id, fixture.recordingId, fixture.user.id);

      const archivedCollection = await createCollection({ slug: uniqueSlug("collection-archived"), title: "Archived Collection", actorId: fixture.user.id });
      archivedCollectionId = archivedCollection.id;
      await addRecordingToCollection(archivedCollection.id, fixture.recordingId, fixture.user.id);
      await publishCollection(archivedCollection.id, fixture.user.id);
      await archiveCollection(archivedCollection.id, fixture.user.id);

      const data = await getPublicRecordingPageData(fixture.slug);
      const collectionIds = data!.collections.map((c) => c.id);
      expect(collectionIds).toContain(publishedCollectionId);
      expect(collectionIds).not.toContain(draftCollectionId);
      expect(collectionIds).not.toContain(archivedCollectionId);
    } finally {
      await prisma.auditLogEntry.deleteMany({
        where: { entityType: "Collection", entityId: { in: [publishedCollectionId, draftCollectionId, archivedCollectionId].filter((id): id is string => id !== null) } },
      });
      if (publishedCollectionId) await prisma.collection.delete({ where: { id: publishedCollectionId } });
      if (draftCollectionId) await prisma.collection.delete({ where: { id: draftCollectionId } });
      if (archivedCollectionId) await prisma.collection.delete({ where: { id: archivedCollectionId } });
      await cleanupFixture(fixture);
    }
  });
});

describe("C. MusicMadras video visibility — getPublicRecordingPageData", () => {
  async function attachVideoToFixture(fixture: Fixture, video: { id: string }) {
    const revision = await prisma.recording.findUnique({ where: { id: fixture.recordingId }, select: { currentPublishedRevisionId: true } });
    await attachMediaToRevision({
      recordingRevisionId: revision!.currentPublishedRevisionId!,
      provider: "YOUTUBE",
      role: "PRIMARY_VIDEO",
      youtubeVideoId: video.id,
      actorId: fixture.user.id,
    });
  }

  it("displays a public YouTubeVideoPage", async () => {
    const fixture = await createPublishedRecordingFixture();
    const video = await createTestVideo();
    const videoPage = await createDraftVideoPage({ youtubeVideoId: video.id, actorId: fixture.user.id });
    await publishVideoPage(videoPage.id, fixture.user.id);
    await attachVideoToFixture(fixture, video);
    try {
      const data = await getPublicRecordingPageData(fixture.slug);
      expect(data!.videos.map((v) => v.slug)).toContain(videoPage.slug);
    } finally {
      await cleanupFixture(fixture, { videoId: video.id, videoPageId: videoPage.id });
    }
  });

  it("excludes a private video's page even when the YouTubeVideoPage is PUBLISHED", async () => {
    const fixture = await createPublishedRecordingFixture();
    const video = await createTestVideo({ privacyStatus: "private" });
    const videoPage = await createDraftVideoPage({ youtubeVideoId: video.id, actorId: fixture.user.id });
    await publishVideoPage(videoPage.id, fixture.user.id);
    await attachVideoToFixture(fixture, video);
    try {
      const data = await getPublicRecordingPageData(fixture.slug);
      expect(data!.videos).toHaveLength(0);
    } finally {
      await cleanupFixture(fixture, { videoId: video.id, videoPageId: videoPage.id });
    }
  });

  it("excludes an unlisted video without explicit approval, but includes it once approved", async () => {
    const fixture = await createPublishedRecordingFixture();
    const video = await createTestVideo({ privacyStatus: "unlisted" });
    const videoPage = await createDraftVideoPage({ youtubeVideoId: video.id, actorId: fixture.user.id });
    await publishVideoPage(videoPage.id, fixture.user.id);
    await attachVideoToFixture(fixture, video);
    try {
      const beforeApproval = await getPublicRecordingPageData(fixture.slug);
      expect(beforeApproval!.videos).toHaveLength(0);

      await approveUnlistedPublication(videoPage.id, fixture.user.id);
      const afterApproval = await getPublicRecordingPageData(fixture.slug);
      expect(afterApproval!.videos.map((v) => v.slug)).toContain(videoPage.slug);
    } finally {
      await cleanupFixture(fixture, { videoId: video.id, videoPageId: videoPage.id });
    }
  });

  it("excludes an unavailable (non-OBSERVED) video's page even when published", async () => {
    const fixture = await createPublishedRecordingFixture();
    const video = await createTestVideo({ observabilityState: "UNAVAILABLE" });
    const videoPage = await createDraftVideoPage({ youtubeVideoId: video.id, actorId: fixture.user.id });
    await publishVideoPage(videoPage.id, fixture.user.id);
    await attachVideoToFixture(fixture, video);
    try {
      const data = await getPublicRecordingPageData(fixture.slug);
      expect(data!.videos).toHaveLength(0);
    } finally {
      await cleanupFixture(fixture, { videoId: video.id, videoPageId: videoPage.id });
    }
  });

  it("never duplicates the same video even if it is attached via more than one MediaResource row", async () => {
    const fixture = await createPublishedRecordingFixture();
    const video = await createTestVideo();
    const videoPage = await createDraftVideoPage({ youtubeVideoId: video.id, actorId: fixture.user.id });
    await publishVideoPage(videoPage.id, fixture.user.id);
    await attachVideoToFixture(fixture, video); // first attachment
    const revision = await prisma.recording.findUnique({ where: { id: fixture.recordingId }, select: { currentPublishedRevisionId: true } });
    await attachMediaToRevision({
      recordingRevisionId: revision!.currentPublishedRevisionId!,
      provider: "YOUTUBE",
      role: "THUMBNAIL", // a second MediaResource row, same YouTubeVideo
      youtubeVideoId: video.id,
      actorId: fixture.user.id,
    });
    try {
      const data = await getPublicRecordingPageData(fixture.slug);
      expect(data!.videos).toHaveLength(1);
    } finally {
      await cleanupFixture(fixture, { videoId: video.id, videoPageId: videoPage.id });
    }
  });
});

describe("D. SEO metadata wiring — the actual page's generateMetadata", () => {
  it("generates metadata from the real published Recording, with the correct canonical URL", async () => {
    const fixture = await createPublishedRecordingFixture();
    try {
      const metadata = await generateMetadata({ params: Promise.resolve({ slug: fixture.slug }) });
      expect(metadata.title).toBe("Test Recording — Music Madras");
      expect(metadata.alternates?.canonical).toBe(`/recordings/${fixture.slug}`);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("returns empty metadata (no invented claims) for an unknown slug", async () => {
    const metadata = await generateMetadata({ params: Promise.resolve({ slug: uniqueSlug("nonexistent") }) });
    expect(metadata).toEqual({});
  });
});

describe("F. Regression — existing public-read functions remain unchanged", () => {
  it("listPublishedCollections and findPublicCollectionsByIds still behave as before (public-only, active-only)", async () => {
    const user = await createTestUser();
    const collection = await createCollection({ slug: uniqueSlug("collection-regression"), title: "Regression Collection", actorId: user.id });
    try {
      const { listPublishedCollections, findPublicCollectionsByIds } = await import("../../modules/db/repositories/collectionRepository");
      expect((await listPublishedCollections()).map((c) => c.id)).not.toContain(collection.id);
      await publishCollection(collection.id, user.id);
      expect((await listPublishedCollections()).map((c) => c.id)).toContain(collection.id);
      expect((await findPublicCollectionsByIds([collection.id])).map((c) => c.id)).toContain(collection.id);
    } finally {
      await prisma.auditLogEntry.deleteMany({ where: { entityType: "Collection", entityId: collection.id } });
      await prisma.collection.delete({ where: { id: collection.id } });
      await prisma.studioUser.deleteMany({ where: { id: user.id } });
    }
  });
});
