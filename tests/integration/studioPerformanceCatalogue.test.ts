import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { prisma } from "../../modules/db/client";
import { can } from "../../modules/auth/policy";
import { createProgramme } from "../../modules/db/repositories/programmeRepository";
import { createVenue } from "../../modules/db/repositories/venueRepository";
import { createArtist } from "../../modules/db/repositories/artistRepository";
import { createChoir } from "../../modules/db/repositories/choirRepository";
import { createConductor } from "../../modules/db/repositories/conductorRepository";
import {
  addChoirToPerformance,
  addConductorToPerformance,
  addPerformerToPerformance,
  archivePerformance,
  createPerformance,
  findPerformanceById,
  listPerformancesForStudio,
  reassignPerformanceProgramme,
  reassignPerformanceVenue,
  removeChoirFromPerformance,
  removeConductorFromPerformance,
  removePerformerFromPerformance,
  restorePerformance,
  updatePerformance,
} from "../../modules/db/repositories/performanceRepository";

// Phase 6G-4H: proves the Studio Performance catalogue repository against
// the real database, mirroring tests/integration/studioProgrammeCatalogue.test.ts
// and its siblings' pattern exactly. Real DB, disposable test-prefixed
// fixtures only.

const TEST_TAG = "phase6g4h";
const TEST_EMAIL = `${TEST_TAG}-integration-test@musicmadras.test`;

function uniqueSlug(base: string): string {
  return `${TEST_TAG}-${base}-${randomUUID().slice(0, 8)}`;
}

async function createTestUser() {
  return prisma.studioUser.create({
    data: { id: randomUUID(), email: TEST_EMAIL, name: "Phase 6G-4H Test User", role: "EDITOR", status: "ACTIVE" },
  });
}

async function cleanupPerformance(performanceId: string) {
  await prisma.auditLogEntry.deleteMany({ where: { entityType: "Performance", entityId: performanceId } });
  await prisma.performance.delete({ where: { id: performanceId } }); // cascades PerformancePerformer/Choir/Conductor
}

async function cleanupProgramme(programmeId: string) {
  await prisma.auditLogEntry.deleteMany({ where: { entityType: "Programme", entityId: programmeId } });
  await prisma.programme.delete({ where: { id: programmeId } });
}

async function cleanupVenue(venueId: string) {
  await prisma.auditLogEntry.deleteMany({ where: { entityType: "Venue", entityId: venueId } });
  await prisma.venue.delete({ where: { id: venueId } });
}

async function cleanupArtist(artistId: string) {
  await prisma.auditLogEntry.deleteMany({ where: { entityType: "Artist", entityId: artistId } });
  await prisma.artist.delete({ where: { id: artistId } });
}

async function cleanupChoir(choirId: string) {
  await prisma.auditLogEntry.deleteMany({ where: { entityType: "Choir", entityId: choirId } });
  await prisma.choir.delete({ where: { id: choirId } });
}

async function cleanupConductor(conductorId: string) {
  await prisma.auditLogEntry.deleteMany({ where: { entityType: "Conductor", entityId: conductorId } });
  await prisma.conductor.delete({ where: { id: conductorId } });
}

describe("Studio permission policy for Performance (brief, cross-checked against 6G-4C/E/F/G)", () => {
  it("CATALOGUE_WRITE is the only permission gating Performance writes — no new permission was introduced", () => {
    expect(can("CONTRIBUTOR", "CATALOGUE_WRITE")).toBe(false);
    expect(can("EDITOR", "CATALOGUE_WRITE")).toBe(true);
    expect(can("ADMINISTRATOR", "CATALOGUE_WRITE")).toBe(true);
  });
});

