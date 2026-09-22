import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { prisma } from "../../modules/db/client";
import {
  getArtistRelatedContent,
  getChoirRelatedContent,
  getComposerEntityPageData,
  getComposerRelatedContent,
  getConductorRelatedContent,
  getVenueEntityPageData,
  getVenueRelatedContent,
} from "../../modules/db/repositories/entityRelationshipsRepository";
import { createComposer } from "../../modules/db/repositories/composerRepository";
import { createMusicalWork } from "../../modules/db/repositories/musicalWorkRepository";
import { createProgramme, addProgrammeItem } from "../../modules/db/repositories/programmeRepository";
import { createVenue } from "../../modules/db/repositories/venueRepository";
import { createChoir } from "../../modules/db/repositories/choirRepository";
import { createConductor } from "../../modules/db/repositories/conductorRepository";
import { createArtist } from "../../modules/db/repositories/artistRepository";
import {
  addChoirToPerformance,
  addConductorToPerformance,
  addPerformerToPerformance,
  createPerformance,
} from "../../modules/db/repositories/performanceRepository";
import {
  attachWorkToRevision,
  createDraftRecording,
  publishCurrentDraft,
  updateDraftRevisionContent,
} from "../../modules/db/repositories/recordingRepository";
import { attachMediaToRevision } from "../../modules/db/repositories/mediaResourceRepository";
import {
  approveUnlistedPublication,
  createDraftVideoPage,
  publishVideoPage,
} from "../../modules/db/repositories/youtubeVideoPageRepository";
import { createCollection, addRecordingToCollection, publishCollection } from "../../modules/db/repositories/collectionRepository";
import type { ObservabilityState } from "@prisma/client";

// Phase 6G-4A: proves the canonical relationship / media-aggregation
// layer against the real, Prisma-backed database, exactly like
// tests/integration/youtubeVideoPageRepository.test.ts — every fixture
// here is a fresh, test-prefixed row this file creates and tears down
// itself, never a global scan of the 226 real YouTubeVideo rows.

const TEST_TAG = "phase6g4a";
const TEST_EMAIL = `${TEST_TAG}-integration-test@musicmadras.test`;

function uniqueSlug(base: string): string {
  return `${TEST_TAG}-${base}-${randomUUID().slice(0, 8)}`;
}

async function createTestUser() {
  return prisma.studioUser.create({
    data: { id: randomUUID(), email: TEST_EMAIL, name: "Phase 6G-4A Test User", role: "EDITOR", status: "ACTIVE" },
  });
}

async function createTestVideo(overrides: { privacyStatus?: string; observabilityState?: ObservabilityState } = {}) {
  return prisma.youTubeVideo.create({
    data: {
      youtubeVideoId: uniqueSlug("video"),
      title: "Test Choir Live", // deliberately matches the "Test Choir" fixture's name (see the title-matching test)
      channelId: `${TEST_TAG}-test-channel`,
      privacyStatus: overrides.privacyStatus ?? "public",
      observabilityState: overrides.observabilityState ?? "OBSERVED",
    },
  });
}

/**
 * The full canonical chain the brief's example relationships all resolve
 * through: Composer -> Work -> Programme -> Performance (+Venue, +Choir,
 * +Conductor, +Artist) -> Recording -> MediaResource -> YouTubeVideo ->
 * YouTubeVideoPage, plus a Collection over the same Recording. Returns
 * every id created so a single ordered cleanup can tear it all down.
 */
