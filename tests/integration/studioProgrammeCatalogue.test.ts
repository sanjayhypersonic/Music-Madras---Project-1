import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { prisma } from "../../modules/db/client";
import { can } from "../../modules/auth/policy";
import { SlugConflictError } from "../../modules/mmke/slug/SlugConflictError";
import { createComposer } from "../../modules/db/repositories/composerRepository";
import { createMusicalWork } from "../../modules/db/repositories/musicalWorkRepository";
import {
  addProgrammeItem,
  archiveProgramme,
  createProgramme,
  findProgrammeById,
  listProgrammes,
  listProgrammesForStudio,
  removeProgrammeItem,
  reorderProgrammeItem,
  restoreProgramme,
  updateProgramme,
} from "../../modules/db/repositories/programmeRepository";

// Phase 6G-4G: proves the Studio Programme catalogue repository against
// the real database, mirroring tests/integration/studioComposerWorkCatalogue.test.ts
// and its siblings' pattern exactly. Real DB, disposable test-prefixed
// fixtures only.

const TEST_TAG = "phase6g4g";
const TEST_EMAIL = `${TEST_TAG}-integration-test@musicmadras.test`;

function uniqueSlug(base: string): string {
  return `${TEST_TAG}-${base}-${randomUUID().slice(0, 8)}`;
}

async function createTestUser() {
  return prisma.studioUser.create({
    data: { id: randomUUID(), email: TEST_EMAIL, name: "Phase 6G-4G Test User", role: "EDITOR", status: "ACTIVE" },
  });
}

async function cleanupProgramme(programmeId: string) {
  await prisma.auditLogEntry.deleteMany({ where: { entityType: "Programme", entityId: programmeId } });
  await prisma.programme.delete({ where: { id: programmeId } }); // cascades ProgrammeItem
}

async function cleanupWork(workId: string) {
  await prisma.auditLogEntry.deleteMany({ where: { entityType: "MusicalWork", entityId: workId } });
  await prisma.musicalWork.delete({ where: { id: workId } });
}

async function cleanupComposer(composerId: string) {
  await prisma.auditLogEntry.deleteMany({ where: { entityType: "Composer", entityId: composerId } });
  await prisma.composer.delete({ where: { id: composerId } });
}

describe("Studio permission policy for Programme (brief §4, cross-checked against 6G-4C/E/F)", () => {
  it("CATALOGUE_WRITE is the only permission gating Programme writes — no new permission was introduced", () => {
    expect(can("CONTRIBUTOR", "CATALOGUE_WRITE")).toBe(false);
    expect(can("EDITOR", "CATALOGUE_WRITE")).toBe(true);
    expect(can("ADMINISTRATOR", "CATALOGUE_WRITE")).toBe(true);
  });
});

