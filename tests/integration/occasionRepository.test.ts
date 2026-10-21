import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { prisma } from "../../modules/db/client";
import { DuplicateEntityError } from "../../modules/mmke/duplicate-detection/detectDuplicateName";
import { SlugConflictError } from "../../modules/mmke/slug/SlugConflictError";
import { UnsupportedOccasionEntityTypeError } from "../../modules/mmke/occasion/occasionEntityType";
import { LegacyRecordingRelationshipsFrozenError } from "../../modules/mmke/provenance/legacyRecordingRelationshipsFrozen";
import {
  archiveOccasion,
  attachOccasionToEntity,
  createOccasion,
  detachOccasionFromEntity,
  findOccasionBySlug,
  listActiveOccasions,
  listOccasionsForEntity,
  listOccasionsForStudio,
  restoreOccasion,
  updateOccasion,
} from "../../modules/db/repositories/occasionRepository";
import { createProgramme, archiveProgramme } from "../../modules/db/repositories/programmeRepository";
import { createVenue } from "../../modules/db/repositories/venueRepository";
import { createPerformance } from "../../modules/db/repositories/performanceRepository";
import { createDraftRecording, publishCurrentDraft, updateDraftRevisionContent } from "../../modules/db/repositories/recordingRepository";
import { createCollection } from "../../modules/db/repositories/collectionRepository";

// Phase 6G-12: proves the Occasion repository (schema + attachment layer)
// against the real database. Real DB, disposable test-prefixed fixtures
// only — mirrors the established pattern in
// tests/integration/studioComposerWorkCatalogue.test.ts.

const TEST_TAG = "phase6g12";

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
      name: "Phase 6G-12 Test User",
      role: "EDITOR",
      status: "ACTIVE",
    },
  });
}

async function cleanupOccasion(occasionId: string) {
  await prisma.entityOccasion.deleteMany({ where: { occasionId } });
  await prisma.auditLogEntry.deleteMany({ where: { entityType: "Occasion", entityId: occasionId } });
  await prisma.occasion.delete({ where: { id: occasionId } }).catch(() => {});
}

