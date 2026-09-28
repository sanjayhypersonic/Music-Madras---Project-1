import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { prisma } from "../../modules/db/client";
import { SlugConflictError } from "../../modules/mmke/slug/SlugConflictError";
import {
  archiveOrganisation,
  createOrganisation,
  findOrganisationBySlug,
} from "../../modules/db/repositories/organisationRepository";
import { createVenue } from "../../modules/db/repositories/venueRepository";
import { createProgramme, addProgrammeItem } from "../../modules/db/repositories/programmeRepository";
import { createComposer } from "../../modules/db/repositories/composerRepository";
import { createMusicalWork } from "../../modules/db/repositories/musicalWorkRepository";
import { createPerformance, addPerformerToPerformance } from "../../modules/db/repositories/performanceRepository";
import { createArtist } from "../../modules/db/repositories/artistRepository";
import {
  createDraftRecording,
  publishCurrentDraft,
  updateDraftRevisionContent,
} from "../../modules/db/repositories/recordingRepository";
import { attachMediaToRevision } from "../../modules/db/repositories/mediaResourceRepository";
import { createDraftVideoPage, publishVideoPage } from "../../modules/db/repositories/youtubeVideoPageRepository";
import { createCollection, addRecordingToCollection, publishCollection } from "../../modules/db/repositories/collectionRepository";
import { createOccasion, attachOccasionToEntity } from "../../modules/db/repositories/occasionRepository";
import { createSource, attachSourceToEntity } from "../../modules/db/repositories/sourceRepository";
import { createRightsInformation, attachRightsInformationToEntity } from "../../modules/db/repositories/rightsInformationRepository";
import {
  getPublicOrganisationPageData,
  getVenueEntityPageData,
  getPublicPerformancePageData,
  getPublicRecordingPageData,
} from "../../modules/db/repositories/entityRelationshipsRepository";
import { searchOrganisations } from "../../modules/db/repositories/archiveSearchRepository";
import sitemap from "../../app/sitemap";
import type { ObservabilityState } from "@prisma/client";

// Phase 6G-14: proves the Organisation slug foundation, the public
// /organisations/[slug] resolver (getPublicOrganisationPageData), archive
// search, sitemap inclusion, and cross-link data (Venue/Performance/
// Recording now exposing organisation.slug) against the real database.
// Real DB, disposable test-prefixed fixtures only.

const TEST_TAG = "phase6g14";
const SITE_ORIGIN = process.env.AUTH_URL ?? "http://localhost:3000";

function uniqueSlug(base: string): string {
  return `${TEST_TAG}-${base}-${randomUUID().slice(0, 8)}`;
}

function uniqueName(base: string): string {
  return `${base} ${randomUUID().slice(0, 8)}`;
}

async function createTestUser() {
  return prisma.studioUser.create({
    data: {
      id: randomUUID(),
      email: `${TEST_TAG}-${randomUUID().slice(0, 8)}@musicmadras.test`,
      name: "Phase 6G-14 Test User",
      role: "EDITOR",
      status: "ACTIVE",
    },
  });
}

async function createTestVideo(overrides: { privacyStatus?: string; observabilityState?: ObservabilityState } = {}) {
  return prisma.youTubeVideo.create({
    data: {
      youtubeVideoId: uniqueSlug("video"),
      title: "Org Test Video",
      thumbnailUrl: "https://i.ytimg.com/vi/test/hqdefault.jpg",
      channelId: `${TEST_TAG}-channel`,
      privacyStatus: overrides.privacyStatus ?? "public",
      observabilityState: overrides.observabilityState ?? "OBSERVED",
    },
  });
}

async function cleanupOrganisation(organisationId: string) {
  await prisma.auditLogEntry.deleteMany({ where: { entityType: "Organisation", entityId: organisationId } });
  await prisma.organisation.delete({ where: { id: organisationId } }).catch(() => {});
}