describe("Performance catalogue management against a real database", () => {
  let performanceId: string | null = null;
  let programmeIds: string[] = [];
  let venueIds: string[] = [];
  let userId: string | null = null;

  afterEach(async () => {
    if (performanceId) {
      await cleanupPerformance(performanceId).catch(() => {});
      performanceId = null;
    }
    for (const programmeId of programmeIds) {
      await cleanupProgramme(programmeId).catch(() => {});
    }
    programmeIds = [];
    for (const venueId of venueIds) {
      await cleanupVenue(venueId).catch(() => {});
    }
    venueIds = [];
    if (userId) {
      await prisma.studioUser.deleteMany({ where: { id: userId } });
      userId = null;
    }
  });

  it("creates a Performance and audit-logs the creation", async () => {
    const user = await createTestUser();
    userId = user.id;
    const programme = await createProgramme({ slug: uniqueSlug("programme"), title: "QA Concert Programme", actorId: user.id });
    programmeIds.push(programme.id);
    const venue = await createVenue({ slug: uniqueSlug("venue"), name: "QA Concert Hall", type: "CONCERT_HALL", actorId: user.id });
    venueIds.push(venue.id);

    const performance = await createPerformance({
      programmeId: programme.id,
      venueId: venue.id,
      performanceDate: new Date("2026-12-24"),
      actorId: user.id,
    });
    performanceId = performance.id;

    expect(performance.programmeId).toBe(programme.id);
    expect(performance.venueId).toBe(venue.id);
    expect(performance.archivedAt).toBeNull();

    const audit = await prisma.auditLogEntry.findMany({ where: { entityType: "Performance", entityId: performance.id, action: "PERFORMANCE_CREATED" } });
    expect(audit).toHaveLength(1);
  });

  it("edits a Performance's date without touching its Programme/Venue", async () => {
    const user = await createTestUser();
    userId = user.id;
    const programme = await createProgramme({ slug: uniqueSlug("programme"), title: "QA Editable Programme", actorId: user.id });
    programmeIds.push(programme.id);
    const venue = await createVenue({ slug: uniqueSlug("venue"), name: "QA Editable Hall", type: "CONCERT_HALL", actorId: user.id });
    venueIds.push(venue.id);
    const performance = await createPerformance({ programmeId: programme.id, venueId: venue.id, actorId: user.id });
    performanceId = performance.id;

    const updated = await updatePerformance(performance.id, { performanceDate: new Date("2027-01-15"), actorId: user.id });
    expect(updated.performanceDate?.toISOString().slice(0, 10)).toBe("2027-01-15");
    expect(updated.programmeId).toBe(programme.id);
    expect(updated.venueId).toBe(venue.id);

    const audit = await prisma.auditLogEntry.findMany({ where: { entityType: "Performance", entityId: performance.id, action: "PERFORMANCE_UPDATED" } });
    expect(audit).toHaveLength(1);
  });

  it("reassigns a Performance's Programme, audit-logging the change distinctly from a field edit", async () => {
    const user = await createTestUser();
    userId = user.id;
    const programmeA = await createProgramme({ slug: uniqueSlug("programme-a"), title: "QA Programme A", actorId: user.id });
    const programmeB = await createProgramme({ slug: uniqueSlug("programme-b"), title: "QA Programme B", actorId: user.id });
    programmeIds.push(programmeA.id, programmeB.id);
    const venue = await createVenue({ slug: uniqueSlug("venue"), name: "QA Reassign Hall", type: "CONCERT_HALL", actorId: user.id });
    venueIds.push(venue.id);
    const performance = await createPerformance({ programmeId: programmeA.id, venueId: venue.id, actorId: user.id });
    performanceId = performance.id;

    const reassigned = await reassignPerformanceProgramme(performance.id, programmeB.id, user.id);
    expect(reassigned.programmeId).toBe(programmeB.id);

    const audit = await prisma.auditLogEntry.findMany({ where: { entityType: "Performance", entityId: performance.id, action: "PERFORMANCE_PROGRAMME_CHANGED" } });
    expect(audit).toHaveLength(1);
  });

  it("reassigns a Performance's Venue, audit-logging the change distinctly from a field edit", async () => {
    const user = await createTestUser();
    userId = user.id;
    const programme = await createProgramme({ slug: uniqueSlug("programme"), title: "QA Venue Reassign Programme", actorId: user.id });
    programmeIds.push(programme.id);
    const venueA = await createVenue({ slug: uniqueSlug("venue-a"), name: "QA Hall A", type: "CONCERT_HALL", actorId: user.id });
    const venueB = await createVenue({ slug: uniqueSlug("venue-b"), name: "QA Hall B", type: "CHURCH", actorId: user.id });
    venueIds.push(venueA.id, venueB.id);
    const performance = await createPerformance({ programmeId: programme.id, venueId: venueA.id, actorId: user.id });
    performanceId = performance.id;

    const reassigned = await reassignPerformanceVenue(performance.id, venueB.id, user.id);
    expect(reassigned.venueId).toBe(venueB.id);

    const audit = await prisma.auditLogEntry.findMany({ where: { entityType: "Performance", entityId: performance.id, action: "PERFORMANCE_VENUE_CHANGED" } });
    expect(audit).toHaveLength(1);
  });

  it("archives and restores a Performance, audit-logging both, without deleting the record", async () => {
    const user = await createTestUser();
    userId = user.id;
    const programme = await createProgramme({ slug: uniqueSlug("programme"), title: "QA Archivable Programme", actorId: user.id });
    programmeIds.push(programme.id);
    const venue = await createVenue({ slug: uniqueSlug("venue"), name: "QA Archivable Hall", type: "CONCERT_HALL", actorId: user.id });
    venueIds.push(venue.id);
    const performance = await createPerformance({ programmeId: programme.id, venueId: venue.id, actorId: user.id });
    performanceId = performance.id;

    const archived = await archivePerformance(performance.id, user.id);
    expect(archived.archivedAt).not.toBeNull();
    expect(await findPerformanceById(performance.id)).not.toBeNull();

    const restored = await restorePerformance(performance.id, user.id);
    expect(restored.archivedAt).toBeNull();

    const archiveAudit = await prisma.auditLogEntry.findMany({ where: { entityType: "Performance", entityId: performance.id, action: "PERFORMANCE_ARCHIVED" } });
    const restoreAudit = await prisma.auditLogEntry.findMany({ where: { entityType: "Performance", entityId: performance.id, action: "PERFORMANCE_RESTORED" } });
    expect(archiveAudit).toHaveLength(1);
    expect(restoreAudit).toHaveLength(1);
  });

  it("lists and searches Performances for Studio by Programme title or Venue name, including archived ones", async () => {
    const user = await createTestUser();
    userId = user.id;
    const uniqueMarker = randomUUID().slice(0, 8);
    const programme = await createProgramme({ slug: uniqueSlug("programme"), title: `Searchable ${uniqueMarker} Programme`, actorId: user.id });
    programmeIds.push(programme.id);
    const venue = await createVenue({ slug: uniqueSlug("venue"), name: "QA Searchable Hall", type: "CONCERT_HALL", actorId: user.id });
    venueIds.push(venue.id);
    const performance = await createPerformance({ programmeId: programme.id, venueId: venue.id, actorId: user.id });
    performanceId = performance.id;

    const foundByProgramme = await listPerformancesForStudio(uniqueMarker);
    expect(foundByProgramme.map((p) => p.id)).toContain(performance.id);

    const foundByVenue = await listPerformancesForStudio("QA Searchable Hall");
    expect(foundByVenue.map((p) => p.id)).toContain(performance.id);

    await archivePerformance(performance.id, user.id);
    const foundAfterArchive = await listPerformancesForStudio(uniqueMarker);
    expect(foundAfterArchive.map((p) => p.id)).toContain(performance.id); // Studio list includes archived
  });
});

