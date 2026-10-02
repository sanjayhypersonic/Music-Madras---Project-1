import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { prisma } from "../../modules/db/client";
import { publishRecordingFor } from "./helpers/publishedContent";
import { can } from "../../modules/auth/policy";
import { DuplicateEntityError } from "../../modules/mmke/duplicate-detection/detectDuplicateName";
import {
  archiveArtist,
  createArtist,
  listArtistsForStudio,
  restoreArtist,
  updateArtist,
} from "../../modules/db/repositories/artistRepository";
import {
  archiveChoir,
  createChoir,
  listChoirsForStudio,
  restoreChoir,
  updateChoir,
} from "../../modules/db/repositories/choirRepository";
import {
  archiveConductor,
  createConductor,
  listConductorsForStudio,
  restoreConductor,
  updateConductor,
} from "../../modules/db/repositories/conductorRepository";
import { createComposer } from "../../modules/db/repositories/composerRepository";
import { createMusicalWork } from "../../modules/db/repositories/musicalWorkRepository";
import { createProgramme, addProgrammeItem } from "../../modules/db/repositories/programmeRepository";
import { createVenue } from "../../modules/db/repositories/venueRepository";
import {
  addChoirToPerformance,
  addConductorToPerformance,
  addPerformerToPerformance,
  createPerformance,
} from "../../modules/db/repositories/performanceRepository";
import {
  getArtistRelatedContent,
  getChoirRelatedContent,
  getConductorRelatedContent,
} from "../../modules/db/repositories/entityRelationshipsRepository";

// Phase 6G-4F: proves the Studio Artist/Choir/Conductor catalogue
// repositories against the real database, mirroring
// tests/integration/studioComposerWorkCatalogue.test.ts and
// tests/integration/studioVenueOrganisationCatalogue.test.ts's pattern
// exactly. Real DB, disposable test-prefixed fixtures only.

const TEST_TAG = "phase6g4f";
const TEST_EMAIL = `${TEST_TAG}-integration-test@musicmadras.test`;

function uniqueSlug(base: string): string {
  return `${TEST_TAG}-${base}-${randomUUID().slice(0, 8)}`;
}

function uniqueName(base: string): string {
  return `${base} ${randomUUID().slice(0, 8)}`;
}