async function createFullChainFixture() {
  const user = await createTestUser();

  const composer = await createComposer({ slug: uniqueSlug("composer"), name: "Test Composer", actorId: user.id });
  const work = await createMusicalWork({ slug: uniqueSlug("work"), title: "Test Work", composerId: composer.id, actorId: user.id });
  const programme = await createProgramme({ slug: uniqueSlug("programme"), title: "Test Programme", actorId: user.id });
  await addProgrammeItem({ programmeId: programme.id, musicalWorkId: work.id, actorId: user.id });
  const venue = await createVenue({ slug: uniqueSlug("venue"), name: "Test Venue", type: "CHURCH", actorId: user.id });
  const performance = await createPerformance({ programmeId: programme.id, venueId: venue.id, actorId: user.id });

  const choir = await createChoir({ name: `Test Choir ${randomUUID().slice(0, 8)}`, actorId: user.id });
  const conductor = await createConductor({ name: `Test Conductor ${randomUUID().slice(0, 8)}`, actorId: user.id });
  const artist = await createArtist({ name: `Test Artist ${randomUUID().slice(0, 8)}`, actorId: user.id });
  await addChoirToPerformance(performance.id, choir.id, user.id);
  await addConductorToPerformance(performance.id, conductor.id, user.id);
  await addPerformerToPerformance(performance.id, artist.id, "Soloist", user.id);

  const draftRecording = await createDraftRecording({ slug: uniqueSlug("recording"), actorId: user.id, title: "Test Recording" });
  await updateDraftRevisionContent(draftRecording.id, draftRecording.currentDraftRevision!.updatedAt, user.id, {
    performanceId: performance.id,
  });
  await attachWorkToRevision(draftRecording.currentDraftRevision!.id, work.id, user.id);
  const published = await publishCurrentDraft(draftRecording.id, user.id);
  const recording = published;
  const publishedRevisionId = published.currentPublishedRevision!.id;

  const video = await createTestVideo();
  await attachMediaToRevision({
    recordingRevisionId: publishedRevisionId,
    provider: "YOUTUBE",
    role: "PRIMARY_VIDEO",
    youtubeVideoId: video.id,
    actorId: user.id,
  });
  const videoPage = await createDraftVideoPage({ youtubeVideoId: video.id, actorId: user.id });
  await publishVideoPage(videoPage.id, user.id);

  const collection = await createCollection({ slug: uniqueSlug("collection"), title: "Test Collection", actorId: user.id });
  await addRecordingToCollection(collection.id, recording.id, user.id);
  await publishCollection(collection.id, user.id);

  return { user, composer, work, programme, performance, venue, choir, conductor, artist, recording, video, videoPage, collection };
}

async function cleanupFullChainFixture(fixture: Awaited<ReturnType<typeof createFullChainFixture>>) {
  await prisma.auditLogEntry.deleteMany({ where: { entityType: "Collection", entityId: fixture.collection.id } });
  await prisma.collection.delete({ where: { id: fixture.collection.id } });

  await prisma.auditLogEntry.deleteMany({ where: { entityType: "YouTubeVideoPage", entityId: fixture.videoPage.id } });
  await prisma.youTubeVideoPage.delete({ where: { id: fixture.videoPage.id } });
  await prisma.youTubeVideo.delete({ where: { id: fixture.video.id } });

  const publishedRevisionId = fixture.recording.currentPublishedRevision!.id;
  await prisma.auditLogEntry.deleteMany({ where: { entityType: "RecordingRevision", entityId: publishedRevisionId } });
  await prisma.auditLogEntry.deleteMany({ where: { entityType: "Recording", entityId: fixture.recording.id } });
  await prisma.recording.delete({ where: { id: fixture.recording.id } }); // cascades RecordingRevision -> RecordingRevisionWork/MediaResource

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

  await prisma.auditLogEntry.deleteMany({ where: { entityType: "MusicalWork", entityId: fixture.work.id } });
  await prisma.musicalWork.delete({ where: { id: fixture.work.id } });
  await prisma.auditLogEntry.deleteMany({ where: { entityType: "Composer", entityId: fixture.composer.id } });
  await prisma.composer.delete({ where: { id: fixture.composer.id } });

  await prisma.studioUser.deleteMany({ where: { id: fixture.user.id } });
}