describe("Performance participant management (Artists/Choirs/Conductors) against a real database", () => {
  let performanceId: string | null = null;
  let programmeId: string | null = null;
  let venueId: string | null = null;
  let artistId: string | null = null;
  let choirId: string | null = null;
  let conductorId: string | null = null;
  let userId: string | null = null;

  afterEach(async () => {
    if (performanceId) {
      await cleanupPerformance(performanceId).catch(() => {});
      performanceId = null;
    }
    if (programmeId) {
      await cleanupProgramme(programmeId).catch(() => {});
      programmeId = null;
    }
    if (venueId) {
      await cleanupVenue(venueId).catch(() => {});
      venueId = null;
    }
    if (artistId) {
      await cleanupArtist(artistId).catch(() => {});
      artistId = null;
    }
    if (choirId) {
      await cleanupChoir(choirId).catch(() => {});
      choirId = null;
    }
    if (conductorId) {
      await cleanupConductor(conductorId).catch(() => {});
      conductorId = null;
    }
    if (userId) {
      await prisma.studioUser.deleteMany({ where: { id: userId } });
      userId = null;
    }
  });

  async function setUpPerformance(user: { id: string }) {
    const programme = await createProgramme({ slug: uniqueSlug("programme"), title: "QA Participants Programme", actorId: user.id });
    programmeId = programme.id;
    const venue = await createVenue({ slug: uniqueSlug("venue"), name: "QA Participants Hall", type: "CONCERT_HALL", actorId: user.id });
    venueId = venue.id;
    const performance = await createPerformance({ programmeId: programme.id, venueId: venue.id, actorId: user.id });
    performanceId = performance.id;
    return performance;
  }

  it("adds and removes an Artist, audit-logging both", async () => {
    const user = await createTestUser();
    userId = user.id;
    const performance = await setUpPerformance(user);
    const artist = await createArtist({ name: "QA Soloist", actorId: user.id });
    artistId = artist.id;

    await addPerformerToPerformance(performance.id, artist.id, "Soloist", user.id);
    const withArtist = await findPerformanceById(performance.id);
    expect(withArtist?.performers).toHaveLength(1);
    expect(withArtist?.performers[0].role).toBe("Soloist");

    await removePerformerFromPerformance(performance.id, artist.id, user.id);
    const withoutArtist = await findPerformanceById(performance.id);
    expect(withoutArtist?.performers).toHaveLength(0);

    const addAudit = await prisma.auditLogEntry.findMany({ where: { entityType: "Performance", entityId: performance.id, action: "PERFORMER_LINKED_TO_PERFORMANCE" } });
    const removeAudit = await prisma.auditLogEntry.findMany({ where: { entityType: "Performance", entityId: performance.id, action: "PERFORMER_UNLINKED_FROM_PERFORMANCE" } });
    expect(addAudit).toHaveLength(1);
    expect(removeAudit).toHaveLength(1);
  });

  it("adds and removes a Choir, audit-logging both", async () => {
    const user = await createTestUser();
    userId = user.id;
    const performance = await setUpPerformance(user);
    const choir = await createChoir({ name: "QA Chamber Choir", actorId: user.id });
    choirId = choir.id;

    await addChoirToPerformance(performance.id, choir.id, user.id);
    const withChoir = await findPerformanceById(performance.id);
    expect(withChoir?.choirs).toHaveLength(1);

    await removeChoirFromPerformance(performance.id, choir.id, user.id);
    const withoutChoir = await findPerformanceById(performance.id);
    expect(withoutChoir?.choirs).toHaveLength(0);

    const addAudit = await prisma.auditLogEntry.findMany({ where: { entityType: "Performance", entityId: performance.id, action: "CHOIR_LINKED_TO_PERFORMANCE" } });
    const removeAudit = await prisma.auditLogEntry.findMany({ where: { entityType: "Performance", entityId: performance.id, action: "CHOIR_UNLINKED_FROM_PERFORMANCE" } });
    expect(addAudit).toHaveLength(1);
    expect(removeAudit).toHaveLength(1);
  });

  it("adds and removes a Conductor, audit-logging both", async () => {
    const user = await createTestUser();
    userId = user.id;
    const performance = await setUpPerformance(user);
    const conductor = await createConductor({ name: "QA Maestro", actorId: user.id });
    conductorId = conductor.id;

    await addConductorToPerformance(performance.id, conductor.id, user.id);
    const withConductor = await findPerformanceById(performance.id);
    expect(withConductor?.conductors).toHaveLength(1);

    await removeConductorFromPerformance(performance.id, conductor.id, user.id);
    const withoutConductor = await findPerformanceById(performance.id);
    expect(withoutConductor?.conductors).toHaveLength(0);

    const addAudit = await prisma.auditLogEntry.findMany({ where: { entityType: "Performance", entityId: performance.id, action: "CONDUCTOR_LINKED_TO_PERFORMANCE" } });
    const removeAudit = await prisma.auditLogEntry.findMany({ where: { entityType: "Performance", entityId: performance.id, action: "CONDUCTOR_UNLINKED_FROM_PERFORMANCE" } });
    expect(addAudit).toHaveLength(1);
    expect(removeAudit).toHaveLength(1);
  });

  it("preserves participant relationships when the Performance is archived and restored", async () => {
    const user = await createTestUser();
    userId = user.id;
    const performance = await setUpPerformance(user);
    const artist = await createArtist({ name: "QA Preserved Artist", actorId: user.id });
    artistId = artist.id;
    const choir = await createChoir({ name: "QA Preserved Choir", actorId: user.id });
    choirId = choir.id;
    const conductor = await createConductor({ name: "QA Preserved Conductor", actorId: user.id });
    conductorId = conductor.id;

    await addPerformerToPerformance(performance.id, artist.id, undefined, user.id);
    await addChoirToPerformance(performance.id, choir.id, user.id);
    await addConductorToPerformance(performance.id, conductor.id, user.id);

    await archivePerformance(performance.id, user.id);
    const whileArchived = await findPerformanceById(performance.id);
    expect(whileArchived?.performers).toHaveLength(1);
    expect(whileArchived?.choirs).toHaveLength(1);
    expect(whileArchived?.conductors).toHaveLength(1);

    await restorePerformance(performance.id, user.id);
    const afterRestore = await findPerformanceById(performance.id);
    expect(afterRestore?.performers).toHaveLength(1);
    expect(afterRestore?.choirs).toHaveLength(1);
    expect(afterRestore?.conductors).toHaveLength(1);
  });
});