describe("Organisation slug behaviour against a real database", () => {
  let organisationId: string | null = null;
  let userId: string | null = null;

  afterEach(async () => {
    if (organisationId) {
      await cleanupOrganisation(organisationId).catch(() => {});
      organisationId = null;
    }
    if (userId) {
      await prisma.studioUser.deleteMany({ where: { id: userId } });
      userId = null;
    }
  });

  it("creates an Organisation with a slug and resolves it via findOrganisationBySlug", async () => {
    const user = await createTestUser();
    userId = user.id;
    const slug = uniqueSlug("organisation");

    const organisation = await createOrganisation({ slug, name: uniqueName("Slug Test Organisation"), actorId: user.id });
    organisationId = organisation.id;

    expect(organisation.slug).toBe(slug);
    expect(await findOrganisationBySlug(slug)).not.toBeNull();
  });

  it("rejects a colliding slug for a different Organisation name", async () => {
    const user = await createTestUser();
    userId = user.id;
    const collidingSlug = uniqueSlug("collision");

    const first = await createOrganisation({ slug: collidingSlug, name: uniqueName("First Organisation"), actorId: user.id });
    organisationId = first.id;

    await expect(
      createOrganisation({ slug: collidingSlug, name: uniqueName("Second Organisation"), actorId: user.id })
    ).rejects.toThrow(SlugConflictError);
  });

  it("excludes an archived Organisation from getPublicOrganisationPageData, and it returns null for a nonexistent slug", async () => {
    const user = await createTestUser();
    userId = user.id;
    const organisation = await createOrganisation({ slug: uniqueSlug("archived-org"), name: uniqueName("Archived Organisation"), actorId: user.id });
    organisationId = organisation.id;

    expect(await getPublicOrganisationPageData(organisation.slug)).not.toBeNull();

    await archiveOrganisation(organisation.id, user.id);
    expect(await getPublicOrganisationPageData(organisation.slug)).toBeNull();

    expect(await getPublicOrganisationPageData(uniqueSlug("nonexistent"))).toBeNull();
  });
});

describe("Organisation archive search against a real database", () => {
  let organisationId: string | null = null;
  let userId: string | null = null;

  afterEach(async () => {
    if (organisationId) {
      await cleanupOrganisation(organisationId).catch(() => {});
      organisationId = null;
    }
    if (userId) {
      await prisma.studioUser.deleteMany({ where: { id: userId } });
      userId = null;
    }
  });

  it("finds an active Organisation by name, and excludes it once archived", async () => {
    const user = await createTestUser();
    userId = user.id;
    const marker = randomUUID().slice(0, 8);
    const organisation = await createOrganisation({ slug: uniqueSlug("search"), name: `Searchable ${marker} Organisation`, actorId: user.id });
    organisationId = organisation.id;

    const found = await searchOrganisations(marker, 1, 20);
    expect(found.items.map((o) => o.id)).toContain(organisation.id);

    await archiveOrganisation(organisation.id, user.id);
    const foundAfterArchive = await searchOrganisations(marker, 1, 20);
    expect(foundAfterArchive.items.map((o) => o.id)).not.toContain(organisation.id);
  });
});