describe("Programme catalogue management against a real database", () => {
  let programmeId: string | null = null;
  let userId: string | null = null;

  afterEach(async () => {
    if (programmeId) {
      await cleanupProgramme(programmeId).catch(() => {});
      programmeId = null;
    }
    if (userId) {
      await prisma.studioUser.deleteMany({ where: { id: userId } });
      userId = null;
    }
  });

  it("creates a Programme and audit-logs the creation", async () => {
    const user = await createTestUser();
    userId = user.id;

    const programme = await createProgramme({ slug: uniqueSlug("programme"), title: "QA Christmas Concert", notes: "A test note.", actorId: user.id });
    programmeId = programme.id;

    expect(programme.notes).toBe("A test note.");
    expect(programme.archivedAt).toBeNull();
    const audit = await prisma.auditLogEntry.findMany({ where: { entityType: "Programme", entityId: programme.id, action: "PROGRAMME_CREATED" } });
    expect(audit).toHaveLength(1);
  });

  it("does not reject a repeated Programme title — unlike Composer/Choir/Venue, titles legitimately recur", async () => {
    const user = await createTestUser();
    userId = user.id;
    const title = "QA Annual Founders Day Concert";

    const first = await createProgramme({ slug: uniqueSlug("programme"), title, actorId: user.id });
    programmeId = first.id;

    const second = await createProgramme({ slug: uniqueSlug("programme"), title, actorId: user.id });
    await cleanupProgramme(second.id);
  });

  it("rejects a colliding slug for a different Programme", async () => {
    const user = await createTestUser();
    userId = user.id;
    const collidingSlug = uniqueSlug("collision");

    const first = await createProgramme({ slug: collidingSlug, title: "First Programme", actorId: user.id });
    programmeId = first.id;

    await expect(createProgramme({ slug: collidingSlug, title: "A Different Title", actorId: user.id })).rejects.toThrow(SlugConflictError);
  });

  it("edits a Programme's fields, keeping the slug immutable", async () => {
    const user = await createTestUser();
    userId = user.id;
    const programme = await createProgramme({ slug: uniqueSlug("programme"), title: "Editable Programme", actorId: user.id });
    programmeId = programme.id;

    const updated = await updateProgramme(programme.id, { title: "Renamed Programme", notes: "Updated notes.", actorId: user.id });
    expect(updated.title).toBe("Renamed Programme");
    expect(updated.notes).toBe("Updated notes.");
    expect(updated.slug).toBe(programme.slug);

    const audit = await prisma.auditLogEntry.findMany({ where: { entityType: "Programme", entityId: programme.id, action: "PROGRAMME_UPDATED" } });
    expect(audit).toHaveLength(1);
  });

  it("archives and restores a Programme, audit-logging both, without deleting the record", async () => {
    const user = await createTestUser();
    userId = user.id;
    const programme = await createProgramme({ slug: uniqueSlug("programme"), title: "Archivable Programme", actorId: user.id });
    programmeId = programme.id;

    const archived = await archiveProgramme(programme.id, user.id);
    expect(archived.archivedAt).not.toBeNull();
    expect(await findProgrammeById(programme.id)).not.toBeNull();

    const restored = await restoreProgramme(programme.id, user.id);
    expect(restored.archivedAt).toBeNull();

    const archiveAudit = await prisma.auditLogEntry.findMany({ where: { entityType: "Programme", entityId: programme.id, action: "PROGRAMME_ARCHIVED" } });
    const restoreAudit = await prisma.auditLogEntry.findMany({ where: { entityType: "Programme", entityId: programme.id, action: "PROGRAMME_RESTORED" } });
    expect(archiveAudit).toHaveLength(1);
    expect(restoreAudit).toHaveLength(1);
  });

  it("lists and searches Programmes for Studio, including archived ones, with an item count", async () => {
    const user = await createTestUser();
    userId = user.id;
    const uniqueMarker = randomUUID().slice(0, 8);
    const programme = await createProgramme({ slug: uniqueSlug("programme"), title: `Searchable ${uniqueMarker} Programme`, actorId: user.id });
    programmeId = programme.id;

    const found = await listProgrammesForStudio(uniqueMarker);
    expect(found.map((p) => p.id)).toContain(programme.id);
    expect(found.find((p) => p.id === programme.id)?._count.items).toBe(0);

    await archiveProgramme(programme.id, user.id);
    const foundAfterArchive = await listProgrammesForStudio(uniqueMarker);
    expect(foundAfterArchive.map((p) => p.id)).toContain(programme.id); // Studio list includes archived

    // The pre-existing Recording-wizard-facing listProgrammes() must keep excluding archived rows, unchanged.
    const activeOnly = await listProgrammes();
    expect(activeOnly.map((p) => p.id)).not.toContain(programme.id);
  });
});

