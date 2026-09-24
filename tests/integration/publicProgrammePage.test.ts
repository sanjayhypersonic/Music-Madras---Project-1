import { describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { prisma } from "../../modules/db/client";
import { createComposer } from "../../modules/db/repositories/composerRepository";
import { createMusicalWork } from "../../modules/db/repositories/musicalWorkRepository";
import { addProgrammeItem, archiveProgramme, createProgramme } from "../../modules/db/repositories/programmeRepository";
import { createVenue } from "../../modules/db/repositories/venueRepository";
import { archivePerformance, createPerformance } from "../../modules/db/repositories/performanceRepository";
import {
  attachWorkToRevision,
  createDraftRecording,
  publishCurrentDraft,
  updateDraftRevisionContent,
} from "../../modules/db/repositories/recordingRepository";
import { attachMediaToRevision } from "../../modules/db/repositories/mediaResourceRepository";
import { createDraftVideoPage, publishVideoPage } from "../../modules/db/repositories/youtubeVideoPageRepository";
import { getPublicProgrammePageData } from "../../modules/db/repositories/entityRelationshipsRepository";
import { searchArchiveAll, searchProgrammes } from "../../modules/db/repositories/archiveSearchRepository";
import type { ObservabilityState } from "@prisma/client";

// Phase 6G-8: proves getPublicProgrammePageData (the public
// /programmes/[slug] route's sole data source) and the new Programme
// archive-search functions against the real database. Mirrors the
// established tests/integration/*.test.ts pattern (see
// publicWorkVenuePages.test.ts). Real DB, disposable test-prefixed
// fixtures only.

const TEST_TAG = "phase6g8";

function uniqueSlug(base: string): string {
  return `${TEST_TAG}-${base}-${randomUUID().slice(0, 8)}`;
}

// A unique email per call — see tests/integration/archiveSearch.test.ts's
// comment for why this deliberately deviates from the shared-TEST_EMAIL
// convention (avoids a Vitest-timeout-orphaned-promise unique-constraint
// race between tests in the same file).
async function createTestUser() {
  return prisma.studioUser.create({
    data: {
      id: randomUUID(),
      email: `${TEST_TAG}-integration-test-${randomUUID().slice(0, 8)}@musicmadras.test`,
      name: "Phase 6G-8 Test User",
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
  composer: { id: string; slug: string };
  work: { id: string; slug: string };
  programme: { id: string; slug: string };
  venue: { id: string; slug: string };
  performance: { id: string };
  recordingId: string;
  recordingSlug: string;
}

async function createFixture(titleMarker: string): Promise<Fixture> {
  const user = await createTestUser();
  const nameMarker = randomUUID().slice(0, 8);
  const composer = await createComposer({ slug: uniqueSlug("composer"), name: `Zzqa Programme Composer ${nameMarker}`, actorId: user.id });
  const work = await createMusicalWork({ slug: uniqueSlug("work"), title: `Zzqa Programme Work ${nameMarker}`, composerId: composer.id, actorId: user.id });
  const programme = await createProgramme({ slug: uniqueSlug("programme"), title: `Zzqa Concert ${titleMarker}`, actorId: user.id });
  await addProgrammeItem({ programmeId: programme.id, musicalWorkId: work.id, movement: "I. Allegro", actorId: user.id });
  const venue = await createVenue({ slug: uniqueSlug("venue"), name: `Zzqa Programme Venue ${nameMarker}`, type: "CHURCH", actorId: user.id });
  const performance = await createPerformance({ programmeId: programme.id, venueId: venue.id, performanceDate: new Date("2021-03-01"), actorId: user.id });

  const draft = await createDraftRecording({ slug: uniqueSlug("recording"), actorId: user.id, title: "Zzqa Programme Recording" });
  await updateDraftRevisionContent(draft.id, draft.currentDraftRevision!.updatedAt, user.id, { performanceId: performance.id });
  await attachWorkToRevision(draft.currentDraftRevision!.id, work.id, user.id);
  const published = await publishCurrentDraft(draft.id, user.id);

  return { user, composer, work, programme, venue, performance, recordingId: published.id, recordingSlug: published.slug };
}

async function cleanupFixture(fixture: Fixture, extra: { videoId?: string; videoPageId?: string } = {}) {
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

describe("PROGRAMME — getPublicProgrammePageData", () => {
  it("resolves a valid Programme with its Works, Performance, and published Recording", async () => {
    const marker = randomUUID().slice(0, 8);
    const fixture = await createFixture(marker);
    try {
      const data = await getPublicProgrammePageData(fixture.programme.slug);
      expect(data).not.toBeNull();
      expect(data!.title).toBe(`Zzqa Concert ${marker}`);
      expect(data!.items.map((i) => i.work.id)).toContain(fixture.work.id);
      expect(data!.items.find((i) => i.work.id === fixture.work.id)?.work.composer.id).toBe(fixture.composer.id);
      expect(data!.items.find((i) => i.work.id === fixture.work.id)?.movement).toBe("I. Allegro");
      expect(data!.performances.map((p) => p.id)).toContain(fixture.performance.id);
      expect(data!.performances[0].venue?.slug).toBe(fixture.venue.slug);
      expect(data!.recordings.map((r) => r.id)).toContain(fixture.recordingId);
      expect(data!.recordings.find((r) => r.id === fixture.recordingId)?.slug).toBe(fixture.recordingSlug);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("returns null for an unknown slug", async () => {
    expect(await getPublicProgrammePageData(uniqueSlug("nonexistent"))).toBeNull();
  });

  it("returns null for an archived Programme", async () => {
    const fixture = await createFixture(randomUUID().slice(0, 8));
    try {
      await archiveProgramme(fixture.programme.id, fixture.user.id);
      expect(await getPublicProgrammePageData(fixture.programme.slug)).toBeNull();
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("stops showing a Performance/Recording once the Performance itself is archived", async () => {
    const fixture = await createFixture(randomUUID().slice(0, 8));
    try {
      const before = await getPublicProgrammePageData(fixture.programme.slug);
      expect(before!.performances.map((p) => p.id)).toContain(fixture.performance.id);
      expect(before!.recordings.map((r) => r.id)).toContain(fixture.recordingId);

      await archivePerformance(fixture.performance.id, fixture.user.id);

      const after = await getPublicProgrammePageData(fixture.programme.slug);
      expect(after!.performances.map((p) => p.id)).not.toContain(fixture.performance.id);
      expect(after!.recordings.map((r) => r.id)).not.toContain(fixture.recordingId);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("shows a public MusicMadras video via the programme's performance/recording, but excludes a private one", async () => {
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

      const data = await getPublicProgrammePageData(fixture.programme.slug);
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

  it("returns a Programme with empty performances/recordings/videos when none have been catalogued (missing relationships, not an error)", async () => {
    const user = await createTestUser();
    const programme = await createProgramme({ slug: uniqueSlug("programme-bare"), title: "Zzqa Bare Programme", actorId: user.id });
    try {
      const data = await getPublicProgrammePageData(programme.slug);
      expect(data).not.toBeNull();
      expect(data!.items).toEqual([]);
      expect(data!.performances).toEqual([]);
      expect(data!.recordings).toEqual([]);
      expect(data!.videos).toEqual([]);
      expect(data!.collections).toEqual([]);
    } finally {
      await prisma.auditLogEntry.deleteMany({ where: { entityType: "Programme", entityId: programme.id } });
      await prisma.programme.delete({ where: { id: programme.id } });
      await prisma.studioUser.deleteMany({ where: { id: user.id } });
    }
  });
});

describe("ARCHIVE SEARCH — Programme", () => {
  it("finds a programme by a case-insensitive partial title match", async () => {
    const marker = randomUUID().slice(0, 8);
    const fixture = await createFixture(marker);
    try {
      const lower = await searchProgrammes(marker.toLowerCase());
      const upper = await searchProgrammes(marker.toUpperCase());
      expect(lower.items.map((p) => p.id)).toContain(fixture.programme.id);
      expect(upper.items.map((p) => p.id)).toContain(fixture.programme.id);
      const found = lower.items.find((p) => p.id === fixture.programme.id);
      expect(found?.slug).toBe(fixture.programme.slug);
      expect(found?.workTitles.some((title) => title.startsWith("Zzqa Programme Work"))).toBe(true);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("excludes an archived Programme", async () => {
    const marker = randomUUID().slice(0, 8);
    const fixture = await createFixture(marker);
    try {
      await archiveProgramme(fixture.programme.id, fixture.user.id);
      const result = await searchProgrammes(marker);
      expect(result.items.map((p) => p.id)).not.toContain(fixture.programme.id);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("returns an empty page (not an error) for a query with no matches", async () => {
    const result = await searchProgrammes(`nonexistent-${randomUUID()}`);
    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
  });

  it("respects page and pageSize, with no duplicate/overlapping rows across pages", async () => {
    const user = await createTestUser();
    const marker = randomUUID().slice(0, 8);
    const programmes = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        createProgramme({ slug: uniqueSlug(`page-programme-${i}`), title: `Zzqa Page Programme ${marker} ${i}`, actorId: user.id })
      )
    );
    try {
      const pageOne = await searchProgrammes(marker, 1, 2);
      const pageTwo = await searchProgrammes(marker, 2, 2);
      const pageThree = await searchProgrammes(marker, 3, 2);

      expect(pageOne.total).toBe(5);
      expect(pageOne.items).toHaveLength(2);
      expect(pageTwo.items).toHaveLength(2);
      expect(pageThree.items).toHaveLength(1);

      const allIds = [...pageOne.items, ...pageTwo.items, ...pageThree.items].map((p) => p.id);
      expect(new Set(allIds).size).toBe(5);
    } finally {
      for (const programme of programmes) {
        await prisma.auditLogEntry.deleteMany({ where: { entityType: "Programme", entityId: programme.id } });
        await prisma.programme.delete({ where: { id: programme.id } });
      }
      await prisma.studioUser.deleteMany({ where: { id: user.id } });
    }
  });

  it("is included alongside every other entity type in searchArchiveAll", async () => {
    const marker = randomUUID().slice(0, 8);
    const fixture = await createFixture(marker);
    try {
      const all = await searchArchiveAll(marker);
      expect(all.programmes.items.map((p) => p.id)).toContain(fixture.programme.id);
      expect(all.composers.items.map((c) => c.id)).toEqual([]); // marker only appears in the programme title, not the composer name
    } finally {
      await cleanupFixture(fixture);
    }
  });
});