describe("Organisation full canonical graph: venue -> performance -> recording -> video/collection/occasion/provenance", () => {
  let organisationId: string | null = null;
  let venueId: string | null = null;
  let programmeId: string | null = null;
  let performanceId: string | null = null;
  let composerId: string | null = null;
  let workId: string | null = null;
  let artistId: string | null = null;
  let recordingId: string | null = null;
  let collectionId: string | null = null;
  let occasionId: string | null = null;
  let sourceId: string | null = null;
  let rightsId: string | null = null;
  let videoId: string | null = null;
  let videoPageId: string | null = null;
  let userId: string | null = null;

  afterEach(async () => {
    if (occasionId) {
      await prisma.entityOccasion.deleteMany({ where: { occasionId } });
      await prisma.auditLogEntry.deleteMany({ where: { entityType: "Occasion", entityId: occasionId } });
      await prisma.occasion.delete({ where: { id: occasionId } }).catch(() => {});
      occasionId = null;
    }
    if (sourceId) {
      await prisma.entitySource.deleteMany({ where: { sourceId } });
      await prisma.auditLogEntry.deleteMany({ where: { entityType: "Source", entityId: sourceId } });
      await prisma.source.delete({ where: { id: sourceId } }).catch(() => {});
      sourceId = null;
    }
    if (rightsId) {
      await prisma.entityRights.deleteMany({ where: { rightsInformationId: rightsId } });
      await prisma.auditLogEntry.deleteMany({ where: { entityType: "RightsInformation", entityId: rightsId } });
      await prisma.rightsInformation.delete({ where: { id: rightsId } }).catch(() => {});
      rightsId = null;
    }
    if (videoPageId) {
      await prisma.auditLogEntry.deleteMany({ where: { entityType: "YouTubeVideoPage", entityId: videoPageId } });
      await prisma.youTubeVideoPage.delete({ where: { id: videoPageId } }).catch(() => {});
      videoPageId = null;
    }
    if (videoId) {
      await prisma.youTubeVideo.delete({ where: { id: videoId } }).catch(() => {});
      videoId = null;
    }
    if (collectionId) {
      await prisma.auditLogEntry.deleteMany({ where: { entityType: "Collection", entityId: collectionId } });
      await prisma.collection.delete({ where: { id: collectionId } }).catch(() => {});
      collectionId = null;
    }
    if (recordingId) {
      const revisions = await prisma.recordingRevision.findMany({ where: { recordingId }, select: { id: true } });
      await prisma.auditLogEntry.deleteMany({ where: { entityType: "Recording", entityId: recordingId } });
      if (revisions.length > 0) {
        await prisma.auditLogEntry.deleteMany({ where: { entityType: "RecordingRevision", entityId: { in: revisions.map((r) => r.id) } } });
      }
      await prisma.recording.delete({ where: { id: recordingId } }).catch(() => {});
      recordingId = null;
    }
    if (performanceId) {
      // Must run before artistId/programmeId/venueId's cleanup:
      // PerformancePerformer (Restrict on artistId) and Performance's own
      // required, Restrict venueId/programmeId FKs all block deleting
      // those rows until this Performance (and its cascaded join rows)
      // is gone first.
      await prisma.auditLogEntry.deleteMany({ where: { entityType: "Performance", entityId: performanceId } });
      await prisma.performance.delete({ where: { id: performanceId } }).catch(() => {});
      performanceId = null;
    }
    if (artistId) {
      await prisma.auditLogEntry.deleteMany({ where: { entityType: "Artist", entityId: artistId } });
      await prisma.artist.delete({ where: { id: artistId } }).catch(() => {});
      artistId = null;
    }
    if (programmeId) {
      // Must run before workId's cleanup: ProgrammeItem (Restrict on
      // musicalWorkId) blocks deleting the MusicalWork until the
      // Programme's own delete cascades ProgrammeItem away first.
      await prisma.auditLogEntry.deleteMany({ where: { entityType: "Programme", entityId: programmeId } });
      await prisma.programme.delete({ where: { id: programmeId } }).catch(() => {});
      programmeId = null;
    }
    if (workId) {
      await prisma.auditLogEntry.deleteMany({ where: { entityType: "MusicalWork", entityId: workId } });
      await prisma.musicalWork.delete({ where: { id: workId } }).catch(() => {});
      workId = null;
    }
    if (composerId) {
      await prisma.auditLogEntry.deleteMany({ where: { entityType: "Composer", entityId: composerId } });
      await prisma.composer.delete({ where: { id: composerId } }).catch(() => {});
      composerId = null;
    }
    if (venueId) {
      await prisma.auditLogEntry.deleteMany({ where: { entityType: "Venue", entityId: venueId } });
      await prisma.venue.delete({ where: { id: venueId } }).catch(() => {});
      venueId = null;
    }
    if (organisationId) {
      await cleanupOrganisation(organisationId).catch(() => {});
      organisationId = null;
    }
    if (userId) {
      await prisma.studioUser.deleteMany({ where: { id: userId } });
      userId = null;
    }
  });

  it("resolves the full canonical graph derived transitively through Venue.organisationId, and never surfaces an unrelated video", async () => {
    const user = await createTestUser();
    userId = user.id;

    const organisation = await createOrganisation({ slug: uniqueSlug("madras-choral-trust"), name: uniqueName("Madras Choral Trust"), actorId: user.id });
    organisationId = organisation.id;

    const venue = await createVenue({
      slug: uniqueSlug("venue"),
      name: uniqueName("Org Test Venue"),
      type: "CHURCH",
      organisationId: organisation.id,
      actorId: user.id,
    });
    venueId = venue.id;

    const composer = await createComposer({ slug: uniqueSlug("composer"), name: uniqueName("Org Test Composer"), actorId: user.id });
    composerId = composer.id;
    const work = await createMusicalWork({ slug: uniqueSlug("work"), title: "Org Test Work", composerId: composer.id, actorId: user.id });
    workId = work.id;
    const programme = await createProgramme({ slug: uniqueSlug("programme"), title: "Org Test Programme", actorId: user.id });
    programmeId = programme.id;
    await addProgrammeItem({ programmeId: programme.id, musicalWorkId: work.id, actorId: user.id });
    const performance = await createPerformance({ programmeId: programme.id, venueId: venue.id, performanceDate: new Date("2021-05-05"), actorId: user.id });
    performanceId = performance.id;
    const artist = await createArtist({ slug: uniqueSlug("artist"), name: uniqueName("Org Test Artist"), actorId: user.id });
    artistId = artist.id;
    await addPerformerToPerformance(performance.id, artist.id, "Soloist", user.id);

    const draft = await createDraftRecording({ slug: uniqueSlug("recording"), actorId: user.id, title: "Org Test Recording" });
    await updateDraftRevisionContent(draft.id, draft.currentDraftRevision!.updatedAt, user.id, { performanceId: performance.id });
    const recording = await publishCurrentDraft(draft.id, user.id);
    recordingId = recording.id;

    const video = await createTestVideo();
    videoId = video.id;
    const videoPage = await createDraftVideoPage({ youtubeVideoId: video.id, actorId: user.id });
    videoPageId = videoPage.id;
    await publishVideoPage(videoPage.id, user.id);
    await attachMediaToRevision({
      recordingRevisionId: recording.currentPublishedRevisionId as string,
      provider: "YOUTUBE",
      role: "PRIMARY_VIDEO",
      youtubeVideoId: video.id,
      actorId: user.id,
    });

    const collection = await createCollection({ slug: uniqueSlug("collection"), title: "Org Test Collection", actorId: user.id });
    collectionId = collection.id;
    await addRecordingToCollection(collection.id, recording.id, user.id);
    await publishCollection(collection.id, user.id);

    const occasion = await createOccasion({ slug: uniqueSlug("occasion"), name: uniqueName("Org Test Occasion"), actorId: user.id });
    occasionId = occasion.id;
    await attachOccasionToEntity({ entityType: "PERFORMANCE", entityId: performance.id, occasionId: occasion.id, actorId: user.id });

    const source = await createSource({ title: uniqueName("Org Test Source"), actorId: user.id });
    sourceId = source.id;
    await attachSourceToEntity({ entityType: "RECORDING", entityId: recording.id, sourceId: source.id, actorId: user.id });

    const rights = await createRightsInformation({ holder: uniqueName("Org Test Rights Holder"), actorId: user.id });
    rightsId = rights.id;
    await attachRightsInformationToEntity({ entityType: "RECORDING", entityId: recording.id, rightsInformationId: rights.id, actorId: user.id });

    // An unrelated video (no canonical MediaResource link at all) must never appear.
    const unrelatedVideo = await createTestVideo();
    const unrelatedVideoPage = await createDraftVideoPage({ youtubeVideoId: unrelatedVideo.id, actorId: user.id });
    await publishVideoPage(unrelatedVideoPage.id, user.id);

    try {
      const page = await getPublicOrganisationPageData(organisation.slug);
      expect(page).not.toBeNull();
      expect(page!.name).toBe(organisation.name);
      expect(page!.venues.map((v) => v.id)).toEqual([venue.id]);
      expect(page!.programmes.map((p) => p.id)).toContain(programme.id);
      expect(page!.performances.map((p) => p.id)).toContain(performance.id);
      expect(page!.recordings.map((r) => r.id)).toContain(recording.id);
      expect(page!.collections.map((c) => c.id)).toContain(collection.id);
      expect(page!.occasions.map((o) => o.id)).toContain(occasion.id);
      expect(page!.relatedParticipants.artists.map((a) => a.slug)).toContain(artist.slug);
      expect(page!.videos.map((v) => v.slug)).toContain(videoPage.slug);
      expect(page!.videos.map((v) => v.slug)).not.toContain(unrelatedVideoPage.slug);
      expect(page!.sources.map((s) => s.id)).toContain(source.id);
      expect(page!.rights.map((r) => r.id)).toContain(rights.id);

      // Cross-link data: Venue/Performance/Recording pages now expose organisation.slug.
      const venuePage = await getVenueEntityPageData(venue.slug);
      expect(venuePage?.venueDetails?.organisation?.slug).toBe(organisation.slug);

      const performancePage = await getPublicPerformancePageData(performance.slug);
      expect(performancePage?.venue.organisation?.slug).toBe(organisation.slug);

      const recordingPage = await getPublicRecordingPageData(recording.slug);
      expect(recordingPage?.performance?.venue?.organisation?.slug).toBe(organisation.slug);

      // Sitemap inclusion.
      const entries = await sitemap();
      expect(entries.map((e) => e.url)).toContain(`${SITE_ORIGIN}/organisations/${organisation.slug}`);
    } finally {
      await prisma.auditLogEntry.deleteMany({ where: { entityType: "YouTubeVideoPage", entityId: unrelatedVideoPage.id } });
      await prisma.youTubeVideoPage.delete({ where: { id: unrelatedVideoPage.id } }).catch(() => {});
      await prisma.youTubeVideo.delete({ where: { id: unrelatedVideo.id } }).catch(() => {});
    }
  });

  it("resolves an Organisation with no Venues to an empty-but-valid page (never throws)", async () => {
    const user = await createTestUser();
    userId = user.id;
    const organisation = await createOrganisation({ slug: uniqueSlug("empty-org"), name: uniqueName("Empty Organisation"), actorId: user.id });
    organisationId = organisation.id;

    const page = await getPublicOrganisationPageData(organisation.slug);
    expect(page).not.toBeNull();
    expect(page!.venues).toEqual([]);
    expect(page!.performances).toEqual([]);
    expect(page!.recordings).toEqual([]);
    expect(page!.videos).toEqual([]);
    expect(page!.occasions).toEqual([]);
    expect(page!.sources).toEqual([]);
    expect(page!.rights).toEqual([]);
  });
});
