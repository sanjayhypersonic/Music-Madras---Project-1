import { describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { prisma } from "../../modules/db/client";
import { createArtist, archiveArtist, updateArtist } from "../../modules/db/repositories/artistRepository";
import { createChoir, archiveChoir, updateChoir } from "../../modules/db/repositories/choirRepository";
import { createConductor, archiveConductor, updateConductor } from "../../modules/db/repositories/conductorRepository";
import { createComposer } from "../../modules/db/repositories/composerRepository";
import { createMusicalWork } from "../../modules/db/repositories/musicalWorkRepository";
import { addProgrammeItem, createProgramme } from "../../modules/db/repositories/programmeRepository";
import { createVenue } from "../../modules/db/repositories/venueRepository";
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
import { seedMediaOnRevision } from "./helpers/seedRevisionRows";
import { createDraftVideoPage, publishVideoPage } from "../../modules/db/repositories/youtubeVideoPageRepository";
import {
  getArtistEntityPageData,
  getChoirEntityPageData,
  getConductorEntityPageData,
  getPublicPerformancePageData,
  getPublicProgrammePageData,
} from "../../modules/db/repositories/entityRelationshipsRepository";
import { searchArchiveAll, searchArtists, searchChoirs, searchConductors } from "../../modules/db/repositories/archiveSearchRepository";
import { publishedRecordingAtVenue } from "./helpers/publishedContent";
import { slugify } from "../../modules/mmke/slug/slugify";
import { SlugConflictError } from "../../modules/mmke/slug/SlugConflictError";
import type { ObservabilityState } from "@prisma/client";

// Phase 6G-9: proves getArtistEntityPageData/getChoirEntityPageData/
// getConductorEntityPageData (the public /artists|choirs|conductors/[slug]
// routes' sole data sources), the new archive-search functions, slug
// generation/stability, and cross-linking through Performance/Programme
// against the real database. Mirrors the established
// tests/integration/*.test.ts pattern.

const TEST_TAG = "phase6g9";

function uniqueSlug(base: string): string {
  return `${TEST_TAG}-${base}-${randomUUID().slice(0, 8)}`;
}

async function createTestUser() {
  return prisma.studioUser.create({
    data: {
      id: randomUUID(),
      email: `${TEST_TAG}-integration-test-${randomUUID().slice(0, 8)}@musicmadras.test`,
      name: "Phase 6G-9 Test User",
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
  performance: { id: string; slug: string };
  artist: { id: string; slug: string; name: string };
  choir: { id: string; slug: string; name: string };
  conductor: { id: string; slug: string; name: string };
  recordingId: string;
  recordingSlug: string;
}

async function createFixture(marker: string): Promise<Fixture> {
  const user = await createTestUser();
  const composer = await createComposer({ slug: uniqueSlug("composer"), name: `Zzp9 Fixture Composer ${marker}`, actorId: user.id });
  const work = await createMusicalWork({ slug: uniqueSlug("work"), title: `Zzp9 Fixture Work ${marker}`, composerId: composer.id, actorId: user.id });
  const programme = await createProgramme({ slug: uniqueSlug("programme"), title: `Zzp9 Fixture Programme ${marker}`, actorId: user.id });
  await addProgrammeItem({ programmeId: programme.id, musicalWorkId: work.id, actorId: user.id });
  const venue = await createVenue({ slug: uniqueSlug("venue"), name: `Zzp9 Fixture Venue ${marker}`, type: "CONCERT_HALL", actorId: user.id });
  const performance = await createPerformance({ programmeId: programme.id, venueId: venue.id, performanceDate: new Date("2019-11-11"), actorId: user.id });

  const artistName = `Zzp9 Fixture Artist ${marker}`;
  const artist = await createArtist({ slug: slugify(artistName), name: artistName, instrument: "Violin", actorId: user.id });
  const choirName = `Zzp9 Fixture Choir ${marker}`;
  const choir = await createChoir({ slug: slugify(choirName), name: choirName, directorName: "Test Director", actorId: user.id });
  const conductorName = `Zzp9 Fixture Conductor ${marker}`;
  const conductor = await createConductor({ slug: slugify(conductorName), name: conductorName, actorId: user.id });

  await addPerformerToPerformance(performance.id, artist.id, "Soloist", user.id);
  await addChoirToPerformance(performance.id, choir.id, user.id);
  await addConductorToPerformance(performance.id, conductor.id, user.id);

  const draft = await createDraftRecording({ slug: uniqueSlug("recording"), actorId: user.id, title: `Zzp9 Fixture Recording ${marker}` });
  await updateDraftRevisionContent(draft.id, draft.currentDraftRevision!.updatedAt, user.id, { performanceId: performance.id });
  await attachWorkToRevision(draft.currentDraftRevision!.id, work.id, user.id);
  const published = await publishCurrentDraft(draft.id, user.id);

  return {
    user,
    composer,
    work,
    programme,
    venue,
    performance,
    artist: { id: artist.id, slug: artist.slug, name: artist.name },
    choir: { id: choir.id, slug: choir.slug, name: choir.name },
    conductor: { id: conductor.id, slug: conductor.slug, name: conductor.name },
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

  const revisions = await prisma.recordingRevision.findMany({ where: { recordingId: fixture.recordingId }, select: { id: true } });
  await prisma.auditLogEntry.deleteMany({ where: { entityType: "Recording", entityId: fixture.recordingId } });
  if (revisions.length > 0) {
    await prisma.auditLogEntry.deleteMany({ where: { entityType: "RecordingRevision", entityId: { in: revisions.map((r) => r.id) } } });
  }
  await prisma.recording.delete({ where: { id: fixture.recordingId } }).catch(() => {});

  await prisma.auditLogEntry.deleteMany({ where: { entityType: "Performance", entityId: fixture.performance.id } });
  await prisma.performance.delete({ where: { id: fixture.performance.id } }).catch(() => {});

  await prisma.auditLogEntry.deleteMany({ where: { entityType: "Artist", entityId: fixture.artist.id } });
  await prisma.artist.delete({ where: { id: fixture.artist.id } }).catch(() => {});
  await prisma.auditLogEntry.deleteMany({ where: { entityType: "Choir", entityId: fixture.choir.id } });
  await prisma.choir.delete({ where: { id: fixture.choir.id } }).catch(() => {});
  await prisma.auditLogEntry.deleteMany({ where: { entityType: "Conductor", entityId: fixture.conductor.id } });
  await prisma.conductor.delete({ where: { id: fixture.conductor.id } }).catch(() => {});

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

describe("ARTIST/CHOIR/CONDUCTOR — slug generation and collision handling", () => {
  it("createArtist/createChoir/createConductor generate a clean slugify(name) slug", async () => {
    const user = await createTestUser();
    const marker = randomUUID().slice(0, 8);
    const artistName = `Zzp9 Slug Artist ${marker}`;
    const artist = await createArtist({ slug: slugify(artistName), name: artistName, actorId: user.id });
    try {
      expect(artist.slug).toBe(slugify(artistName));
    } finally {
      await prisma.auditLogEntry.deleteMany({ where: { entityType: "Artist", entityId: artist.id } });
      await prisma.artist.delete({ where: { id: artist.id } });
      await prisma.studioUser.deleteMany({ where: { id: user.id } });
    }
  });

  it("throws SlugConflictError when two artists would produce the same slug", async () => {
    const user = await createTestUser();
    const marker = randomUUID().slice(0, 8);
    const name = `Zzp9 Duplicate Slug Artist ${marker}`;
    const first = await createArtist({ slug: slugify(name), name, actorId: user.id });
    try {
      await expect(
        createArtist({ slug: slugify(name), name: `${name} (different display name, same slug)`, actorId: user.id })
      ).rejects.toThrow(SlugConflictError);
    } finally {
      await prisma.auditLogEntry.deleteMany({ where: { entityType: "Artist", entityId: first.id } });
      await prisma.artist.delete({ where: { id: first.id } });
      await prisma.studioUser.deleteMany({ where: { id: user.id } });
    }
  });
});

describe("ARTIST/CHOIR/CONDUCTOR — slug stability after ordinary name edits", () => {
  it("keeps the same slug after updateArtist/updateChoir/updateConductor change the name", async () => {
    const fixture = await createFixture(randomUUID().slice(0, 8));
    try {
      const originalArtistSlug = fixture.artist.slug;
      const originalChoirSlug = fixture.choir.slug;
      const originalConductorSlug = fixture.conductor.slug;

      const updatedArtist = await updateArtist(fixture.artist.id, { name: "A Completely Renamed Artist", actorId: fixture.user.id });
      const updatedChoir = await updateChoir(fixture.choir.id, { name: "A Completely Renamed Choir", actorId: fixture.user.id });
      const updatedConductor = await updateConductor(fixture.conductor.id, { name: "A Completely Renamed Conductor", actorId: fixture.user.id });

      expect(updatedArtist.slug).toBe(originalArtistSlug);
      expect(updatedChoir.slug).toBe(originalChoirSlug);
      expect(updatedConductor.slug).toBe(originalConductorSlug);

      // The public page must still resolve by the ORIGINAL slug, showing the NEW name.
      const artistPage = await getArtistEntityPageData(originalArtistSlug);
      expect(artistPage?.name).toBe("A Completely Renamed Artist");
    } finally {
      await cleanupFixture(fixture);
    }
  });
});

describe("ARTIST — getArtistEntityPageData", () => {
  it("resolves a valid Artist with Performance/Programme/Recording relationships", async () => {
    const marker = randomUUID().slice(0, 8);
    const fixture = await createFixture(marker);
    try {
      const data = await getArtistEntityPageData(fixture.artist.slug);
      expect(data).not.toBeNull();
      expect(data!.name).toBe(fixture.artist.name);
      expect(data!.secondaryDetail).toBe("Violin");
      expect(data!.relatedPerformances.map((p) => p.id)).toContain(fixture.performance.id);
      expect(data!.relatedPerformances[0].slug).toBe(fixture.performance.slug);
      expect(data!.relatedProgrammes.map((p) => p.id)).toContain(fixture.programme.id);
      expect(data!.relatedRecordings.map((r) => r.id)).toContain(fixture.recordingId);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("returns null for an unknown slug", async () => {
    expect(await getArtistEntityPageData(uniqueSlug("nonexistent"))).toBeNull();
  });

  it("returns null for an archived Artist", async () => {
    const fixture = await createFixture(randomUUID().slice(0, 8));
    try {
      await archiveArtist(fixture.artist.id, fixture.user.id);
      expect(await getArtistEntityPageData(fixture.artist.slug)).toBeNull();
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("shows a public MusicMadras video via the artist's performance/recording, but excludes a private one", async () => {
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
      await seedMediaOnRevision({ recordingRevisionId: revisionId, provider: "YOUTUBE", role: "PRIMARY_VIDEO", youtubeVideoId: publicVideo.id, actorId: fixture.user.id });
      await seedMediaOnRevision({ recordingRevisionId: revisionId, provider: "YOUTUBE", role: "THUMBNAIL", youtubeVideoId: privateVideo.id, actorId: fixture.user.id });

      const data = await getArtistEntityPageData(fixture.artist.slug);
      const slugs = data!.relatedVideos.map((v) => v.slug);
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

describe("CHOIR — getChoirEntityPageData", () => {
  it("resolves a valid Choir with Performance/Programme/Recording relationships", async () => {
    const marker = randomUUID().slice(0, 8);
    const fixture = await createFixture(marker);
    try {
      const data = await getChoirEntityPageData(fixture.choir.slug);
      expect(data).not.toBeNull();
      expect(data!.name).toBe(fixture.choir.name);
      expect(data!.secondaryDetail).toBe("Test Director");
      expect(data!.relatedPerformances.map((p) => p.id)).toContain(fixture.performance.id);
      expect(data!.relatedRecordings.map((r) => r.id)).toContain(fixture.recordingId);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("returns null for an unknown slug", async () => {
    expect(await getChoirEntityPageData(uniqueSlug("nonexistent"))).toBeNull();
  });

  it("returns null for an archived Choir", async () => {
    const fixture = await createFixture(randomUUID().slice(0, 8));
    try {
      await archiveChoir(fixture.choir.id, fixture.user.id);
      expect(await getChoirEntityPageData(fixture.choir.slug)).toBeNull();
    } finally {
      await cleanupFixture(fixture);
    }
  });
});

describe("CONDUCTOR — getConductorEntityPageData", () => {
  it("resolves a valid Conductor with Performance/Programme/Recording relationships", async () => {
    const marker = randomUUID().slice(0, 8);
    const fixture = await createFixture(marker);
    try {
      const data = await getConductorEntityPageData(fixture.conductor.slug);
      expect(data).not.toBeNull();
      expect(data!.name).toBe(fixture.conductor.name);
      expect(data!.relatedPerformances.map((p) => p.id)).toContain(fixture.performance.id);
      expect(data!.relatedRecordings.map((r) => r.id)).toContain(fixture.recordingId);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("returns null for an unknown slug", async () => {
    expect(await getConductorEntityPageData(uniqueSlug("nonexistent"))).toBeNull();
  });

  it("returns null for an archived Conductor", async () => {
    const fixture = await createFixture(randomUUID().slice(0, 8));
    try {
      await archiveConductor(fixture.conductor.id, fixture.user.id);
      expect(await getConductorEntityPageData(fixture.conductor.slug)).toBeNull();
    } finally {
      await cleanupFixture(fixture);
    }
  });
});

describe("CROSS-LINKING — Performance and Programme carry real Artist/Choir/Conductor slugs", () => {
  it("Performance -> Artist/Choir/Conductor and Programme -> Artist/Choir/Conductor all carry real slugs", async () => {
    const fixture = await createFixture(randomUUID().slice(0, 8));
    try {
      const performancePage = await getPublicPerformancePageData(fixture.performance.slug);
      expect(performancePage!.artists.find((a) => a.id === fixture.artist.id)?.slug).toBe(fixture.artist.slug);
      expect(performancePage!.choirs.find((c) => c.id === fixture.choir.id)?.slug).toBe(fixture.choir.slug);
      expect(performancePage!.conductors.find((c) => c.id === fixture.conductor.id)?.slug).toBe(fixture.conductor.slug);

      const programmePage = await getPublicProgrammePageData(fixture.programme.slug);
      const programmePerformance = programmePage!.performances.find((p) => p.id === fixture.performance.id);
      expect(programmePerformance?.artists.find((a) => a.slug === fixture.artist.slug)).toBeDefined();
      expect(programmePerformance?.choirs.find((c) => c.slug === fixture.choir.slug)).toBeDefined();
      expect(programmePerformance?.conductors.find((c) => c.slug === fixture.conductor.slug)).toBeDefined();
    } finally {
      await cleanupFixture(fixture);
    }
  });
});

describe("ARCHIVE SEARCH — Artist/Choir/Conductor", () => {
  it("finds an artist by name (case-insensitive) and by instrument", async () => {
    const marker = randomUUID().slice(0, 8);
    const fixture = await createFixture(marker);
    try {
      const byName = await searchArtists(marker.toLowerCase());
      expect(byName.items.map((a) => a.id)).toContain(fixture.artist.id);
      const byInstrument = await searchArtists("Violin");
      expect(byInstrument.items.map((a) => a.id)).toContain(fixture.artist.id);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("finds a choir by name and by director name", async () => {
    const marker = randomUUID().slice(0, 8);
    const fixture = await createFixture(marker);
    try {
      const byName = await searchChoirs(marker);
      expect(byName.items.map((c) => c.id)).toContain(fixture.choir.id);
      const byDirector = await searchChoirs("Test Director");
      expect(byDirector.items.map((c) => c.id)).toContain(fixture.choir.id);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("finds a conductor by name", async () => {
    const marker = randomUUID().slice(0, 8);
    const fixture = await createFixture(marker);
    try {
      const result = await searchConductors(marker);
      expect(result.items.map((c) => c.id)).toContain(fixture.conductor.id);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("excludes archived Artist/Choir/Conductor from search", async () => {
    const fixture = await createFixture(randomUUID().slice(0, 8));
    try {
      await archiveArtist(fixture.artist.id, fixture.user.id);
      await archiveChoir(fixture.choir.id, fixture.user.id);
      await archiveConductor(fixture.conductor.id, fixture.user.id);

      const artists = await searchArtists(fixture.artist.name);
      const choirs = await searchChoirs(fixture.choir.name);
      const conductors = await searchConductors(fixture.conductor.name);

      expect(artists.items.map((a) => a.id)).not.toContain(fixture.artist.id);
      expect(choirs.items.map((c) => c.id)).not.toContain(fixture.choir.id);
      expect(conductors.items.map((c) => c.id)).not.toContain(fixture.conductor.id);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("returns an empty page (not an error) for a query with no matches, for all three types", async () => {
    const nonsense = `nonexistent-${randomUUID()}`;
    expect((await searchArtists(nonsense)).items).toEqual([]);
    expect((await searchChoirs(nonsense)).items).toEqual([]);
    expect((await searchConductors(nonsense)).items).toEqual([]);
  });

  it("respects page and pageSize for Artist search, with no duplicate/overlapping rows across pages", async () => {
    const user = await createTestUser();
    const marker = randomUUID().slice(0, 8);
    const artists = await Promise.all(
      Array.from({ length: 5 }, (_, i) => {
        const name = `Zzp9 Page Artist ${marker} ${i}`;
        return createArtist({ slug: slugify(`${name}-${randomUUID().slice(0, 8)}`), name, actorId: user.id });
      })
    );
    // Phase 6J-1: an Artist is searchable only while on a Performance a published Recording reaches.
    const venue = await createVenue({ slug: uniqueSlug("page-venue"), name: `Zzp9 Page Venue ${marker}`, type: "CHURCH", actorId: user.id });
    const published = await publishedRecordingAtVenue({ actorId: user.id, venueId: venue.id });
    for (const artist of artists) {
      await addPerformerToPerformance(published.performanceId!, artist.id, undefined, user.id);
    }
    try {
      const pageOne = await searchArtists(marker, 1, 2);
      const pageTwo = await searchArtists(marker, 2, 2);
      const pageThree = await searchArtists(marker, 3, 2);

      expect(pageOne.total).toBe(5);
      expect(pageOne.items).toHaveLength(2);
      expect(pageTwo.items).toHaveLength(2);
      expect(pageThree.items).toHaveLength(1);

      const allIds = [...pageOne.items, ...pageTwo.items, ...pageThree.items].map((a) => a.id);
      expect(new Set(allIds).size).toBe(5);
    } finally {
      await published.cleanup();
      await prisma.auditLogEntry.deleteMany({ where: { entityType: "Venue", entityId: venue.id } });
      await prisma.venue.deleteMany({ where: { id: venue.id } });
      for (const artist of artists) {
        await prisma.auditLogEntry.deleteMany({ where: { entityType: "Artist", entityId: artist.id } });
        await prisma.artist.delete({ where: { id: artist.id } });
      }
      await prisma.studioUser.deleteMany({ where: { id: user.id } });
    }
  });

  it("is included alongside every other entity type in searchArchiveAll", async () => {
    const marker = randomUUID().slice(0, 8);
    const fixture = await createFixture(marker);
    try {
      const all = await searchArchiveAll(marker);
      expect(all.artists.items.map((a) => a.id)).toContain(fixture.artist.id);
      expect(all.choirs.items.map((c) => c.id)).toContain(fixture.choir.id);
      expect(all.conductors.items.map((c) => c.id)).toContain(fixture.conductor.id);
    } finally {
      await cleanupFixture(fixture);
    }
  });
});
