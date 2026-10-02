import { getSiteOrigin } from "../../modules/config/siteOrigin";
import { describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { prisma } from "../../modules/db/client";
import { createComposer, archiveComposer } from "../../modules/db/repositories/composerRepository";
import { createMusicalWork } from "../../modules/db/repositories/musicalWorkRepository";
import { createVenue } from "../../modules/db/repositories/venueRepository";
import { createArtist } from "../../modules/db/repositories/artistRepository";
import { createChoir } from "../../modules/db/repositories/choirRepository";
import { createConductor } from "../../modules/db/repositories/conductorRepository";
import { addProgrammeItem, createProgramme } from "../../modules/db/repositories/programmeRepository";
import { addChoirToPerformance, addConductorToPerformance, addPerformerToPerformance, createPerformance } from "../../modules/db/repositories/performanceRepository";
import {
  attachWorkToRevision,
  createDraftRecording,
  publishCurrentDraft,
  updateDraftRevisionContent,
} from "../../modules/db/repositories/recordingRepository";
import { createDraftVideoPage, publishVideoPage } from "../../modules/db/repositories/youtubeVideoPageRepository";
import { createCollection, addRecordingToCollection, publishCollection } from "../../modules/db/repositories/collectionRepository";
import sitemap from "../../app/sitemap";
import type { ObservabilityState } from "@prisma/client";

// Phase 6G-11 — proves app/sitemap.ts against the real database: every
// published entity's canonical URL is included, drafts/archived content
// are excluded, and no Studio/API/query-string URL is ever emitted. No
// second visibility system is exercised here beyond what
// modules/db/repositories/sitemapRepository.ts and the existing
// listActive*/listPublished* functions already provide.

const TEST_TAG = "phase6g11sm";
const SITE_ORIGIN = getSiteOrigin();

function uniqueSlug(base: string): string {
  return `${TEST_TAG}-${base}-${randomUUID().slice(0, 8)}`;
}

async function createTestUser() {
  return prisma.studioUser.create({
    data: {
      id: randomUUID(),
      email: `${TEST_TAG}-${randomUUID().slice(0, 8)}@musicmadras.test`,
      name: "Phase 6G-11 Sitemap Test User",
      role: "EDITOR",
      status: "ACTIVE",
    },
  });
}

async function createTestVideo(overrides: { privacyStatus?: string; observabilityState?: ObservabilityState } = {}) {
  return prisma.youTubeVideo.create({
    data: {
      youtubeVideoId: uniqueSlug("video"),
      title: "Sitemap Test Video",
      thumbnailUrl: "https://i.ytimg.com/vi/test/hqdefault.jpg",
      channelId: `${TEST_TAG}-channel`,
      privacyStatus: overrides.privacyStatus ?? "public",
      observabilityState: overrides.observabilityState ?? "OBSERVED",
    },
  });
}

describe("app/sitemap.ts", () => {
  it("includes every published entity's canonical URL and excludes drafts, archived content, and Studio/API/query-string URLs", async () => {
    const user = await createTestUser();
    const composer = await createComposer({ slug: uniqueSlug("composer"), name: `Sitemap Composer ${randomUUID().slice(0, 6)}`, actorId: user.id });
    const archivedComposer = await createComposer({ slug: uniqueSlug("archived-composer"), name: `Archived Sitemap Composer ${randomUUID().slice(0, 6)}`, actorId: user.id });
    await archiveComposer(archivedComposer.id, user.id);

    const work = await createMusicalWork({ slug: uniqueSlug("work"), title: "Sitemap Work", composerId: composer.id, actorId: user.id });
    const venue = await createVenue({ slug: uniqueSlug("venue"), name: `Sitemap Venue ${randomUUID().slice(0, 6)}`, type: "CONCERT_HALL", actorId: user.id });
    const artist = await createArtist({ slug: uniqueSlug("artist"), name: `Sitemap Artist ${randomUUID().slice(0, 6)}`, actorId: user.id });
    const choir = await createChoir({ slug: uniqueSlug("choir"), name: `Sitemap Choir ${randomUUID().slice(0, 6)}`, actorId: user.id });
    const conductor = await createConductor({ slug: uniqueSlug("conductor"), name: `Sitemap Conductor ${randomUUID().slice(0, 6)}`, actorId: user.id });
    const programme = await createProgramme({ slug: uniqueSlug("programme"), title: "Sitemap Programme", actorId: user.id });
    await addProgrammeItem({ programmeId: programme.id, musicalWorkId: work.id, actorId: user.id });
    const performance = await createPerformance({ programmeId: programme.id, venueId: venue.id, performanceDate: new Date("2021-03-03"), actorId: user.id });
    // Phase 6J-1: participants are listed only while on a Performance a published Recording uses.
    await addPerformerToPerformance(performance.id, artist.id, undefined, user.id);
    await addChoirToPerformance(performance.id, choir.id, user.id);
    await addConductorToPerformance(performance.id, conductor.id, user.id);

    const draft = await createDraftRecording({ slug: uniqueSlug("recording"), actorId: user.id, title: "Sitemap Recording" });
    await updateDraftRevisionContent(draft.id, draft.currentDraftRevision!.updatedAt, user.id, { performanceId: performance.id });
    await attachWorkToRevision(draft.currentDraftRevision!.id, work.id, user.id);
    const published = await publishCurrentDraft(draft.id, user.id);

    const draftOnlyRecording = await createDraftRecording({ slug: uniqueSlug("draft-recording"), actorId: user.id, title: "Never Published" });

    const collection = await createCollection({ slug: uniqueSlug("collection"), title: "Sitemap Collection", actorId: user.id });
    await addRecordingToCollection(collection.id, published.id, user.id);
    await publishCollection(collection.id, user.id);

    const video = await createTestVideo();
    const videoPage = await createDraftVideoPage({ youtubeVideoId: video.id, actorId: user.id });
    await publishVideoPage(videoPage.id, user.id);

    try {
      const entries = await sitemap();
      const urls = entries.map((e) => e.url);

      expect(urls).toContain(`${SITE_ORIGIN}/`);
      expect(urls).toContain(`${SITE_ORIGIN}/archive`);
      expect(urls).toContain(`${SITE_ORIGIN}/collections`);

      expect(urls).toContain(`${SITE_ORIGIN}/composers/${composer.slug}`);
      expect(urls).toContain(`${SITE_ORIGIN}/works/${work.slug}`);
      expect(urls).toContain(`${SITE_ORIGIN}/venues/${venue.slug}`);
      expect(urls).toContain(`${SITE_ORIGIN}/artists/${artist.slug}`);
      expect(urls).toContain(`${SITE_ORIGIN}/choirs/${choir.slug}`);
      expect(urls).toContain(`${SITE_ORIGIN}/conductors/${conductor.slug}`);
      expect(urls).toContain(`${SITE_ORIGIN}/programmes/${programme.slug}`);
      expect(urls).toContain(`${SITE_ORIGIN}/performances/${performance.slug}`);
      expect(urls).toContain(`${SITE_ORIGIN}/recordings/${published.slug}`);
      expect(urls).toContain(`${SITE_ORIGIN}/collections/${collection.slug}`);
      expect(urls).toContain(`${SITE_ORIGIN}/videos/${videoPage.slug}`);

      // Excluded: archived and draft/unpublished content.
      expect(urls).not.toContain(`${SITE_ORIGIN}/composers/${archivedComposer.slug}`);
      expect(urls).not.toContain(`${SITE_ORIGIN}/recordings/${draftOnlyRecording.slug}`);

      // Never Studio, API, or /archive query-string states.
      for (const url of urls) {
        expect(url).not.toContain("/studio");
        expect(url).not.toContain("/api/");
        expect(url).not.toMatch(/\/archive\?/);
      }

      // Every entry has a real, non-fabricated lastModified.
      for (const entry of entries) {
        expect(entry.lastModified).toBeInstanceOf(Date);
      }
    } finally {
      await prisma.auditLogEntry.deleteMany({ where: { entityType: "YouTubeVideoPage", entityId: videoPage.id } });
      await prisma.youTubeVideoPage.delete({ where: { id: videoPage.id } }).catch(() => {});
      await prisma.youTubeVideo.delete({ where: { id: video.id } }).catch(() => {});

      await prisma.auditLogEntry.deleteMany({ where: { entityType: "Collection", entityId: collection.id } });
      await prisma.collection.delete({ where: { id: collection.id } }).catch(() => {});

      await prisma.auditLogEntry.deleteMany({ where: { entityType: "Recording", entityId: draftOnlyRecording.id } });
      await prisma.recording.delete({ where: { id: draftOnlyRecording.id } }).catch(() => {});

      const revisions = await prisma.recordingRevision.findMany({ where: { recordingId: published.id }, select: { id: true } });
      await prisma.auditLogEntry.deleteMany({ where: { entityType: "Recording", entityId: published.id } });
      if (revisions.length > 0) {
        await prisma.auditLogEntry.deleteMany({ where: { entityType: "RecordingRevision", entityId: { in: revisions.map((r) => r.id) } } });
      }
      await prisma.recording.delete({ where: { id: published.id } }).catch(() => {});

      await prisma.auditLogEntry.deleteMany({ where: { entityType: "Performance", entityId: performance.id } });
      await prisma.performance.delete({ where: { id: performance.id } }).catch(() => {});
      await prisma.auditLogEntry.deleteMany({ where: { entityType: "Programme", entityId: programme.id } });
      await prisma.programme.delete({ where: { id: programme.id } }).catch(() => {});
      await prisma.auditLogEntry.deleteMany({ where: { entityType: "Venue", entityId: venue.id } });
      await prisma.venue.delete({ where: { id: venue.id } }).catch(() => {});

      await prisma.auditLogEntry.deleteMany({ where: { entityType: "Artist", entityId: artist.id } });
      await prisma.artist.delete({ where: { id: artist.id } }).catch(() => {});
      await prisma.auditLogEntry.deleteMany({ where: { entityType: "Choir", entityId: choir.id } });
      await prisma.choir.delete({ where: { id: choir.id } }).catch(() => {});
      await prisma.auditLogEntry.deleteMany({ where: { entityType: "Conductor", entityId: conductor.id } });
      await prisma.conductor.delete({ where: { id: conductor.id } }).catch(() => {});

      await prisma.auditLogEntry.deleteMany({ where: { entityType: "MusicalWork", entityId: work.id } });
      await prisma.musicalWork.delete({ where: { id: work.id } }).catch(() => {});
      await prisma.auditLogEntry.deleteMany({ where: { entityType: "Composer", entityId: { in: [composer.id, archivedComposer.id] } } });
      await prisma.composer.delete({ where: { id: composer.id } }).catch(() => {});
      await prisma.composer.delete({ where: { id: archivedComposer.id } }).catch(() => {});

      await prisma.studioUser.deleteMany({ where: { id: user.id } });
    }
  });
});