describe("ProgrammeItem management (add/remove/reorder) against a real database", () => {
  let programmeId: string | null = null;
  let workIds: string[] = [];
  let composerId: string | null = null;
  let userId: string | null = null;

  afterEach(async () => {
    if (programmeId) {
      await cleanupProgramme(programmeId).catch(() => {});
      programmeId = null;
    }
    for (const workId of workIds) {
      await cleanupWork(workId).catch(() => {});
    }
    workIds = [];
    if (composerId) {
      await cleanupComposer(composerId).catch(() => {});
      composerId = null;
    }
    if (userId) {
      await prisma.studioUser.deleteMany({ where: { id: userId } });
      userId = null;
    }
  });

  it("adds works to a programme's running order, audit-logging each addition", async () => {
    const user = await createTestUser();
    userId = user.id;
    const composer = await createComposer({ slug: uniqueSlug("composer"), name: "QA Composer", actorId: user.id });
    composerId = composer.id;
    const work = await createMusicalWork({ slug: uniqueSlug("work"), title: "QA Work", composerId: composer.id, actorId: user.id });
    workIds.push(work.id);
    const programme = await createProgramme({ slug: uniqueSlug("programme"), title: "QA Programme", actorId: user.id });
    programmeId = programme.id;

    const item = await addProgrammeItem({ programmeId: programme.id, musicalWorkId: work.id, movement: "I. Allegro", actorId: user.id });
    expect(item.order).toBe(1);
    expect(item.movement).toBe("I. Allegro");

    const loaded = await findProgrammeById(programme.id);
    expect(loaded?.items).toHaveLength(1);

    const audit = await prisma.auditLogEntry.findMany({ where: { entityType: "Programme", entityId: programme.id, action: "PROGRAMME_ITEM_ADDED" } });
    expect(audit).toHaveLength(1);
  });

  it("removes a work from a programme's running order, audit-logging the removal", async () => {
    const user = await createTestUser();
    userId = user.id;
    const composer = await createComposer({ slug: uniqueSlug("composer"), name: "QA Composer 2", actorId: user.id });
    composerId = composer.id;
    const work = await createMusicalWork({ slug: uniqueSlug("work"), title: "QA Work 2", composerId: composer.id, actorId: user.id });
    workIds.push(work.id);
    const programme = await createProgramme({ slug: uniqueSlug("programme"), title: "QA Programme 2", actorId: user.id });
    programmeId = programme.id;
    const item = await addProgrammeItem({ programmeId: programme.id, musicalWorkId: work.id, actorId: user.id });

    await removeProgrammeItem(item.id, user.id);

    const loaded = await findProgrammeById(programme.id);
    expect(loaded?.items).toHaveLength(0);

    const audit = await prisma.auditLogEntry.findMany({ where: { entityType: "Programme", entityId: programme.id, action: "PROGRAMME_ITEM_REMOVED" } });
    expect(audit).toHaveLength(1);
  });

  it("reorders a programme's running order, audit-logging the new order", async () => {
    const user = await createTestUser();
    userId = user.id;
    const composer = await createComposer({ slug: uniqueSlug("composer"), name: "QA Composer 3", actorId: user.id });
    composerId = composer.id;
    const workA = await createMusicalWork({ slug: uniqueSlug("work-a"), title: "Work A", composerId: composer.id, actorId: user.id });
    const workB = await createMusicalWork({ slug: uniqueSlug("work-b"), title: "Work B", composerId: composer.id, actorId: user.id });
    workIds.push(workA.id, workB.id);
    const programme = await createProgramme({ slug: uniqueSlug("programme"), title: "QA Programme 3", actorId: user.id });
    programmeId = programme.id;

    const itemA = await addProgrammeItem({ programmeId: programme.id, musicalWorkId: workA.id, actorId: user.id });
    await addProgrammeItem({ programmeId: programme.id, musicalWorkId: workB.id, actorId: user.id });

    // Move item A (currently order 1, index 0) to index 1 (after B).
    const reordered = await reorderProgrammeItem(programme.id, itemA.id, 1, user.id);
    const loaded = await findProgrammeById(programme.id);
    expect(loaded?.items.map((i) => i.musicalWork.title)).toEqual(["Work B", "Work A"]);
    expect(reordered.map((i) => i.order)).toEqual([1, 2]);

    const audit = await prisma.auditLogEntry.findMany({ where: { entityType: "Programme", entityId: programme.id, action: "PROGRAMME_ITEMS_REORDERED" } });
    expect(audit).toHaveLength(1);
  });

  it("preserves ProgrammeItems when the Programme itself is archived and restored", async () => {
    const user = await createTestUser();
    userId = user.id;
    const composer = await createComposer({ slug: uniqueSlug("composer"), name: "QA Composer 4", actorId: user.id });
    composerId = composer.id;
    const work = await createMusicalWork({ slug: uniqueSlug("work"), title: "QA Work 4", composerId: composer.id, actorId: user.id });
    workIds.push(work.id);
    const programme = await createProgramme({ slug: uniqueSlug("programme"), title: "QA Programme 4", actorId: user.id });
    programmeId = programme.id;
    await addProgrammeItem({ programmeId: programme.id, musicalWorkId: work.id, actorId: user.id });

    await archiveProgramme(programme.id, user.id);
    const whileArchived = await findProgrammeById(programme.id);
    expect(whileArchived?.items).toHaveLength(1); // relationship preserved, not cascaded away

    await restoreProgramme(programme.id, user.id);
    const afterRestore = await findProgrammeById(programme.id);
    expect(afterRestore?.items).toHaveLength(1);
  });
});
