import { describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { prisma } from "../../modules/db/client";
import { createComposer, archiveComposer } from "../../modules/db/repositories/composerRepository";
import { createMusicalWork, archiveMusicalWork } from "../../modules/db/repositories/musicalWorkRepository";
import { createVenue, archiveVenue } from "../../modules/db/repositories/venueRepository";
import { createProgramme, addProgrammeItem } from "../../modules/db/repositories/programmeRepository";
import { createPerformance } from "../../modules/db/repositories/performanceRepository";
import {
  attachWorkToRevision,
  createDraftRecording,
  publishCurrentDraft,
  submitRecordingForReview,
  updateDraftRevisionContent,
  archiveRecording,
} from "../../modules/db/repositories/recordingRepository";
import { publishRecordingFor, publishedRecordingAtVenue } from "./helpers/publishedContent";
import {
  ARCHIVE_ALL_TYPES_LIMIT,
  searchArchiveAll,
  searchComposers,
  searchRecordings,
  searchVenues,
  searchWorks,
} from "../../modules/db/repositories/archiveSearchRepository";

// Phase 6G-7: proves the /archive search's sole data source
// (modules/db/repositories/archiveSearchRepository.ts) against the real
// database. Mirrors the established tests/integration/*.test.ts pattern.
// Real DB, disposable test-prefixed fixtures only.

const TEST_TAG = "phase6g7";

function uniqueSlug(base: string): string {
  return `${TEST_TAG}-${base}-${randomUUID().slice(0, 8)}`;
}

// A unique email per call (not a single shared constant) — deliberately
// more defensive than this codebase's usual shared-TEST_EMAIL convention.
// If a test's own search call is ever slow enough to hit vitest's default
// timeout, vitest moves on to the next test without waiting for the
// timed-out test's `finally` to finish running (the orphaned promise
// keeps executing in the background) — with a shared email, that leftover
// in-flight user row collides with the next test's createTestUser() call
// and cascades into unrelated failures. A unique email per call removes
// that race entirely, independent of how reliably cleanup itself runs.
async function createTestUser() {
  return prisma.studioUser.create({
    data: {
      id: randomUUID(),
      email: `${TEST_TAG}-integration-test-${randomUUID().slice(0, 8)}@musicmadras.test`,
      name: "Phase 6G-7 Test User",
      role: "EDITOR",
      status: "ACTIVE",
    },
  });
}

async function cleanupComposer(composerId: string) {
  await prisma.auditLogEntry.deleteMany({ where: { entityType: "Composer", entityId: composerId } });
  await prisma.composer.delete({ where: { id: composerId } });
}

async function cleanupWork(workId: string) {
  await prisma.auditLogEntry.deleteMany({ where: { entityType: "MusicalWork", entityId: workId } });
  await prisma.musicalWork.delete({ where: { id: workId } });
}

async function cleanupVenue(venueId: string) {
  await prisma.auditLogEntry.deleteMany({ where: { entityType: "Venue", entityId: venueId } });
  await prisma.venue.delete({ where: { id: venueId } });
}

async function cleanupRecording(recordingId: string) {
  const revisions = await prisma.recordingRevision.findMany({ where: { recordingId }, select: { id: true } });
  await prisma.auditLogEntry.deleteMany({ where: { entityType: "Recording", entityId: recordingId } });
  if (revisions.length > 0) {
    await prisma.auditLogEntry.deleteMany({ where: { entityType: "RecordingRevision", entityId: { in: revisions.map((r) => r.id) } } });
  }
  await prisma.recording.delete({ where: { id: recordingId } });
}

describe("Composer search — archiveSearchRepository", () => {
  it("finds a composer by a case-insensitive partial name match", async () => {
    const user = await createTestUser();
    const marker = randomUUID().slice(0, 8);
    const composer = await createComposer({ slug: uniqueSlug("composer"), name: `Zzarch Bachwood ${marker}`, actorId: user.id });
    // Phase 6J-1: a Composer is searchable only while published content reaches them.
    const work = await createMusicalWork({ slug: uniqueSlug("work"), title: `Zzarch Bachwood Work ${marker}`, composerId: composer.id, actorId: user.id });
    const published = await publishRecordingFor({ actorId: user.id, workIds: [work.id] });
    try {
      const lower = await searchComposers(marker.toLowerCase());
      const upper = await searchComposers(marker.toUpperCase());
      expect(lower.items.map((c) => c.id)).toContain(composer.id);
      expect(upper.items.map((c) => c.id)).toContain(composer.id);
    } finally {
      await published.cleanup();
      await cleanupWork(work.id);
      await cleanupComposer(composer.id);
      await prisma.studioUser.deleteMany({ where: { id: user.id } });
    }
  });

  it("excludes an archived Composer", async () => {
    const user = await createTestUser();
    const marker = randomUUID().slice(0, 8);
    const composer = await createComposer({ slug: uniqueSlug("composer"), name: `Zzarch Archived ${marker}`, actorId: user.id });
    try {
      await archiveComposer(composer.id, user.id);
      const result = await searchComposers(marker);
      expect(result.items.map((c) => c.id)).not.toContain(composer.id);
    } finally {
      await cleanupComposer(composer.id);
      await prisma.studioUser.deleteMany({ where: { id: user.id } });
    }
  });

  it("returns an empty page (not an error) for a query with no matches", async () => {
    const result = await searchComposers(`nonexistent-${randomUUID()}`);
    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
  });

  it("falls back to deterministic recent-first ordering with no query", async () => {
    const result = await searchComposers(undefined, 1, 5);
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(5);
    expect(result.items.length).toBeLessThanOrEqual(5);
  });
});

describe("Work search — archiveSearchRepository", () => {
  it("finds a work by title, including composer context", async () => {
    const user = await createTestUser();
    const marker = randomUUID().slice(0, 8);
    const composer = await createComposer({ slug: uniqueSlug("composer"), name: "Zzarch Work Composer", actorId: user.id });
    const work = await createMusicalWork({
      slug: uniqueSlug("work"),
      title: `Zzarch Fugue ${marker}`,
      composerId: composer.id,
      catalogueNumber: "BWV 999",
      actorId: user.id,
    });
    const published = await publishRecordingFor({ actorId: user.id, workIds: [work.id] });
    try {
      const result = await searchWorks(marker);
      const found = result.items.find((w) => w.id === work.id);
      expect(found).toBeDefined();
      expect(found?.composerSlug).toBe(composer.slug);
      expect(found?.catalogueNumber).toBe("BWV 999");
    } finally {
      await published.cleanup();
      await cleanupWork(work.id);
      await cleanupComposer(composer.id);
      await prisma.studioUser.deleteMany({ where: { id: user.id } });
    }
  });

  it("excludes an archived Work", async () => {
    const user = await createTestUser();
    const marker = randomUUID().slice(0, 8);
    const composer = await createComposer({ slug: uniqueSlug("composer"), name: "Zzarch Archived Work Composer", actorId: user.id });
    const work = await createMusicalWork({ slug: uniqueSlug("work"), title: `Zzarch Archived Work ${marker}`, composerId: composer.id, actorId: user.id });
    try {
      await archiveMusicalWork(work.id, user.id);
      const result = await searchWorks(marker);
      expect(result.items.map((w) => w.id)).not.toContain(work.id);
    } finally {
      await cleanupWork(work.id);
      await cleanupComposer(composer.id);
      await prisma.studioUser.deleteMany({ where: { id: user.id } });
    }
  });
});

describe("Venue search — archiveSearchRepository", () => {
  it("finds a venue by name", async () => {
    const user = await createTestUser();
    const marker = randomUUID().slice(0, 8);
    const venue = await createVenue({ slug: uniqueSlug("venue"), name: `Zzarch Hall ${marker}`, type: "CONCERT_HALL", city: "Chennai", actorId: user.id });
    const published = await publishedRecordingAtVenue({ actorId: user.id, venueId: venue.id });
    try {
      const result = await searchVenues(marker);
      expect(result.items.map((v) => v.id)).toContain(venue.id);
      expect(result.items.find((v) => v.id === venue.id)?.city).toBe("Chennai");
    } finally {
      await published.cleanup();
      await cleanupVenue(venue.id);
      await prisma.studioUser.deleteMany({ where: { id: user.id } });
    }
  });

  it("finds a venue by city", async () => {
    const user = await createTestUser();
    const marker = randomUUID().slice(0, 8);
    const venue = await createVenue({ slug: uniqueSlug("venue"), name: "Zzarch Plain Hall", type: "CONCERT_HALL", city: `Zzarchtown ${marker}`, actorId: user.id });
    const published = await publishedRecordingAtVenue({ actorId: user.id, venueId: venue.id });
    try {
      const result = await searchVenues(marker);
      expect(result.items.map((v) => v.id)).toContain(venue.id);
    } finally {
      await published.cleanup();
      await cleanupVenue(venue.id);
      await prisma.studioUser.deleteMany({ where: { id: user.id } });
    }
  });

  it("excludes an archived Venue", async () => {
    const user = await createTestUser();
    const marker = randomUUID().slice(0, 8);
    const venue = await createVenue({ slug: uniqueSlug("venue"), name: `Zzarch Archived Hall ${marker}`, type: "CHURCH", actorId: user.id });
    try {
      await archiveVenue(venue.id, user.id);
      const result = await searchVenues(marker);
      expect(result.items.map((v) => v.id)).not.toContain(venue.id);
    } finally {
      await cleanupVenue(venue.id);
      await prisma.studioUser.deleteMany({ where: { id: user.id } });
    }
  });
});

describe("Recording search — archiveSearchRepository (publication visibility via isRecordingPublished)", () => {
  it("includes a PUBLISHED recording but excludes DRAFT, IN_REVIEW, and ARCHIVED recordings with the same searchable title", async () => {
    const user = await createTestUser();
    const marker = randomUUID().slice(0, 8);

    const published = await createDraftRecording({ slug: uniqueSlug("rec-published"), actorId: user.id, title: `Zzarch Concert ${marker} Published` });
    const draft = await createDraftRecording({ slug: uniqueSlug("rec-draft"), actorId: user.id, title: `Zzarch Concert ${marker} Draft` });
    const inReview = await createDraftRecording({ slug: uniqueSlug("rec-review"), actorId: user.id, title: `Zzarch Concert ${marker} InReview` });
    const archived = await createDraftRecording({ slug: uniqueSlug("rec-archived"), actorId: user.id, title: `Zzarch Concert ${marker} Archived` });

    try {
      const publishedRecording = await publishCurrentDraft(published.id, user.id);
      await submitRecordingForReview(inReview.id, user.id);
      await publishCurrentDraft(archived.id, user.id);
      await archiveRecording(archived.id, user.id);

      const result = await searchRecordings(marker);
      const ids = result.items.map((r) => r.id);
      expect(ids).toContain(publishedRecording.id);
      expect(ids).not.toContain(draft.id);
      expect(ids).not.toContain(inReview.id);
      expect(ids).not.toContain(archived.id);
      expect(result.items.find((r) => r.id === publishedRecording.id)?.slug).toBe(publishedRecording.slug);
    } finally {
      await cleanupRecording(published.id);
      await cleanupRecording(draft.id);
      await cleanupRecording(inReview.id);
      await cleanupRecording(archived.id);
      await prisma.studioUser.deleteMany({ where: { id: user.id } });
    }
  });

  it("surfaces programme/venue context for a published recording", async () => {
    const user = await createTestUser();
    const marker = randomUUID().slice(0, 8);
    const composer = await createComposer({ slug: uniqueSlug("composer"), name: "Zzarch Recording Context Composer", actorId: user.id });
    const work = await createMusicalWork({ slug: uniqueSlug("work"), title: "Zzarch Context Work", composerId: composer.id, actorId: user.id });
    const programme = await createProgramme({ slug: uniqueSlug("programme"), title: "Zzarch Context Programme", actorId: user.id });
    await addProgrammeItem({ programmeId: programme.id, musicalWorkId: work.id, actorId: user.id });
    const venue = await createVenue({ slug: uniqueSlug("venue"), name: "Zzarch Context Venue", type: "CHURCH", actorId: user.id });
    const performance = await createPerformance({ programmeId: programme.id, venueId: venue.id, actorId: user.id });

    const draft = await createDraftRecording({ slug: uniqueSlug("recording"), actorId: user.id, title: `Zzarch Context Recording ${marker}` });
    try {
      await updateDraftRevisionContent(draft.id, draft.currentDraftRevision!.updatedAt, user.id, { performanceId: performance.id });
      await attachWorkToRevision(draft.currentDraftRevision!.id, work.id, user.id);
      const published = await publishCurrentDraft(draft.id, user.id);

      const result = await searchRecordings(marker);
      const found = result.items.find((r) => r.id === published.id);
      expect(found?.programmeTitle).toBe("Zzarch Context Programme");
      expect(found?.venueName).toBe("Zzarch Context Venue");
    } finally {
      await cleanupRecording(draft.id);
      await prisma.auditLogEntry.deleteMany({ where: { entityType: "Performance", entityId: performance.id } });
      await prisma.performance.delete({ where: { id: performance.id } });
      await cleanupVenue(venue.id);
      await prisma.auditLogEntry.deleteMany({ where: { entityType: "Programme", entityId: programme.id } });
      await prisma.programme.delete({ where: { id: programme.id } });
      await cleanupWork(work.id);
      await cleanupComposer(composer.id);
      await prisma.studioUser.deleteMany({ where: { id: user.id } });
    }
  });
});

describe("Pagination — archiveSearchRepository", () => {
  it("respects page and pageSize, and total reflects the full match count across pages", async () => {
    const user = await createTestUser();
    const marker = randomUUID().slice(0, 8);
    const composers = await Promise.all(
      Array.from({ length: 5 }, (_, i) => createComposer({ slug: uniqueSlug(`composer-${i}`), name: `Zzarch Page Composer ${marker} ${i}`, actorId: user.id }))
    );
    // Phase 6J-1: each Composer is searchable only through a Work that a published Recording reaches.
    const works = await Promise.all(
      composers.map((composer, i) => createMusicalWork({ slug: uniqueSlug(`work-${i}`), title: `Zzarch Page Work ${marker} ${i}`, composerId: composer.id, actorId: user.id }))
    );
    const published = await publishRecordingFor({ actorId: user.id, workIds: works.map((w) => w.id) });
    try {
      const pageOne = await searchComposers(marker, 1, 2);
      const pageTwo = await searchComposers(marker, 2, 2);
      const pageThree = await searchComposers(marker, 3, 2);

      expect(pageOne.total).toBe(5);
      expect(pageOne.items).toHaveLength(2);
      expect(pageTwo.items).toHaveLength(2);
      expect(pageThree.items).toHaveLength(1);

      const allIds = [...pageOne.items, ...pageTwo.items, ...pageThree.items].map((c) => c.id);
      expect(new Set(allIds).size).toBe(5); // no duplicate/overlapping rows across pages
    } finally {
      await published.cleanup();
      for (const work of works) {
        await cleanupWork(work.id);
      }
      for (const composer of composers) {
        await cleanupComposer(composer.id);
      }
      await prisma.studioUser.deleteMany({ where: { id: user.id } });
    }
  });
});

describe("Combined search across all supported entity types — searchArchiveAll", () => {
  it("returns capped results from every entity type in one call, using the same underlying search functions", async () => {
    const user = await createTestUser();
    const marker = randomUUID().slice(0, 8);
    const composer = await createComposer({ slug: uniqueSlug("composer"), name: `Zzarch Combined ${marker}`, actorId: user.id });
    const work = await createMusicalWork({ slug: uniqueSlug("work"), title: `Zzarch Combined ${marker}`, composerId: composer.id, actorId: user.id });
    const venue = await createVenue({ slug: uniqueSlug("venue"), name: `Zzarch Combined ${marker}`, type: "CONCERT_HALL", actorId: user.id });
    const draft = await createDraftRecording({ slug: uniqueSlug("recording"), actorId: user.id, title: `Zzarch Combined ${marker}` });
    // Phase 6J-1: the Composer/Work and the Venue are searchable only through published content.
    const workContent = await publishRecordingFor({ actorId: user.id, workIds: [work.id] });
    const venueContent = await publishedRecordingAtVenue({ actorId: user.id, venueId: venue.id });
    try {
      const published = await publishCurrentDraft(draft.id, user.id);

      const all = await searchArchiveAll(marker);
      expect(all.composers.items.map((c) => c.id)).toContain(composer.id);
      expect(all.works.items.map((w) => w.id)).toContain(work.id);
      expect(all.venues.items.map((v) => v.id)).toContain(venue.id);
      expect(all.recordings.items.map((r) => r.id)).toContain(published.id);
      expect(all.composers.pageSize).toBe(ARCHIVE_ALL_TYPES_LIMIT);
    } finally {
      await cleanupRecording(draft.id);
      await workContent.cleanup();
      await venueContent.cleanup();
      await cleanupVenue(venue.id);
      await cleanupWork(work.id);
      await cleanupComposer(composer.id);
      await prisma.studioUser.deleteMany({ where: { id: user.id } });
    }
  });

  it("returns all-zero totals (not an error) when nothing matches across any type", async () => {
    const all = await searchArchiveAll(`nonexistent-${randomUUID()}`);
    expect(all.composers.total).toBe(0);
    expect(all.works.total).toBe(0);
    expect(all.recordings.total).toBe(0);
    expect(all.venues.total).toBe(0);
  });
});