describe("Occasion CRUD against a real database", () => {
  let occasionId: string | null = null;
  let userId: string | null = null;

  afterEach(async () => {
    if (occasionId) {
      await cleanupOccasion(occasionId).catch(() => {});
      occasionId = null;
    }
    if (userId) {
      await prisma.studioUser.deleteMany({ where: { id: userId } });
      userId = null;
    }
  });

  it("creates an Occasion and audit-logs the creation", async () => {
    const user = await createTestUser();
    userId = user.id;

    const occasion = await createOccasion({
      slug: uniqueSlug("christmas"),
      name: uniqueName("Christmas"),
      description: "The Nativity of Christ.",
      actorId: user.id,
    });
    occasionId = occasion.id;

    expect(occasion.archivedAt).toBeNull();
    expect(occasion.description).toBe("The Nativity of Christ.");

    const audit = await prisma.auditLogEntry.findMany({ where: { entityType: "Occasion", entityId: occasion.id, action: "OCCASION_CREATED" } });
    expect(audit).toHaveLength(1);
  });

  it("rejects a duplicate-normalized name, and rejects a colliding slug for a different name", async () => {
    const user = await createTestUser();
    userId = user.id;
    const name = uniqueName("Easter");

    const first = await createOccasion({ slug: uniqueSlug("easter"), name, actorId: user.id });
    occasionId = first.id;

    await expect(createOccasion({ slug: uniqueSlug("easter"), name: `  ${name.toUpperCase()}  `, actorId: user.id })).rejects.toThrow(
      DuplicateEntityError
    );

    const collidingSlug = uniqueSlug("collision");
    const second = await createOccasion({ slug: collidingSlug, name: uniqueName("Totally Different Occasion"), actorId: user.id });
    try {
      await expect(createOccasion({ slug: collidingSlug, name: uniqueName("Yet Another Occasion"), actorId: user.id })).rejects.toThrow(
        SlugConflictError
      );
    } finally {
      await cleanupOccasion(second.id);
    }
  });

  it("edits an Occasion's fields, keeping the slug stable, and audit-logs before/after", async () => {
    const user = await createTestUser();
    userId = user.id;
    const occasion = await createOccasion({ slug: uniqueSlug("advent"), name: uniqueName("Advent"), actorId: user.id });
    occasionId = occasion.id;

    const updated = await updateOccasion(occasion.id, { name: "Renamed Advent", description: "Updated description.", actorId: user.id });
    expect(updated.name).toBe("Renamed Advent");
    expect(updated.slug).toBe(occasion.slug); // ordinary name edits never regenerate the slug

    const audit = await prisma.auditLogEntry.findMany({ where: { entityType: "Occasion", entityId: occasion.id, action: "OCCASION_UPDATED" } });
    expect(audit).toHaveLength(1);
  });

  it("lists and searches Occasions for Studio, including archived ones", async () => {
    const user = await createTestUser();
    userId = user.id;
    const marker = randomUUID().slice(0, 8);
    const occasion = await createOccasion({ slug: uniqueSlug("search"), name: `Searchable ${marker} Occasion`, actorId: user.id });
    occasionId = occasion.id;

    const found = await listOccasionsForStudio(marker);
    expect(found.map((o) => o.id)).toContain(occasion.id);

    await archiveOccasion(occasion.id, user.id);
    const foundAfterArchive = await listOccasionsForStudio(marker);
    expect(foundAfterArchive.map((o) => o.id)).toContain(occasion.id); // Studio list includes archived
    const activeAfterArchive = await listActiveOccasions();
    expect(activeAfterArchive.map((o) => o.id)).not.toContain(occasion.id); // active list excludes it
  });

  it("archives and restores an Occasion, audit-logging both, without deleting the record", async () => {
    const user = await createTestUser();
    userId = user.id;
    const occasion = await createOccasion({ slug: uniqueSlug("goodfriday"), name: uniqueName("Good Friday"), actorId: user.id });
    occasionId = occasion.id;

    const archived = await archiveOccasion(occasion.id, user.id);
    expect(archived.archivedAt).not.toBeNull();
    expect(await findOccasionBySlug(occasion.slug)).not.toBeNull();

    const restored = await restoreOccasion(occasion.id, user.id);
    expect(restored.archivedAt).toBeNull();

    const archiveAudit = await prisma.auditLogEntry.findMany({ where: { entityType: "Occasion", entityId: occasion.id, action: "OCCASION_ARCHIVED" } });
    const restoreAudit = await prisma.auditLogEntry.findMany({ where: { entityType: "Occasion", entityId: occasion.id, action: "OCCASION_RESTORED" } });
    expect(archiveAudit).toHaveLength(1);
    expect(restoreAudit).toHaveLength(1);
  });
});