describe("entityRelationshipsRepository against a real database", () => {
  describe("the full canonical chain", () => {
    let fixture: Awaited<ReturnType<typeof createFullChainFixture>> | null = null;

    afterEach(async () => {
      if (fixture) {
        await cleanupFullChainFixture(fixture);
        fixture = null;
      }
    });

    it("resolves the composer's related work, programme, performance, recording, video, and collection", async () => {
      fixture = await createFullChainFixture();
      const content = await getComposerRelatedContent(fixture.composer.id);

      expect(content.works.map((w) => w.id)).toEqual([fixture.work.id]);
      expect(content.programmes.map((p) => p.id)).toContain(fixture.programme.id);
      expect(content.performances.map((p) => p.id)).toContain(fixture.performance.id);
      expect(content.recordings.map((r) => r.id)).toContain(fixture.recording.id);
      expect(content.videos.map((v) => v.youtubeVideo.id)).toContain(fixture.video.id);
      expect(content.collections.map((c) => c.id)).toContain(fixture.collection.id);
    });

    it("one publicly-visible video is related to multiple distinct entities (choir, conductor, artist, venue) without duplication", async () => {
      fixture = await createFullChainFixture();

      const [choirContent, conductorContent, artistContent, venueContent] = await Promise.all([
        getChoirRelatedContent(fixture.choir.id),
        getConductorRelatedContent(fixture.conductor.id),
        getArtistRelatedContent(fixture.artist.id),
        getVenueRelatedContent(fixture.venue.id),
      ]);

      for (const content of [choirContent, conductorContent, artistContent, venueContent]) {
        expect(content.videos).toHaveLength(1);
        expect(content.videos[0].youtubeVideo.id).toBe(fixture.video.id);
        expect(content.recordings.map((r) => r.id)).toEqual([fixture.recording.id]);
        expect(content.collections.map((c) => c.id)).toEqual([fixture.collection.id]);
      }

      // No new YouTubeVideo or MediaResource row was created by resolving
      // the same video through four different entities.
      const videoCount = await prisma.youTubeVideo.count({ where: { id: fixture.video.id } });
      const mediaResourceCount = await prisma.mediaResource.count({ where: { youtubeVideoId: fixture.video.id } });
      expect(videoCount).toBe(1);
      expect(mediaResourceCount).toBe(1);
    });

    it("getComposerEntityPageData and getVenueEntityPageData assemble the full public contract", async () => {
      fixture = await createFullChainFixture();

      const composerPage = await getComposerEntityPageData(fixture.composer.slug);
      expect(composerPage).not.toBeNull();
      expect(composerPage!.entityType).toBe("composer");
      expect(composerPage!.relatedWorks).toEqual([{ id: fixture.work.id, slug: fixture.work.slug, title: fixture.work.title }]);
      expect(composerPage!.relatedVideos.map((v) => v.slug)).toContain(fixture.videoPage.slug);
      expect(composerPage!.relatedCollections.map((c) => c.id)).toContain(fixture.collection.id);

      const venuePage = await getVenueEntityPageData(fixture.venue.slug);
      expect(venuePage).not.toBeNull();
      expect(venuePage!.entityType).toBe("venue");
      expect(venuePage!.relatedWorks).toBeNull(); // Venue has no work-level relationship
      expect(venuePage!.relatedVideos.map((v) => v.slug)).toContain(fixture.videoPage.slug);
    });

    it("relationship queries are deterministic across repeated calls", async () => {
      fixture = await createFullChainFixture();

      const first = await getChoirRelatedContent(fixture.choir.id);
      const second = await getChoirRelatedContent(fixture.choir.id);

      expect(second.recordings.map((r) => r.id)).toEqual(first.recordings.map((r) => r.id));
      expect(second.videos.map((v) => v.youtubeVideo.id)).toEqual(first.videos.map((v) => v.youtubeVideo.id));
      expect(second.collections.map((c) => c.id)).toEqual(first.collections.map((c) => c.id));
    });

    it("does not return an unrelated video merely because its title matches the choir's name", async () => {
      fixture = await createFullChainFixture();
      // fixture.video.title is literally "Test Choir Live" and fixture.choir
      // is named "Test Choir ..." — the title collision is deliberate. The
      // video IS related here only because of the real MediaResource chain
      // built above, not because of the matching words. Prove the negative
      // with a second choir sharing no such chain at all.
      const unrelatedChoir = await createChoir({ name: `Unrelated Choir ${randomUUID().slice(0, 8)}`, actorId: fixture.user.id });
      try {
        const content = await getChoirRelatedContent(unrelatedChoir.id);
        expect(content.videos).toEqual([]);
        expect(content.recordings).toEqual([]);
      } finally {
        await prisma.auditLogEntry.deleteMany({ where: { entityType: "Choir", entityId: unrelatedChoir.id } });
        await prisma.choir.delete({ where: { id: unrelatedChoir.id } });
      }
    });

    it("distinguishes a MusicMadras Collection from the raw YouTube playlist containing the same video", async () => {
      fixture = await createFullChainFixture();

      const playlist = await prisma.youTubePlaylist.create({
        data: { youtubePlaylistId: uniqueSlug("playlist"), title: "Raw Synced Playlist" },
      });
      const playlistItem = await prisma.youTubePlaylistItem.create({
        data: { playlistId: playlist.id, youtubeVideoId: fixture.video.id, position: 1 },
      });

      try {
        // The playlist contains the video, but no Collection references
        // this recording/work — a second, unrelated choir must see zero
        // collections despite the playlist's existence.
        const unrelatedChoir = await createChoir({ name: `Playlist Test Choir ${randomUUID().slice(0, 8)}`, actorId: fixture.user.id });
        try {
          const content = await getChoirRelatedContent(unrelatedChoir.id);
          expect(content.collections).toEqual([]);
        } finally {
          await prisma.auditLogEntry.deleteMany({ where: { entityType: "Choir", entityId: unrelatedChoir.id } });
          await prisma.choir.delete({ where: { id: unrelatedChoir.id } });
        }
      } finally {
        await prisma.youTubePlaylistItem.delete({ where: { id: playlistItem.id } });
        await prisma.youTubePlaylist.delete({ where: { id: playlist.id } });
      }
    });
  });

  describe("empty relationship sets", () => {
    it("returns empty arrays, not an error, for an entity with no performances or works", async () => {
      const user = await createTestUser();
      const choir = await createChoir({ name: `Lonely Choir ${randomUUID().slice(0, 8)}`, actorId: user.id });

      try {
        const content = await getChoirRelatedContent(choir.id);
        expect(content).toEqual({ performances: [], programmes: [], recordings: [], videos: [], collections: [] });

        const composer = await createComposer({ slug: uniqueSlug("empty-composer"), name: "Empty Composer", actorId: user.id });
        try {
          const composerContent = await getComposerRelatedContent(composer.id);
          expect(composerContent.works).toEqual([]);
          expect(composerContent.recordings).toEqual([]);
          expect(composerContent.videos).toEqual([]);
        } finally {
          await prisma.auditLogEntry.deleteMany({ where: { entityType: "Composer", entityId: composer.id } });
          await prisma.composer.delete({ where: { id: composer.id } });
        }
      } finally {
        await prisma.auditLogEntry.deleteMany({ where: { entityType: "Choir", entityId: choir.id } });
        await prisma.choir.delete({ where: { id: choir.id } });
        await prisma.studioUser.deleteMany({ where: { id: user.id } });
      }
    });
  });

  describe("public visibility gating (mirrors the 6G-2A/6G-3 rules, applied through the relationship chain)", () => {
    async function createMinimalChoirWithVideo(videoOverrides: Parameters<typeof createTestVideo>[0] = {}) {
      const user = await createTestUser();
      const composer = await createComposer({ slug: uniqueSlug("vis-composer"), name: "Vis Composer", actorId: user.id });
      const work = await createMusicalWork({ slug: uniqueSlug("vis-work"), title: "Vis Work", composerId: composer.id, actorId: user.id });
      const programme = await createProgramme({ slug: uniqueSlug("vis-programme"), title: "Vis Programme", actorId: user.id });
      await addProgrammeItem({ programmeId: programme.id, musicalWorkId: work.id, actorId: user.id });
      const venue = await createVenue({ slug: uniqueSlug("vis-venue"), name: "Vis Venue", type: "CHURCH", actorId: user.id });
      const performance = await createPerformance({ programmeId: programme.id, venueId: venue.id, actorId: user.id });
      const choir = await createChoir({ name: `Vis Choir ${randomUUID().slice(0, 8)}`, actorId: user.id });
      await addChoirToPerformance(performance.id, choir.id, user.id);

      const draft = await createDraftRecording({ slug: uniqueSlug("vis-recording"), actorId: user.id });
      await updateDraftRevisionContent(draft.id, draft.currentDraftRevision!.updatedAt, user.id, { performanceId: performance.id });
      const published = await publishCurrentDraft(draft.id, user.id);
      const publishedRevisionId = published.currentPublishedRevision!.id;

      const video = await createTestVideo(videoOverrides);
      await attachMediaToRevision({
        recordingRevisionId: publishedRevisionId,
        provider: "YOUTUBE",
        role: "PRIMARY_VIDEO",
        youtubeVideoId: video.id,
        actorId: user.id,
      });

      const page = await createDraftVideoPage({ youtubeVideoId: video.id, actorId: user.id });

      return {
        userId: user.id,
        choirId: choir.id,
        pageId: page.id,
        cleanup: async () => {
          await prisma.auditLogEntry.deleteMany({ where: { entityType: "YouTubeVideoPage", entityId: page.id } });
          await prisma.youTubeVideoPage.delete({ where: { id: page.id } });
          await prisma.youTubeVideo.delete({ where: { id: video.id } });
          await prisma.auditLogEntry.deleteMany({ where: { entityType: "RecordingRevision", entityId: publishedRevisionId } });
          await prisma.auditLogEntry.deleteMany({ where: { entityType: "Recording", entityId: published.id } });
          await prisma.recording.delete({ where: { id: published.id } });
          await prisma.auditLogEntry.deleteMany({ where: { entityType: "Performance", entityId: performance.id } });
          await prisma.performance.delete({ where: { id: performance.id } });
          await prisma.auditLogEntry.deleteMany({ where: { entityType: "Choir", entityId: choir.id } });
          await prisma.choir.delete({ where: { id: choir.id } });
          await prisma.auditLogEntry.deleteMany({ where: { entityType: "Programme", entityId: programme.id } });
          await prisma.programme.delete({ where: { id: programme.id } });
          await prisma.auditLogEntry.deleteMany({ where: { entityType: "Venue", entityId: venue.id } });
          await prisma.venue.delete({ where: { id: venue.id } });
          await prisma.auditLogEntry.deleteMany({ where: { entityType: "MusicalWork", entityId: work.id } });
          await prisma.musicalWork.delete({ where: { id: work.id } });
          await prisma.auditLogEntry.deleteMany({ where: { entityType: "Composer", entityId: composer.id } });
          await prisma.composer.delete({ where: { id: composer.id } });
          await prisma.studioUser.deleteMany({ where: { id: user.id } });
        },
      };
    }

    it("excludes a DRAFT (never-published) video page", async () => {
      const { cleanup, choirId } = await createMinimalChoirWithVideo();
      try {
        // Leave the page in DRAFT — never call publishVideoPage.
        const content = await getChoirRelatedContent(choirId);
        expect(content.videos).toEqual([]);
      } finally {
        await cleanup();
      }
    });

    it("excludes an unlisted video page until it is explicitly approved, then includes it once approved", async () => {
      const { cleanup, choirId, pageId, userId } = await createMinimalChoirWithVideo({ privacyStatus: "unlisted" });
      try {
        await publishVideoPage(pageId, userId);
        const beforeApproval = await getChoirRelatedContent(choirId);
        expect(beforeApproval.videos).toEqual([]);

        await approveUnlistedPublication(pageId, userId);
        const afterApproval = await getChoirRelatedContent(choirId);
        expect(afterApproval.videos).toHaveLength(1);
      } finally {
        await cleanup();
      }
    });

    it("excludes a private video's page even when published", async () => {
      const { cleanup, choirId, pageId, userId } = await createMinimalChoirWithVideo({ privacyStatus: "private" });
      try {
        await publishVideoPage(pageId, userId);
        const content = await getChoirRelatedContent(choirId);
        expect(content.videos).toEqual([]);
      } finally {
        await cleanup();
      }
    });

    it("excludes an unavailable (non-OBSERVED) video's page even when published and public", async () => {
      const { cleanup, choirId, pageId, userId } = await createMinimalChoirWithVideo({ observabilityState: "UNAVAILABLE" });
      try {
        await publishVideoPage(pageId, userId);
        const content = await getChoirRelatedContent(choirId);
        expect(content.videos).toEqual([]);
      } finally {
        await cleanup();
      }
    });
  });
});
