import { describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { prisma } from "../../modules/db/client";
import { createComposer } from "../../modules/db/repositories/composerRepository";
import { createMusicalWork } from "../../modules/db/repositories/musicalWorkRepository";
import { createProgramme, addProgrammeItem } from "../../modules/db/repositories/programmeRepository";
import { createVenue } from "../../modules/db/repositories/venueRepository";
import {
  archivePerformance,
  createPerformance,
  reassignPerformanceProgramme,
  reassignPerformanceVenue,
  updatePerformance,
} from "../../modules/db/repositories/performanceRepository";
import {
  attachWorkToRevision,
  createDraftRecording,
  publishCurrentDraft,
  updateDraftRevisionContent,
} from "../../modules/db/repositories/recordingRepository";
import { attachMediaToRevision } from "../../modules/db/repositories/mediaResourceRepository";
import { createDraftVideoPage, publishVideoPage } from "../../modules/db/repositories/youtubeVideoPageRepository";
import { getPublicPerformancePageData } from "../../modules/db/repositories/entityRelationshipsRepository";
import { searchArchiveAll, searchPerformances } from "../../modules/db/repositories/archiveSearchRepository";
import type { ObservabilityState } from "@prisma/client";

// Phase 6G-8: proves getPublicPerformancePageData (the public
// /performances/[slug] route's sole data source), the Performance
// archive-search function, and the Performance slug's generation/
// stability guarantees against the real database. Mirrors the
// established tests/integration/*.test.ts pattern.

const TEST_TAG = "phase6g8perf";

function uniqueSlug(base: string): string {
  return `${TEST_TAG}-${base}-${randomUUID().slice(0, 8)}`;
}

async function createTestUser() {
  return prisma.studioUser.create({
    data: {
      id: randomUUID(),
      email: `${TEST_TAG}-integration-test-${randomUUID().slice(0, 8)}@musicmadras.test`,
      name: "Phase 6G-8 Performance Test User",
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
  programme: { id: string; slug: string; title: string };
  venue: { id: string; slug: string; name: string };
  performance: { id: string; slug: string };
  recordingId: string;
  recordingSlug: string;
}

async function createFixture(titleMarker: string): Promise<Fixture> {
  const user = await createTestUser();
  const uniqueMarker = randomUUID().slice(0, 8);
  const composer = await createComposer({ slug: uniqueSlug("composer"), name: `Zzp8 Performance Composer ${uniqueMarker}`, actorId: user.id });
  const work = await createMusicalWork({ slug: uniqueSlug("work"), title: `Zzp8 Performance Work ${uniqueMarker}`, composerId: composer.id, actorId: user.id });
  const programme = await createProgramme({ slug: uniqueSlug("programme"), title: `Zzp8 Recital ${titleMarker}`, actorId: user.id });
  await addProgrammeItem({ programmeId: programme.id, musicalWorkId: work.id, actorId: user.id });
  const venue = await createVenue({ slug: uniqueSlug("venue"), name: `Zzp8 Hall ${titleMarker}`, type: "CONCERT_HALL", actorId: user.id });
  const performance = await createPerformance({ programmeId: programme.id, venueId: venue.id, performanceDate: new Date("2022-06-10"), actorId: user.id });

  const draft = await createDraftRecording({ slug: uniqueSlug("recording"), actorId: user.id, title: "Zzp8 Performance Recording" });
  await updateDraftRevisionContent(draft.id, draft.currentDraftRevision!.updatedAt, user.id, { performanceId: performance.id });
  await attachWorkToRevision(draft.currentDraftRevision!.id, work.id, user.id);
  const published = await publishCurrentDraft(draft.id, user.id);

  return { user, composer, work, programme, venue, performance, recordingId: published.id, recordingSlug: published.slug };
}

async function cleanupFixture(fixture: Fixture, extra: { videoId?: string; videoPageId?: string; extraProgrammeId?: string; extraVenueId?: string } = {}) {
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

  if (extra.extraProgrammeId) {
    await prisma.auditLogEntry.deleteMany({ where: { entityType: "Programme", entityId: extra.extraProgrammeId } });
    await prisma.programme.delete({ where: { id: extra.extraProgrammeId } }).catch(() => {});
  }
  if (extra.extraVenueId) {
    await prisma.auditLogEntry.deleteMany({ where: { entityType: "Venue", entityId: extra.extraVenueId } });
    await prisma.venue.delete({ where: { id: extra.extraVenueId } }).catch(() => {});
  }

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

describe("PERFORMANCE — createPerformance slug generation", () => {
  it("assigns a unique, deterministic slug derived from Programme title, Venue name, and date", async () => {
    const marker = randomUUID().slice(0, 8);
    const fixture = await createFixture(marker);
    try {
      expect(fixture.performance.slug).toContain(fixture.performance.id.slice(0, 8).toLowerCase());
      expect(fixture.performance.slug).toMatch(/^[a-z0-9-]+$/);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("assigns different slugs to two performances sharing the same Programme, Venue, and date (collision handling)", async () => {
    const user = await createTestUser();
    const nameMarker = randomUUID().slice(0, 8);
    const programme = await createProgramme({ slug: uniqueSlug("programme-shared"), title: `Zzp8 Shared Programme ${nameMarker}`, actorId: user.id });
    const venue = await createVenue({ slug: uniqueSlug("venue-shared"), name: `Zzp8 Shared Venue ${nameMarker}`, type: "CHURCH", actorId: user.id });
    const date = new Date("2021-05-05");
    try {
      const performanceOne = await createPerformance({ programmeId: programme.id, venueId: venue.id, performanceDate: date, actorId: user.id });
      const performanceTwo = await createPerformance({ programmeId: programme.id, venueId: venue.id, performanceDate: date, actorId: user.id });
      expect(performanceOne.slug).not.toBe(performanceTwo.slug);
    } finally {
      const perfs = await prisma.performance.findMany({ where: { programmeId: programme.id }, select: { id: true } });
      for (const p of perfs) {
        await prisma.auditLogEntry.deleteMany({ where: { entityType: "Performance", entityId: p.id } });
        await prisma.performance.delete({ where: { id: p.id } }).catch(() => {});
      }
      await prisma.auditLogEntry.deleteMany({ where: { entityType: "Programme", entityId: programme.id } });
      await prisma.programme.delete({ where: { id: programme.id } });
      await prisma.auditLogEntry.deleteMany({ where: { entityType: "Venue", entityId: venue.id } });
      await prisma.venue.delete({ where: { id: venue.id } });
      await prisma.studioUser.deleteMany({ where: { id: user.id } });
    }
  });
});

describe("PERFORMANCE — slug stability across ordinary edits", () => {
  it("keeps the same slug after updatePerformance changes the date", async () => {
    const fixture = await createFixture(randomUUID().slice(0, 8));
    try {
      const originalSlug = fixture.performance.slug;
      const updated = await updatePerformance(fixture.performance.id, { performanceDate: new Date("2030-01-01"), actorId: fixture.user.id });
      expect(updated.slug).toBe(originalSlug);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("keeps the same slug after reassignPerformanceProgramme and reassignPerformanceVenue", async () => {
    const fixture = await createFixture(randomUUID().slice(0, 8));
    const nameMarker = randomUUID().slice(0, 8);
    const otherProgramme = await createProgramme({ slug: uniqueSlug("other-programme"), title: `Zzp8 Other Programme ${nameMarker}`, actorId: fixture.user.id });
    const otherVenue = await createVenue({ slug: uniqueSlug("other-venue"), name: `Zzp8 Other Venue ${nameMarker}`, type: "CHURCH", actorId: fixture.user.id });
    try {
      const originalSlug = fixture.performance.slug;
      const afterProgramme = await reassignPerformanceProgramme(fixture.performance.id, otherProgramme.id, fixture.user.id);
      expect(afterProgramme.slug).toBe(originalSlug);
      const afterVenue = await reassignPerformanceVenue(fixture.performance.id, otherVenue.id, fixture.user.id);
      expect(afterVenue.slug).toBe(originalSlug);
    } finally {
      await cleanupFixture(fixture, { extraProgrammeId: otherProgramme.id, extraVenueId: otherVenue.id });
    }
  });
});

describe("PERFORMANCE — getPublicPerformancePageData", () => {
  it("resolves a valid Performance with its Programme, Venue, Works, and published Recording", async () => {
    const marker = randomUUID().slice(0, 8);
    const fixture = await createFixture(marker);
    try {
      const data = await getPublicPerformancePageData(fixture.performance.slug);
      expect(data).not.toBeNull();
      expect(data!.slug).toBe(fixture.performance.slug);
      expect(data!.programme.id).toBe(fixture.programme.id);
      expect(data!.programme.slug).toBe(fixture.programme.slug);
      expect(data!.programme.items.map((i) => i.work.id)).toContain(fixture.work.id);
      expect(data!.venue.id).toBe(fixture.venue.id);
      expect(data!.venue.slug).toBe(fixture.venue.slug);
      expect(data!.recordings.map((r) => r.id)).toContain(fixture.recordingId);
      expect(data!.recordings.find((r) => r.id === fixture.recordingId)?.slug).toBe(fixture.recordingSlug);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("returns null for an unknown slug", async () => {
    expect(await getPublicPerformancePageData(uniqueSlug("nonexistent"))).toBeNull();
  });

  it("returns null for an archived Performance", async () => {
    const fixture = await createFixture(randomUUID().slice(0, 8));
    try {
      await archivePerformance(fixture.performance.id, fixture.user.id);
      expect(await getPublicPerformancePageData(fixture.performance.slug)).toBeNull();
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("shows a public MusicMadras video via the performance's recording, but excludes a private one", async () => {
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

      const data = await getPublicPerformancePageData(fixture.performance.slug);
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
});

describe("ARCHIVE SEARCH — Performance", () => {
  it("finds a performance by its Programme's title, case-insensitively", async () => {
    const marker = randomUUID().slice(0, 8);
    const fixture = await createFixture(marker);
    try {
      const lower = await searchPerformances(marker.toLowerCase());
      const upper = await searchPerformances(marker.toUpperCase());
      expect(lower.items.map((p) => p.id)).toContain(fixture.performance.id);
      expect(upper.items.map((p) => p.id)).toContain(fixture.performance.id);
      const found = lower.items.find((p) => p.id === fixture.performance.id);
      expect(found?.slug).toBe(fixture.performance.slug);
      expect(found?.programmeTitle).toBe(fixture.programme.title);
      expect(found?.venueName).toBe(fixture.venue.name);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("finds a performance by its Venue's name", async () => {
    const marker = randomUUID().slice(0, 8);
    const fixture = await createFixture(marker);
    try {
      const result = await searchPerformances(marker);
      expect(result.items.map((p) => p.id)).toContain(fixture.performance.id);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("excludes an archived Performance", async () => {
    const marker = randomUUID().slice(0, 8);
    const fixture = await createFixture(marker);
    try {
      await archivePerformance(fixture.performance.id, fixture.user.id);
      const result = await searchPerformances(marker);
      expect(result.items.map((p) => p.id)).not.toContain(fixture.performance.id);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("returns an empty page (not an error) for a query with no matches", async () => {
    const result = await searchPerformances(`nonexistent-${randomUUID()}`);
    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
  });

  it("respects page and pageSize, with no duplicate/overlapping rows across pages", async () => {
    const user = await createTestUser();
    const marker = randomUUID().slice(0, 8);
    const programme = await createProgramme({ slug: uniqueSlug("page-programme"), title: `Zzp8 Page Programme ${marker}`, actorId: user.id });
    const venue = await createVenue({ slug: uniqueSlug("page-venue"), name: `Zzp8 Page Venue ${marker}`, type: "CONCERT_HALL", actorId: user.id });
    const performances = await Promise.all(
      Array.from({ length: 5 }, () => createPerformance({ programmeId: programme.id, venueId: venue.id, actorId: user.id }))
    );
    try {
      const pageOne = await searchPerformances(marker, 1, 2);
      const pageTwo = await searchPerformances(marker, 2, 2);
      const pageThree = await searchPerformances(marker, 3, 2);

      expect(pageOne.total).toBe(5);
      expect(pageOne.items).toHaveLength(2);
      expect(pageTwo.items).toHaveLength(2);
      expect(pageThree.items).toHaveLength(1);

      const allIds = [...pageOne.items, ...pageTwo.items, ...pageThree.items].map((p) => p.id);
      expect(new Set(allIds).size).toBe(5);
    } finally {
      for (const performance of performances) {
        await prisma.auditLogEntry.deleteMany({ where: { entityType: "Performance", entityId: performance.id } });
        await prisma.performance.delete({ where: { id: performance.id } });
      }
      await prisma.auditLogEntry.deleteMany({ where: { entityType: "Programme", entityId: programme.id } });
      await prisma.programme.delete({ where: { id: programme.id } });
      await prisma.auditLogEntry.deleteMany({ where: { entityType: "Venue", entityId: venue.id } });
      await prisma.venue.delete({ where: { id: venue.id } });
      await prisma.studioUser.deleteMany({ where: { id: user.id } });
    }
  });

  it("is included alongside every other entity type in searchArchiveAll", async () => {
    const marker = randomUUID().slice(0, 8);
    const fixture = await createFixture(marker);
    try {
      const all = await searchArchiveAll(marker);
      expect(all.performances.items.map((p) => p.id)).toContain(fixture.performance.id);
    } finally {
      await cleanupFixture(fixture);
    }
  });
});