describe("Occasion attachment (EntityOccasion) against a real database", () => {
  let occasionId: string | null = null;
  let userId: string | null = null;
  let programmeId: string | null = null;
  let performanceId: string | null = null;
  let venueId: string | null = null;
  let recordingId: string | null = null;
  let collectionId: string | null = null;

  afterEach(async () => {
    if (collectionId) {
      await prisma.entityOccasion.deleteMany({ where: { entityType: "COLLECTION", entityId: collectionId } });
      await prisma.auditLogEntry.deleteMany({ where: { entityType: "COLLECTION", entityId: collectionId } });
      await prisma.auditLogEntry.deleteMany({ where: { entityType: "Collection", entityId: collectionId } });
      await prisma.collection.delete({ where: { id: collectionId } }).catch(() => {});
      collectionId = null;
    }
    if (recordingId) {
      await prisma.entityOccasion.deleteMany({ where: { entityType: "RECORDING", entityId: recordingId } });
      const revisions = await prisma.recordingRevision.findMany({ where: { recordingId }, select: { id: true } });
      await prisma.auditLogEntry.deleteMany({ where: { entityType: "RECORDING", entityId: recordingId } });
      await prisma.auditLogEntry.deleteMany({ where: { entityType: "Recording", entityId: recordingId } });
      if (revisions.length > 0) {
        await prisma.auditLogEntry.deleteMany({ where: { entityType: "RecordingRevision", entityId: { in: revisions.map((r) => r.id) } } });
      }
      await prisma.recording.delete({ where: { id: recordingId } }).catch(() => {});
      recordingId = null;
    }
    if (performanceId) {
      await prisma.entityOccasion.deleteMany({ where: { entityType: "PERFORMANCE", entityId: performanceId } });
      await prisma.auditLogEntry.deleteMany({ where: { entityType: "PERFORMANCE", entityId: performanceId } });
      await prisma.auditLogEntry.deleteMany({ where: { entityType: "Performance", entityId: performanceId } });
      await prisma.performance.delete({ where: { id: performanceId } }).catch(() => {});
      performanceId = null;
    }
    if (programmeId) {
      await prisma.entityOccasion.deleteMany({ where: { entityType: "PROGRAMME", entityId: programmeId } });
      await prisma.auditLogEntry.deleteMany({ where: { entityType: "PROGRAMME", entityId: programmeId } });
      await prisma.auditLogEntry.deleteMany({ where: { entityType: "Programme", entityId: programmeId } });
      await prisma.programme.delete({ where: { id: programmeId } }).catch(() => {});
      programmeId = null;
    }
    if (venueId) {
      await prisma.auditLogEntry.deleteMany({ where: { entityType: "Venue", entityId: venueId } });
      await prisma.venue.delete({ where: { id: venueId } }).catch(() => {});
      venueId = null;
    }
    if (occasionId) {
      await cleanupOccasion(occasionId).catch(() => {});
      occasionId = null;
    }
    if (userId) {
      await prisma.studioUser.deleteMany({ where: { id: userId } });
      userId = null;
    }
  });

  it("attaches an Occasion to a Programme, a Performance, a Recording, and a Collection, each audit-logged", async () => {
    const user = await createTestUser();
    userId = user.id;
    const occasion = await createOccasion({ slug: uniqueSlug("christmas-eve"), name: uniqueName("Christmas Eve"), actorId: user.id });
    occasionId = occasion.id;

    const programme = await createProgramme({ slug: uniqueSlug("programme"), title: "Test Programme", actorId: user.id });
    programmeId = programme.id;
    const venue = await createVenue({ slug: uniqueSlug("venue"), name: uniqueName("Test Venue"), type: "CONCERT_HALL", actorId: user.id });
    venueId = venue.id;
    const performance = await createPerformance({ programmeId: programme.id, venueId: venue.id, performanceDate: new Date("2023-12-24"), actorId: user.id });
    performanceId = performance.id;
    const draft = await createDraftRecording({ slug: uniqueSlug("recording"), actorId: user.id, title: "Test Recording" });
    await updateDraftRevisionContent(draft.id, draft.currentDraftRevision!.updatedAt, user.id, { performanceId: performance.id });
    const recording = await publishCurrentDraft(draft.id, user.id);
    recordingId = recording.id;
    const collection = await createCollection({ slug: uniqueSlug("collection"), title: "Test Collection", actorId: user.id });
    collectionId = collection.id;

    await attachOccasionToEntity({ entityType: "PROGRAMME", entityId: programme.id, occasionId: occasion.id, actorId: user.id });
    await attachOccasionToEntity({ entityType: "PERFORMANCE", entityId: performance.id, occasionId: occasion.id, actorId: user.id });
    await attachOccasionToEntity({ entityType: "COLLECTION", entityId: collection.id, occasionId: occasion.id, actorId: user.id });
    // Phase 6L: a Recording's occasions belong to a draft revision; the generic writers refuse the frozen legacy entity type and write nothing.
    await expect(attachOccasionToEntity({ entityType: "RECORDING", entityId: recording.id, occasionId: occasion.id, actorId: user.id })).rejects.toBeInstanceOf(LegacyRecordingRelationshipsFrozenError);
    await expect(detachOccasionFromEntity("RECORDING", recording.id, occasion.id, user.id)).rejects.toBeInstanceOf(LegacyRecordingRelationshipsFrozenError);
    expect(await prisma.entityOccasion.count({ where: { entityType: "RECORDING", entityId: recording.id } })).toBe(0);

    expect((await listOccasionsForEntity("PROGRAMME", programme.id)).map((l) => l.occasionId)).toEqual([occasion.id]);
    expect((await listOccasionsForEntity("PERFORMANCE", performance.id)).map((l) => l.occasionId)).toEqual([occasion.id]);
    expect((await listOccasionsForEntity("COLLECTION", collection.id)).map((l) => l.occasionId)).toEqual([occasion.id]);

    for (const entityType of ["PROGRAMME", "PERFORMANCE", "COLLECTION"]) {
      const audit = await prisma.auditLogEntry.findMany({ where: { entityType, action: "OCCASION_ATTACHED" } });
      expect(audit.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("prevents attaching the same Occasion to the same entity twice", async () => {
    const user = await createTestUser();
    userId = user.id;
    const occasion = await createOccasion({ slug: uniqueSlug("epiphany"), name: uniqueName("Epiphany"), actorId: user.id });
    occasionId = occasion.id;
    const programme = await createProgramme({ slug: uniqueSlug("programme"), title: "Duplicate Attach Programme", actorId: user.id });
    programmeId = programme.id;

    await attachOccasionToEntity({ entityType: "PROGRAMME", entityId: programme.id, occasionId: occasion.id, actorId: user.id });
    await expect(
      attachOccasionToEntity({ entityType: "PROGRAMME", entityId: programme.id, occasionId: occasion.id, actorId: user.id })
    ).rejects.toThrow();

    expect(await listOccasionsForEntity("PROGRAMME", programme.id)).toHaveLength(1);
  });

  it("detaches an Occasion, audit-logging it, without affecting other attachments", async () => {
    const user = await createTestUser();
    userId = user.id;
    const occasion = await createOccasion({ slug: uniqueSlug("palmsunday"), name: uniqueName("Palm Sunday"), actorId: user.id });
    occasionId = occasion.id;
    const programme = await createProgramme({ slug: uniqueSlug("programme"), title: "Detach Programme", actorId: user.id });
    programmeId = programme.id;

    await attachOccasionToEntity({ entityType: "PROGRAMME", entityId: programme.id, occasionId: occasion.id, actorId: user.id });
    await detachOccasionFromEntity("PROGRAMME", programme.id, occasion.id, user.id);

    expect(await listOccasionsForEntity("PROGRAMME", programme.id)).toHaveLength(0);
    const audit = await prisma.auditLogEntry.findMany({ where: { entityType: "PROGRAMME", entityId: programme.id, action: "OCCASION_DETACHED" } });
    expect(audit).toHaveLength(1);
  });

  it("rejects newly attaching an archived Occasion", async () => {
    const user = await createTestUser();
    userId = user.id;
    const occasion = await createOccasion({ slug: uniqueSlug("weddings"), name: uniqueName("Weddings"), actorId: user.id });
    occasionId = occasion.id;
    await archiveOccasion(occasion.id, user.id);
    const programme = await createProgramme({ slug: uniqueSlug("programme"), title: "Archived Occasion Programme", actorId: user.id });
    programmeId = programme.id;

    await expect(
      attachOccasionToEntity({ entityType: "PROGRAMME", entityId: programme.id, occasionId: occasion.id, actorId: user.id })
    ).rejects.toThrow(/archived/i);

    expect(await listOccasionsForEntity("PROGRAMME", programme.id)).toHaveLength(0);
  });

  it("keeps an existing attachment valid and resolvable after the Occasion is later archived", async () => {
    const user = await createTestUser();
    userId = user.id;
    const occasion = await createOccasion({ slug: uniqueSlug("memorial"), name: uniqueName("Memorial Service"), actorId: user.id });
    occasionId = occasion.id;
    const programme = await createProgramme({ slug: uniqueSlug("programme"), title: "Memorial Programme", actorId: user.id });
    programmeId = programme.id;

    await attachOccasionToEntity({ entityType: "PROGRAMME", entityId: programme.id, occasionId: occasion.id, actorId: user.id });
    await archiveOccasion(occasion.id, user.id);

    const links = await listOccasionsForEntity("PROGRAMME", programme.id);
    expect(links).toHaveLength(1);
    expect(links[0].occasion.archivedAt).not.toBeNull(); // historically resolvable, correctly flagged as archived
  });

  it("rejects an unsupported entity type (WORK), never attaching it", async () => {
    const user = await createTestUser();
    userId = user.id;
    const occasion = await createOccasion({ slug: uniqueSlug("independence"), name: uniqueName("Independence Day"), actorId: user.id });
    occasionId = occasion.id;

    await expect(
      attachOccasionToEntity({ entityType: "WORK", entityId: randomUUID(), occasionId: occasion.id, actorId: user.id })
    ).rejects.toThrow(UnsupportedOccasionEntityTypeError);

    expect(await prisma.entityOccasion.count({ where: { entityType: "WORK" } })).toBe(0);
  });

  it("orphan protection: archiving the Programme leaves its EntityOccasion attachment intact and resolvable (no silent orphan)", async () => {
    const user = await createTestUser();
    userId = user.id;
    const occasion = await createOccasion({ slug: uniqueSlug("anniversary"), name: uniqueName("Church Anniversary"), actorId: user.id });
    occasionId = occasion.id;
    const programme = await createProgramme({ slug: uniqueSlug("programme"), title: "Orphan-check Programme", actorId: user.id });
    programmeId = programme.id;

    await attachOccasionToEntity({ entityType: "PROGRAMME", entityId: programme.id, occasionId: occasion.id, actorId: user.id });
    await archiveProgramme(programme.id, user.id);

    const links = await listOccasionsForEntity("PROGRAMME", programme.id);
    expect(links).toHaveLength(1);
    expect(links[0].occasion.id).toBe(occasion.id);
  });

  it("referential integrity: hard-deleting the Occasion row cascades and removes its EntityOccasion attachments (never left orphaned)", async () => {
    const user = await createTestUser();
    userId = user.id;
    const occasion = await createOccasion({ slug: uniqueSlug("cascade"), name: uniqueName("Cascade Test Occasion"), actorId: user.id });
    const programme = await createProgramme({ slug: uniqueSlug("programme"), title: "Cascade Programme", actorId: user.id });
    programmeId = programme.id;

    await attachOccasionToEntity({ entityType: "PROGRAMME", entityId: programme.id, occasionId: occasion.id, actorId: user.id });
    expect(await prisma.entityOccasion.count({ where: { occasionId: occasion.id } })).toBe(1);

    // Simulates the DB-level safety net for a hypothetical hard delete —
    // application code never exposes this (Occasion is archive/restore
    // only, mirroring Composer), but the FK's onDelete: Cascade must still
    // hold so no EntityOccasion row can ever be left pointing at nothing.
    await prisma.auditLogEntry.deleteMany({ where: { entityType: "Occasion", entityId: occasion.id } });
    await prisma.occasion.delete({ where: { id: occasion.id } });

    expect(await prisma.entityOccasion.count({ where: { occasionId: occasion.id } })).toBe(0);
  });
});
