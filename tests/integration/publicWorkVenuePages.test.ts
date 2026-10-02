import { describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { prisma } from "../../modules/db/client";
import { createComposer } from "../../modules/db/repositories/composerRepository";
import { createMusicalWork } from "../../modules/db/repositories/musicalWorkRepository";
import { createProgramme, addProgrammeItem } from "../../modules/db/repositories/programmeRepository";
import { createVenue, archiveVenue } from "../../modules/db/repositories/venueRepository";
import { createOrganisation } from "../../modules/db/repositories/organisationRepository";
import { createChoir } from "../../modules/db/repositories/choirRepository";
import { createConductor } from "../../modules/db/repositories/conductorRepository";
import { createArtist } from "../../modules/db/repositories/artistRepository";
import { addChoirToPerformance, addConductorToPerformance, addPerformerToPerformance, createPerformance } from "../../modules/db/repositories/performanceRepository";
import {
  attachWorkToRevision,
  createDraftRecording,
  publishCurrentDraft,
  submitRecordingForReview,
  updateDraftRevisionContent,
  archiveRecording,
} from "../../modules/db/repositories/recordingRepository";
import { attachMediaToRevision } from "../../modules/db/repositories/mediaResourceRepository";
import { approveUnlistedPublication, createDraftVideoPage, publishVideoPage } from "../../modules/db/repositories/youtubeVideoPageRepository";
import { createCollection, addRecordingToCollection, publishCollection, archiveCollection } from "../../modules/db/repositories/collectionRepository";
import { getComposerEntityPageData, getPublicRecordingPageData, getPublicWorkPageData, getVenueEntityPageData } from "../../modules/db/repositories/entityRelationshipsRepository";
import { archiveMusicalWork } from "../../modules/db/repositories/musicalWorkRepository";
import type { ObservabilityState } from "@prisma/client";

// Phase 6G-6: proves getPublicWorkPageData and getVenueEntityPageData (the
// public /works/[slug] and /venues/[slug] routes' sole data sources)
// against the real database, plus cross-linking slugs consumed by
// /recordings/[slug] and /composers/[slug]. Mirrors the established
// tests/integration/*.test.ts pattern. Real DB, disposable test-prefixed
// fixtures only.

const TEST_TAG = "phase6g6";
const TEST_EMAIL = `${TEST_TAG}-integration-test@musicmadras.test`;

function uniqueSlug(base: string): string {
  return `${TEST_TAG}-${base}-${randomUUID().slice(0, 8)}`;
}

async function createTestUser() {
  return prisma.studioUser.create({
    data: { id: randomUUID(), email: TEST_EMAIL, name: "Phase 6G-6 Test User", role: "EDITOR", status: "ACTIVE" },
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
  work: { id: string; slug: string };
  programme: { id: string };
  venue: { id: string; slug: string };
  organisation: { id: string };
  choir: { id: string };
  conductor: { id: string };
  artist: { id: string };
  performance: { id: string };
  recordingId: string;
  recordingSlug: string;
}

async function createFixture(): Promise<Fixture> {
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

  return { user, composer, work, programme, venue, organisation, choir, conductor, artist, performance, recordingId: published.id, recordingSlug: published.slug };
}

async function cleanupFixture(fixture: Fixture, extra: { videoId?: string; videoPageId?: string; collectionIds?: string[] } = {}) {
  for (const collectionId of extra.collectionIds ?? []) {
    await prisma.auditLogEntry.deleteMany({ where: { entityType: "Collection", entityId: collectionId } });
    await prisma.collection.delete({ where: { id: collectionId } }).catch(() => {});
  }
  if (extra.videoPageId) {
    await prisma.auditLogEntry.deleteMany({ where: { entityType: "YouTubeVideoPage", entityId: extra.videoPageId } });
    await prisma.youTubeVideoPage.delete({ where: { id: extra.videoPageId } }).catch(() => {});
  }
  if (extra.videoId) {
    await prisma.youTubeVideo.delete({ where: { id: extra.videoId } }).catch(() => {});
  }

  const revisions = await prisma.recordingRevision.findMany({ where: { recordingId: fixture.recordingId }, select: { id: true } });
  const revisionIds = revisions.map((r) => r.id);
  await prisma.auditLogEntry.deleteMany({ where: { entityType: "Recording", entityId: fixture.recordingId } });
  if (revisionIds.length > 0) {
    await prisma.auditLogEntry.deleteMany({ where: { entityType: "RecordingRevision", entityId: { in: revisionIds } } });
  }
  await prisma.recording.delete({ where: { id: fixture.recordingId } }).catch(() => {});

  await prisma.auditLogEntry.deleteMany({ where: { entityType: "Performance", entityId: fixture.performance.id } });
  await prisma.performance.delete({ where: { id: fixture.performance.id } }).catch(() => {});
  await prisma.auditLogEntry.deleteMany({ where: { entityType: "Choir", entityId: fixture.choir.id } });
  await prisma.choir.delete({ where: { id: fixture.choir.id } });
  await prisma.auditLogEntry.deleteMany({ where: { entityType: "Conductor", entityId: fixture.conductor.id } });
  await prisma.conductor.delete({ where: { id: fixture.conductor.id } });
  await prisma.auditLogEntry.deleteMany({ where: { entityType: "Artist", entityId: fixture.artist.id } });
  await prisma.artist.delete({ where: { id: fixture.artist.id } });

  await prisma.auditLogEntry.deleteMany({ where: { entityType: "Programme", entityId: fixture.programme.id } });
  await prisma.programme.delete({ where: { id: fixture.programme.id } }).catch(() => {});
  await prisma.auditLogEntry.deleteMany({ where: { entityType: "Venue", entityId: fixture.venue.id } });
  await prisma.venue.delete({ where: { id: fixture.venue.id } }).catch(() => {});
  await prisma.auditLogEntry.deleteMany({ where: { entityType: "Organisation", entityId: fixture.organisation.id } });
  await prisma.organisation.delete({ where: { id: fixture.organisation.id } });

  await prisma.auditLogEntry.deleteMany({ where: { entityType: "MusicalWork", entityId: fixture.work.id } });
  await prisma.musicalWork.delete({ where: { id: fixture.work.id } }).catch(() => {});
  await prisma.auditLogEntry.deleteMany({ where: { entityType: "Composer", entityId: fixture.composer.id } });
  await prisma.composer.delete({ where: { id: fixture.composer.id } });

  await prisma.studioUser.deleteMany({ where: { id: fixture.user.id } });
}

describe("WORK — getPublicWorkPageData", () => {
  it("resolves a valid Work with its Composer, Programme, Performance, and published Recording", async () => {
    const fixture = await createFixture();
    try {
      const data = await getPublicWorkPageData(fixture.work.slug);
      expect(data).not.toBeNull();
      expect(data!.title).toBe("Test Work");
      expect(data!.composer.id).toBe(fixture.composer.id);
      expect(data!.composer.slug).toBe(fixture.composer.slug);
      expect(data!.programmes.map((p) => p.id)).toContain(fixture.programme.id);
      expect(data!.performances.map((p) => p.id)).toContain(fixture.performance.id);
      expect(data!.performances[0].venue?.slug).toBe(fixture.venue.slug);
      expect(data!.recordings.map((r) => r.id)).toContain(fixture.recordingId);
      expect(data!.recordings.find((r) => r.id === fixture.recordingId)?.slug).toBe(fixture.recordingSlug);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("returns null for an unknown slug", async () => {
    expect(await getPublicWorkPageData(uniqueSlug("nonexistent"))).toBeNull();
  });

  it("returns null for an archived Work", async () => {
    const fixture = await createFixture();
    try {
      await archiveMusicalWork(fixture.work.id, fixture.user.id);
      expect(await getPublicWorkPageData(fixture.work.slug)).toBeNull();
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("excludes a DRAFT, IN_REVIEW, or ARCHIVED Recording of this Work, but includes a PUBLISHED one", async () => {
    const fixture = await createFixture();
    let draftId: string | null = null;
    let draftRevisionId: string | null = null;
    let inReviewId: string | null = null;
    let inReviewRevisionId: string | null = null;
    try {
      const draft = await createDraftRecording({ slug: uniqueSlug("recording-draft"), actorId: fixture.user.id });
      draftId = draft.id;
      draftRevisionId = draft.currentDraftRevision!.id;
      await attachWorkToRevision(draft.currentDraftRevision!.id, fixture.work.id, fixture.user.id);

      const inReview = await createDraftRecording({ slug: uniqueSlug("recording-review"), actorId: fixture.user.id });
      inReviewId = inReview.id;
      inReviewRevisionId = inReview.currentDraftRevision!.id;
      await attachWorkToRevision(inReview.currentDraftRevision!.id, fixture.work.id, fixture.user.id);
      await submitRecordingForReview(inReview.id, fixture.user.id);

      const data = await getPublicWorkPageData(fixture.work.slug);
      const recordingIds = data!.recordings.map((r) => r.id);
      expect(recordingIds).toContain(fixture.recordingId); // PUBLISHED
      expect(recordingIds).not.toContain(draftId);
      expect(recordingIds).not.toContain(inReviewId);

      await archiveRecording(fixture.recordingId, fixture.user.id);
      const afterArchive = await getPublicWorkPageData(fixture.work.slug);
      expect(afterArchive!.recordings.map((r) => r.id)).not.toContain(fixture.recordingId);
    } finally {
      if (draftId) {
        await prisma.auditLogEntry.deleteMany({ where: { entityType: "Recording", entityId: draftId } });
        if (draftRevisionId) {
          await prisma.auditLogEntry.deleteMany({ where: { entityType: "RecordingRevision", entityId: draftRevisionId } });
        }
        await prisma.recording.delete({ where: { id: draftId } }).catch(() => {});
      }
      if (inReviewId) {
        await prisma.auditLogEntry.deleteMany({ where: { entityType: "Recording", entityId: inReviewId } });
        if (inReviewRevisionId) {
          await prisma.auditLogEntry.deleteMany({ where: { entityType: "RecordingRevision", entityId: inReviewRevisionId } });
        }
        await prisma.recording.delete({ where: { id: inReviewId } }).catch(() => {});
      }
      await cleanupFixture(fixture);
    }
  });

  it("shows a public video but excludes private/unapproved-unlisted/unavailable videos", async () => {
    const fixture = await createFixture();
    const publicVideo = await createTestVideo();
    const privateVideo = await createTestVideo({ privacyStatus: "private" });
    const unlistedVideo = await createTestVideo({ privacyStatus: "unlisted" });
    const unavailableVideo = await createTestVideo({ observabilityState: "UNAVAILABLE" });
    const pages = await Promise.all(
      [publicVideo, privateVideo, unlistedVideo, unavailableVideo].map(async (video) => {
        const page = await createDraftVideoPage({ youtubeVideoId: video.id, actorId: fixture.user.id });
        await publishVideoPage(page.id, fixture.user.id);
        return page;
      })
    );
    try {
      for (const video of [publicVideo, privateVideo, unlistedVideo, unavailableVideo]) {
        await attachMediaToRevision({
          recordingRevisionId: (await prisma.recording.findUnique({ where: { id: fixture.recordingId }, select: { currentPublishedRevisionId: true } }))!.currentPublishedRevisionId!,
          provider: "YOUTUBE",
          role: "PRIMARY_VIDEO",
          youtubeVideoId: video.id,
          actorId: fixture.user.id,
        });
      }

      const beforeApproval = await getPublicWorkPageData(fixture.work.slug);
      const slugsBefore = beforeApproval!.videos.map((v) => v.slug);
      expect(slugsBefore).toContain(pages[0].slug); // public
      expect(slugsBefore).not.toContain(pages[1].slug); // private
      expect(slugsBefore).not.toContain(pages[2].slug); // unlisted, unapproved
      expect(slugsBefore).not.toContain(pages[3].slug); // unavailable

      await approveUnlistedPublication(pages[2].id, fixture.user.id);
      const afterApproval = await getPublicWorkPageData(fixture.work.slug);
      expect(afterApproval!.videos.map((v) => v.slug)).toContain(pages[2].slug);
    } finally {
      for (const page of pages) {
        await prisma.auditLogEntry.deleteMany({ where: { entityType: "YouTubeVideoPage", entityId: page.id } });
        await prisma.youTubeVideoPage.delete({ where: { id: page.id } }).catch(() => {});
      }
      for (const video of [publicVideo, privateVideo, unlistedVideo, unavailableVideo]) {
        await prisma.youTubeVideo.delete({ where: { id: video.id } }).catch(() => {});
      }
      await cleanupFixture(fixture);
    }
  });

  it("includes a published Collection but excludes draft and archived Collections", async () => {
    const fixture = await createFixture();
    const collections = await Promise.all([
      createCollection({ slug: uniqueSlug("collection-published"), title: "Published Collection", actorId: fixture.user.id }),
      createCollection({ slug: uniqueSlug("collection-draft"), title: "Draft Collection", actorId: fixture.user.id }),
      createCollection({ slug: uniqueSlug("collection-archived"), title: "Archived Collection", actorId: fixture.user.id }),
    ]);
    try {
      await addRecordingToCollection(collections[0].id, fixture.recordingId, fixture.user.id);
      await publishCollection(collections[0].id, fixture.user.id);

      await addRecordingToCollection(collections[1].id, fixture.recordingId, fixture.user.id);

      await addRecordingToCollection(collections[2].id, fixture.recordingId, fixture.user.id);
      await publishCollection(collections[2].id, fixture.user.id);
      await archiveCollection(collections[2].id, fixture.user.id);

      const data = await getPublicWorkPageData(fixture.work.slug);
      const collectionIds = data!.collections.map((c) => c.id);
      expect(collectionIds).toContain(collections[0].id);
      expect(collectionIds).not.toContain(collections[1].id);
      expect(collectionIds).not.toContain(collections[2].id);
    } finally {
      await cleanupFixture(fixture, { collectionIds: collections.map((c) => c.id) });
    }
  });
});

describe("VENUE — getVenueEntityPageData", () => {
  it("resolves a valid Venue with its Organisation, Performance, Recording, and Work/Composer context", async () => {
    const fixture = await createFixture();
    try {
      const data = await getVenueEntityPageData(fixture.venue.slug);
      expect(data).not.toBeNull();
      expect(data!.name).toBe("Test Venue");
      expect(data!.venueDetails?.type).toBe("CHURCH");
      expect(data!.venueDetails?.organisation?.id).toBe(fixture.organisation.id);
      expect(data!.relatedPerformances.map((p) => p.id)).toContain(fixture.performance.id);
      expect(data!.relatedRecordings.map((r) => r.id)).toContain(fixture.recordingId);
      expect(data!.relatedWorks?.map((w) => w.id)).toContain(fixture.work.id);
      expect(data!.relatedComposers?.map((c) => c.id)).toContain(fixture.composer.id);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("returns null for an unknown slug", async () => {
    expect(await getVenueEntityPageData(uniqueSlug("nonexistent"))).toBeNull();
  });

  it("returns null for an archived Venue", async () => {
    const fixture = await createFixture();
    try {
      await archiveVenue(fixture.venue.id, fixture.user.id);
      expect(await getVenueEntityPageData(fixture.venue.slug)).toBeNull();
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("shows a public video via the venue's performance, and stops showing that performance/recording once the Performance itself is archived", async () => {
    const fixture = await createFixture();
    const video = await createTestVideo();
    const videoPage = await createDraftVideoPage({ youtubeVideoId: video.id, actorId: fixture.user.id });
    await publishVideoPage(videoPage.id, fixture.user.id);
    try {
      const revisionId = (await prisma.recording.findUnique({ where: { id: fixture.recordingId }, select: { currentPublishedRevisionId: true } }))!.currentPublishedRevisionId!;
      await attachMediaToRevision({ recordingRevisionId: revisionId, provider: "YOUTUBE", role: "PRIMARY_VIDEO", youtubeVideoId: video.id, actorId: fixture.user.id });

      const before = await getVenueEntityPageData(fixture.venue.slug);
      expect(before!.relatedVideos.map((v) => v.slug)).toContain(videoPage.slug);
      expect(before!.relatedPerformances.map((p) => p.id)).toContain(fixture.performance.id);

      const { archivePerformance } = await import("../../modules/db/repositories/performanceRepository");
      await archivePerformance(fixture.performance.id, fixture.user.id);

      const after = await getVenueEntityPageData(fixture.venue.slug);
      expect(after!.relatedPerformances.map((p) => p.id)).not.toContain(fixture.performance.id);
      expect(after!.relatedRecordings.map((r) => r.id)).not.toContain(fixture.recordingId);
      expect(after!.relatedVideos.map((v) => v.slug)).not.toContain(videoPage.slug);
    } finally {
      await prisma.auditLogEntry.deleteMany({ where: { entityType: "YouTubeVideoPage", entityId: videoPage.id } });
      await prisma.youTubeVideoPage.delete({ where: { id: videoPage.id } }).catch(() => {});
      await prisma.youTubeVideo.delete({ where: { id: video.id } }).catch(() => {});
      await cleanupFixture(fixture);
    }
  });
});

describe("CROSS-LINKING — slugs consumed by the actual page components resolve to real, existing routes", () => {
  it("Composer -> Work, Work -> Composer, Work -> Recording, Recording -> Work, Recording -> Venue all carry real slugs", async () => {
    const fixture = await createFixture();
    try {
      const composerPage = await getComposerEntityPageData(fixture.composer.slug);
      expect(composerPage!.relatedWorks?.find((w) => w.id === fixture.work.id)?.slug).toBe(fixture.work.slug);
      expect(composerPage!.relatedRecordings.find((r) => r.id === fixture.recordingId)?.slug).toBe(fixture.recordingSlug);
      expect(composerPage!.relatedParticipants.venues.find((v) => v.slug === fixture.venue.slug)).toBeDefined();

      const workPage = await getPublicWorkPageData(fixture.work.slug);
      expect(workPage!.composer.slug).toBe(fixture.composer.slug);
      expect(workPage!.recordings.find((r) => r.id === fixture.recordingId)?.slug).toBe(fixture.recordingSlug);

      const recordingPage = await getPublicRecordingPageData(fixture.recordingSlug);
      expect(recordingPage!.works.find((w) => w.id === fixture.work.id)?.slug).toBe(fixture.work.slug);
      expect(recordingPage!.performance?.venue?.slug).toBe(fixture.venue.slug);

      const venuePage = await getVenueEntityPageData(fixture.venue.slug);
      expect(venuePage!.relatedRecordings.find((r) => r.id === fixture.recordingId)?.slug).toBe(fixture.recordingSlug);
    } finally {
      await cleanupFixture(fixture);
    }
  });
});