async function createTestUser() {
  return prisma.studioUser.create({
    data: { id: randomUUID(), email: TEST_EMAIL, name: "Phase 6G-4F Test User", role: "EDITOR", status: "ACTIVE" },
  });
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

describe("Studio permission policy for Artist/Choir/Conductor (brief Â§4, cross-checked against Â§4/Â§7/Â§16 of 6G-4C)", () => {
  it("CATALOGUE_WRITE is the only permission gating these writes â€” no new permission was introduced", () => {
    expect(can("CONTRIBUTOR", "CATALOGUE_WRITE")).toBe(false);
    expect(can("EDITOR", "CATALOGUE_WRITE")).toBe(true);
    expect(can("ADMINISTRATOR", "CATALOGUE_WRITE")).toBe(true);
  });
});

describe("Artist catalogue management against a real database", () => {
  let artistId: string | null = null;
  let userId: string | null = null;

  afterEach(async () => {
    if (artistId) {
      await cleanupArtist(artistId).catch(() => {});
      artistId = null;
    }
    if (userId) {
      await prisma.studioUser.deleteMany({ where: { id: userId } });
      userId = null;
    }
  });

  it("creates an Artist and audit-logs the creation", async () => {
    const user = await createTestUser();
    userId = user.id;

    const artist = await createArtist({ slug: uniqueSlug("artist"), name: uniqueName("QA Soloist"), instrument: "Violin", actorId: user.id });
    artistId = artist.id;

    expect(artist.instrument).toBe("Violin");
    expect(artist.archivedAt).toBeNull();
    const audit = await prisma.auditLogEntry.findMany({ where: { entityType: "Artist", entityId: artist.id, action: "ARTIST_CREATED" } });
    expect(audit).toHaveLength(1);
  });

  it("rejects a duplicate-normalized Artist name", async () => {
    const user = await createTestUser();
    userId = user.id;
    const name = uniqueName("Duplicate Test Artist");

    const first = await createArtist({ slug: uniqueSlug("artist"), name, actorId: user.id });
    artistId = first.id;

    await expect(createArtist({ slug: uniqueSlug("artist"), name: `  ${name.toUpperCase()}  `, actorId: user.id })).rejects.toThrow(DuplicateEntityError);
  });

  it("edits an Artist's fields and audit-logs before/after", async () => {
    const user = await createTestUser();
    userId = user.id;
    const artist = await createArtist({ slug: uniqueSlug("artist"), name: uniqueName("Editable Artist"), actorId: user.id });
    artistId = artist.id;

    const updated = await updateArtist(artist.id, { name: "Renamed Artist", instrument: "Cello", actorId: user.id });
    expect(updated.name).toBe("Renamed Artist");
    expect(updated.instrument).toBe("Cello");

    const audit = await prisma.auditLogEntry.findMany({ where: { entityType: "Artist", entityId: artist.id, action: "ARTIST_UPDATED" } });
    expect(audit).toHaveLength(1);
  });

  it("archives and restores an Artist, audit-logging both, without deleting the record", async () => {
    const user = await createTestUser();
    userId = user.id;
    const artist = await createArtist({ slug: uniqueSlug("artist"), name: uniqueName("Archivable Artist"), actorId: user.id });
    artistId = artist.id;

    const archived = await archiveArtist(artist.id, user.id);
    expect(archived.archivedAt).not.toBeNull();

    const restored = await restoreArtist(artist.id, user.id);
    expect(restored.archivedAt).toBeNull();

    const archiveAudit = await prisma.auditLogEntry.findMany({ where: { entityType: "Artist", entityId: artist.id, action: "ARTIST_ARCHIVED" } });
    const restoreAudit = await prisma.auditLogEntry.findMany({ where: { entityType: "Artist", entityId: artist.id, action: "ARTIST_RESTORED" } });
    expect(archiveAudit).toHaveLength(1);
    expect(restoreAudit).toHaveLength(1);
  });

  it("lists and searches Artists for Studio, including archived ones", async () => {
    const user = await createTestUser();
    userId = user.id;
    const uniqueMarker = randomUUID().slice(0, 8);
    const artist = await createArtist({ slug: uniqueSlug("artist"), name: `Searchable ${uniqueMarker} Artist`, actorId: user.id });
    artistId = artist.id;

    const found = await listArtistsForStudio(uniqueMarker);
    expect(found.map((a) => a.id)).toContain(artist.id);

    await archiveArtist(artist.id, user.id);
    const foundAfterArchive = await listArtistsForStudio(uniqueMarker);
    expect(foundAfterArchive.map((a) => a.id)).toContain(artist.id);
  });
});

describe("Choir catalogue management against a real database", () => {
  let choirId: string | null = null;
  let userId: string | null = null;

  afterEach(async () => {
    if (choirId) {
      await cleanupChoir(choirId).catch(() => {});
      choirId = null;
    }
    if (userId) {
      await prisma.studioUser.deleteMany({ where: { id: userId } });
      userId = null;
    }
  });

  it("creates a Choir and audit-logs the creation", async () => {
    const user = await createTestUser();
    userId = user.id;

    const choir = await createChoir({ slug: uniqueSlug("choir"), name: uniqueName("QA Choir"), directorName: "Jane Director", actorId: user.id });
    choirId = choir.id;

    expect(choir.directorName).toBe("Jane Director");
    const audit = await prisma.auditLogEntry.findMany({ where: { entityType: "Choir", entityId: choir.id, action: "CHOIR_CREATED" } });
    expect(audit).toHaveLength(1);
  });

  it("rejects a duplicate-normalized Choir name", async () => {
    const user = await createTestUser();
    userId = user.id;
    const name = uniqueName("Duplicate Test Choir");

    const first = await createChoir({ slug: uniqueSlug("choir"), name, actorId: user.id });
    choirId = first.id;

    await expect(createChoir({ slug: uniqueSlug("choir"), name: `  ${name.toUpperCase()}  `, actorId: user.id })).rejects.toThrow(DuplicateEntityError);
  });

  it("edits a Choir's fields and audit-logs before/after", async () => {
    const user = await createTestUser();
    userId = user.id;
    const choir = await createChoir({ slug: uniqueSlug("choir"), name: uniqueName("Editable Choir"), actorId: user.id });
    choirId = choir.id;

    const updated = await updateChoir(choir.id, { name: "Renamed Choir", directorName: "New Director", actorId: user.id });
    expect(updated.name).toBe("Renamed Choir");
    expect(updated.directorName).toBe("New Director");

    const audit = await prisma.auditLogEntry.findMany({ where: { entityType: "Choir", entityId: choir.id, action: "CHOIR_UPDATED" } });
    expect(audit).toHaveLength(1);
  });

  it("archives and restores a Choir, audit-logging both, without deleting the record", async () => {
    const user = await createTestUser();
    userId = user.id;
    const choir = await createChoir({ slug: uniqueSlug("choir"), name: uniqueName("Archivable Choir"), actorId: user.id });
    choirId = choir.id;

    const archived = await archiveChoir(choir.id, user.id);
    expect(archived.archivedAt).not.toBeNull();

    const restored = await restoreChoir(choir.id, user.id);
    expect(restored.archivedAt).toBeNull();

    const archiveAudit = await prisma.auditLogEntry.findMany({ where: { entityType: "Choir", entityId: choir.id, action: "CHOIR_ARCHIVED" } });
    const restoreAudit = await prisma.auditLogEntry.findMany({ where: { entityType: "Choir", entityId: choir.id, action: "CHOIR_RESTORED" } });
    expect(archiveAudit).toHaveLength(1);
    expect(restoreAudit).toHaveLength(1);
  });

  it("lists and searches Choirs for Studio, including archived ones", async () => {
    const user = await createTestUser();
    userId = user.id;
    const uniqueMarker = randomUUID().slice(0, 8);
    const choir = await createChoir({ slug: uniqueSlug("choir"), name: `Searchable ${uniqueMarker} Choir`, actorId: user.id });
    choirId = choir.id;

    const found = await listChoirsForStudio(uniqueMarker);
    expect(found.map((c) => c.id)).toContain(choir.id);

    await archiveChoir(choir.id, user.id);
    const foundAfterArchive = await listChoirsForStudio(uniqueMarker);
    expect(foundAfterArchive.map((c) => c.id)).toContain(choir.id);
  });
});

describe("Conductor catalogue management against a real database", () => {
  let conductorId: string | null = null;
  let userId: string | null = null;

  afterEach(async () => {
    if (conductorId) {
      await cleanupConductor(conductorId).catch(() => {});
      conductorId = null;
    }
    if (userId) {
      await prisma.studioUser.deleteMany({ where: { id: userId } });
      userId = null;
    }
  });

  it("creates a Conductor and audit-logs the creation", async () => {
    const user = await createTestUser();
    userId = user.id;

    const conductor = await createConductor({ slug: uniqueSlug("conductor"), name: uniqueName("QA Conductor"), biography: "A test biography.", actorId: user.id });
    conductorId = conductor.id;

    expect(conductor.biography).toBe("A test biography.");
    const audit = await prisma.auditLogEntry.findMany({
      where: { entityType: "Conductor", entityId: conductor.id, action: "CONDUCTOR_CREATED" },
    });
    expect(audit).toHaveLength(1);
  });

  it("rejects a duplicate-normalized Conductor name", async () => {
    const user = await createTestUser();
    userId = user.id;
    const name = uniqueName("Duplicate Test Conductor");

    const first = await createConductor({ slug: uniqueSlug("conductor"), name, actorId: user.id });
    conductorId = first.id;

    await expect(createConductor({ slug: uniqueSlug("conductor"), name: `  ${name.toUpperCase()}  `, actorId: user.id })).rejects.toThrow(DuplicateEntityError);
  });

  it("edits a Conductor's fields and audit-logs before/after", async () => {
    const user = await createTestUser();
    userId = user.id;
    const conductor = await createConductor({ slug: uniqueSlug("conductor"), name: uniqueName("Editable Conductor"), actorId: user.id });
    conductorId = conductor.id;

    const updated = await updateConductor(conductor.id, { name: "Renamed Conductor", biography: "New bio.", actorId: user.id });
    expect(updated.name).toBe("Renamed Conductor");
    expect(updated.biography).toBe("New bio.");

    const audit = await prisma.auditLogEntry.findMany({
      where: { entityType: "Conductor", entityId: conductor.id, action: "CONDUCTOR_UPDATED" },
    });
    expect(audit).toHaveLength(1);
  });

  it("archives and restores a Conductor, audit-logging both, without deleting the record", async () => {
    const user = await createTestUser();
    userId = user.id;
    const conductor = await createConductor({ slug: uniqueSlug("conductor"), name: uniqueName("Archivable Conductor"), actorId: user.id });
    conductorId = conductor.id;

    const archived = await archiveConductor(conductor.id, user.id);
    expect(archived.archivedAt).not.toBeNull();

    const restored = await restoreConductor(conductor.id, user.id);
    expect(restored.archivedAt).toBeNull();

    const archiveAudit = await prisma.auditLogEntry.findMany({
      where: { entityType: "Conductor", entityId: conductor.id, action: "CONDUCTOR_ARCHIVED" },
    });
    const restoreAudit = await prisma.auditLogEntry.findMany({
      where: { entityType: "Conductor", entityId: conductor.id, action: "CONDUCTOR_RESTORED" },
    });
    expect(archiveAudit).toHaveLength(1);
    expect(restoreAudit).toHaveLength(1);
  });

  it("lists and searches Conductors for Studio, including archived ones", async () => {
    const user = await createTestUser();
    userId = user.id;
    const uniqueMarker = randomUUID().slice(0, 8);
    const conductor = await createConductor({ slug: uniqueSlug("conductor"), name: `Searchable ${uniqueMarker} Conductor`, actorId: user.id });
    conductorId = conductor.id;

    const found = await listConductorsForStudio(uniqueMarker);
    expect(found.map((c) => c.id)).toContain(conductor.id);

    await archiveConductor(conductor.id, user.id);
    const foundAfterArchive = await listConductorsForStudio(uniqueMarker);
    expect(foundAfterArchive.map((c) => c.id)).toContain(conductor.id);
  });
});

describe("Performance relationship preservation through archive/restore (brief Â§15/Â§22)", () => {
  let userId: string | null = null;
  let composerId: string | null = null;
  let workId: string | null = null;
  let programmeId: string | null = null;
  let venueId: string | null = null;
  let performanceId: string | null = null;
  let artistId: string | null = null;
  let choirId: string | null = null;
  let conductorId: string | null = null;
  let cleanupPublished: (() => Promise<void>) | null = null;

  afterEach(async () => {
    // The published Recording references the Performance and Work (RESTRICT), so it goes first.
    if (cleanupPublished) {
      await cleanupPublished().catch(() => {});
      cleanupPublished = null;
    }
    if (performanceId) {
      await prisma.auditLogEntry.deleteMany({ where: { entityType: "Performance", entityId: performanceId } });
      await prisma.performance.delete({ where: { id: performanceId } }).catch(() => {});
      performanceId = null;
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
    if (venueId) {
      await prisma.auditLogEntry.deleteMany({ where: { entityType: "Venue", entityId: venueId } });
      await prisma.venue.delete({ where: { id: venueId } }).catch(() => {});
      venueId = null;
    }
    if (programmeId) {
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
    if (userId) {
      await prisma.studioUser.deleteMany({ where: { id: userId } });
      userId = null;
    }
  });

  it("archiving an Artist/Choir/Conductor never removes its PerformancePerformer/PerformanceChoir/PerformanceConductor join row", async () => {
    const user = await createTestUser();
    userId = user.id;

    // A minimal Performance fixture â€” just enough to attach participants to, not a full Recording chain.
    const composer = await createComposer({ slug: uniqueSlug("composer"), name: uniqueName("Fixture Composer"), actorId: user.id });
    composerId = composer.id;
    const work = await createMusicalWork({ slug: uniqueSlug("work"), title: "Fixture Work", composerId: composer.id, actorId: user.id });
    workId = work.id;
    const programme = await createProgramme({ slug: uniqueSlug("programme"), title: "Fixture Programme", actorId: user.id });
    programmeId = programme.id;
    await addProgrammeItem({ programmeId: programme.id, musicalWorkId: work.id, actorId: user.id });
    const venue = await createVenue({ slug: uniqueSlug("venue"), name: uniqueName("Fixture Venue"), type: "CHURCH", actorId: user.id });
    venueId = venue.id;
    const performance = await createPerformance({ programmeId: programme.id, venueId: venue.id, actorId: user.id });
    performanceId = performance.id;

    const artist = await createArtist({ slug: uniqueSlug("artist"), name: uniqueName("Relationship Artist"), actorId: user.id });
    artistId = artist.id;
    const choir = await createChoir({ slug: uniqueSlug("choir"), name: uniqueName("Relationship Choir"), actorId: user.id });
    choirId = choir.id;
    const conductor = await createConductor({ slug: uniqueSlug("conductor"), name: uniqueName("Relationship Conductor"), actorId: user.id });
    conductorId = conductor.id;

    await addPerformerToPerformance(performance.id, artist.id, "Soloist", user.id);
    await addChoirToPerformance(performance.id, choir.id, user.id);
    await addConductorToPerformance(performance.id, conductor.id, user.id);

    // Public discovery is eligibility-based (Phase 6J-1): the Performance resolves for its participants only while a published Recording reaches it.
    cleanupPublished = (await publishRecordingFor({ actorId: user.id, performanceId: performance.id, workIds: [work.id] })).cleanup;

    await archiveArtist(artist.id, user.id);
    await archiveChoir(choir.id, user.id);
    await archiveConductor(conductor.id, user.id);

    // The join rows themselves are untouched by archiving the entity.
    const performerLink = await prisma.performancePerformer.findUnique({
      where: { performanceId_artistId: { performanceId: performance.id, artistId: artist.id } },
    });
    const choirLink = await prisma.performanceChoir.findUnique({
      where: { performanceId_choirId: { performanceId: performance.id, choirId: choir.id } },
    });
    const conductorLink = await prisma.performanceConductor.findUnique({
      where: { performanceId_conductorId: { performanceId: performance.id, conductorId: conductor.id } },
    });
    expect(performerLink).not.toBeNull();
    expect(choirLink).not.toBeNull();
    expect(conductorLink).not.toBeNull();

    // And the relationship layer still resolves the Performance for each, even while archived.
    const artistContent = await getArtistRelatedContent(artist.id);
    const choirContent = await getChoirRelatedContent(choir.id);
    const conductorContent = await getConductorRelatedContent(conductor.id);
    expect(artistContent.performances.map((p) => p.id)).toContain(performance.id);
    expect(choirContent.performances.map((p) => p.id)).toContain(performance.id);
    expect(conductorContent.performances.map((p) => p.id)).toContain(performance.id);
  });
});
