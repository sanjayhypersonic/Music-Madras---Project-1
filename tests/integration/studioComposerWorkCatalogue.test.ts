import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { prisma } from "../../modules/db/client";
import { publishRecordingFor, type PublishedContentHandle } from "./helpers/publishedContent";
import { can } from "../../modules/auth/policy";
import { DuplicateEntityError } from "../../modules/mmke/duplicate-detection/detectDuplicateName";
import { SlugConflictError } from "../../modules/mmke/slug/SlugConflictError";
import {
  archiveComposer,
  createComposer,
  findComposerBySlug,
  listComposersForStudio,
  restoreComposer,
  updateComposer,
} from "../../modules/db/repositories/composerRepository";
import {
  archiveMusicalWork,
  changeMusicalWorkComposer,
  createMusicalWork,
  listMusicalWorksForStudio,
  restoreMusicalWork,
  updateMusicalWork,
} from "../../modules/db/repositories/musicalWorkRepository";
import { getComposerEntityPageData, getComposerRelatedContent } from "../../modules/db/repositories/entityRelationshipsRepository";

// Phase 6G-4C: proves the Studio Composer/MusicalWork catalogue
// repositories against the real database, and their integration with the
// existing 6G-4A/4B public entity-page layer. Real DB, disposable
// test-prefixed fixtures only — mirrors the established pattern in
// tests/integration/entityRelationshipsRepository.test.ts.

const TEST_TAG = "phase6g4c";
const TEST_EMAIL = `${TEST_TAG}-integration-test@musicmadras.test`;

function uniqueSlug(base: string): string {
  return `${TEST_TAG}-${base}-${randomUUID().slice(0, 8)}`;
}

function uniqueName(base: string): string {
  return `${base} ${randomUUID().slice(0, 8)}`;
}

async function createTestUser() {
  return prisma.studioUser.create({
    data: { id: randomUUID(), email: TEST_EMAIL, name: "Phase 6G-4C Test User", role: "EDITOR", status: "ACTIVE" },
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

describe("Studio permission policy (brief §4/§7/§16)", () => {
  it("only grants CATALOGUE_WRITE to roles that should be able to manage Composer/MusicalWork", () => {
    expect(can("CONTRIBUTOR", "CATALOGUE_WRITE")).toBe(false);
    expect(can("EDITOR", "CATALOGUE_WRITE")).toBe(true);
    expect(can("REVIEWER", "CATALOGUE_WRITE")).toBe(true);
    expect(can("ADMINISTRATOR", "CATALOGUE_WRITE")).toBe(true);
    expect(can("FOUNDER", "CATALOGUE_WRITE")).toBe(true);
  });
});

describe("Composer catalogue management against a real database", () => {
  let composerId: string | null = null;
  let userId: string | null = null;

  afterEach(async () => {
    if (composerId) {
      await cleanupComposer(composerId).catch(() => {});
      composerId = null;
    }
    if (userId) {
      await prisma.studioUser.deleteMany({ where: { id: userId } });
      userId = null;
    }
  });

  it("creates a Composer with the given fields and audit-logs the creation", async () => {
    const user = await createTestUser();
    userId = user.id;

    const composer = await createComposer({
      slug: uniqueSlug("composer"),
      name: uniqueName("Antonio QA Vivaldi"),
      bornDate: "1678",
      diedDate: "1741",
      era: "Baroque",
      biography: "A test biography.",
      actorId: user.id,
    });
    composerId = composer.id;

    expect(composer.bornDate).toBe("1678");
    expect(composer.archivedAt).toBeNull();

    const audit = await prisma.auditLogEntry.findMany({ where: { entityType: "Composer", entityId: composer.id, action: "COMPOSER_CREATED" } });
    expect(audit).toHaveLength(1);
  });

  it("rejects a duplicate-normalized name, and rejects a colliding slug for a different name", async () => {
    const user = await createTestUser();
    userId = user.id;
    const name = uniqueName("Duplicate Test Composer");

    const first = await createComposer({ slug: uniqueSlug("composer"), name, actorId: user.id });
    composerId = first.id;

    await expect(createComposer({ slug: uniqueSlug("composer"), name: `  ${name.toUpperCase()}  `, actorId: user.id })).rejects.toThrow(
      DuplicateEntityError
    );

    const collidingSlug = uniqueSlug("collision");
    const second = await createComposer({ slug: collidingSlug, name: uniqueName("Totally Different Name"), actorId: user.id });
    try {
      await expect(createComposer({ slug: collidingSlug, name: uniqueName("Yet Another Name"), actorId: user.id })).rejects.toThrow(
        SlugConflictError
      );
    } finally {
      await cleanupComposer(second.id);
    }
  });

  it("edits a Composer's fields and audit-logs before/after", async () => {
    const user = await createTestUser();
    userId = user.id;
    const composer = await createComposer({ slug: uniqueSlug("composer"), name: uniqueName("Editable Composer"), actorId: user.id });
    composerId = composer.id;

    const updated = await updateComposer(composer.id, { name: "Renamed Composer", era: "Classical", actorId: user.id });
    expect(updated.name).toBe("Renamed Composer");
    expect(updated.era).toBe("Classical");
    expect(updated.slug).toBe(composer.slug); // slug stays immutable

    const audit = await prisma.auditLogEntry.findMany({ where: { entityType: "Composer", entityId: composer.id, action: "COMPOSER_UPDATED" } });
    expect(audit).toHaveLength(1);
  });

  it("lists and searches Composers for Studio, including archived ones, with a work count", async () => {
    const user = await createTestUser();
    userId = user.id;
    const uniqueMarker = randomUUID().slice(0, 8);
    const composer = await createComposer({ slug: uniqueSlug("composer"), name: `Searchable ${uniqueMarker} Composer`, actorId: user.id });
    composerId = composer.id;

    const found = await listComposersForStudio(uniqueMarker);
    expect(found.map((c) => c.id)).toContain(composer.id);
    expect(found.find((c) => c.id === composer.id)?._count.works).toBe(0);

    await archiveComposer(composer.id, user.id);
    const foundAfterArchive = await listComposersForStudio(uniqueMarker);
    expect(foundAfterArchive.map((c) => c.id)).toContain(composer.id); // Studio list includes archived, clearly labelled by archivedAt
  });

  it("archives and restores a Composer, audit-logging both, without deleting the record", async () => {
    const user = await createTestUser();
    userId = user.id;
    const composer = await createComposer({ slug: uniqueSlug("composer"), name: uniqueName("Archivable Composer"), actorId: user.id });
    composerId = composer.id;

    const archived = await archiveComposer(composer.id, user.id);
    expect(archived.archivedAt).not.toBeNull();
    const stillExists = await findComposerBySlug(composer.slug);
    expect(stillExists).not.toBeNull();

    const restored = await restoreComposer(composer.id, user.id);
    expect(restored.archivedAt).toBeNull();

    const archiveAudit = await prisma.auditLogEntry.findMany({ where: { entityType: "Composer", entityId: composer.id, action: "COMPOSER_ARCHIVED" } });
    const restoreAudit = await prisma.auditLogEntry.findMany({ where: { entityType: "Composer", entityId: composer.id, action: "COMPOSER_RESTORED" } });
    expect(archiveAudit).toHaveLength(1);
    expect(restoreAudit).toHaveLength(1);
  });
});

describe("MusicalWork catalogue management against a real database", () => {
  let composerId: string | null = null;
  let workId: string | null = null;
  let secondComposerId: string | null = null;
  let userId: string | null = null;

  afterEach(async () => {
    if (workId) {
      await cleanupWork(workId).catch(() => {});
      workId = null;
    }
    if (composerId) {
      await cleanupComposer(composerId).catch(() => {});
      composerId = null;
    }
    if (secondComposerId) {
      await cleanupComposer(secondComposerId).catch(() => {});
      secondComposerId = null;
    }
    if (userId) {
      await prisma.studioUser.deleteMany({ where: { id: userId } });
      userId = null;
    }
  });

  it("creates a Musical Work linked to a canonical Composer, and audit-logs the creation", async () => {
    const user = await createTestUser();
    userId = user.id;
    const composer = await createComposer({ slug: uniqueSlug("composer"), name: uniqueName("Work Test Composer"), actorId: user.id });
    composerId = composer.id;

    const work = await createMusicalWork({ slug: uniqueSlug("work"), title: "Test Concerto", composerId: composer.id, actorId: user.id });
    workId = work.id;

    expect(work.composerId).toBe(composer.id);
    const audit = await prisma.auditLogEntry.findMany({ where: { entityType: "MusicalWork", entityId: work.id, action: "MUSICAL_WORK_CREATED" } });
    expect(audit).toHaveLength(1);
  });

  it("rejects creating a Musical Work for a nonexistent Composer id — never creates one from free text", async () => {
    const user = await createTestUser();
    userId = user.id;
    const composerCountBefore = await prisma.composer.count();

    await expect(
      createMusicalWork({ slug: uniqueSlug("work"), title: "Orphan Work", composerId: randomUUID(), actorId: user.id })
    ).rejects.toThrow();

    const composerCountAfter = await prisma.composer.count();
    expect(composerCountAfter).toBe(composerCountBefore);
  });

  it("rejects a colliding slug for a Musical Work", async () => {
    const user = await createTestUser();
    userId = user.id;
    const composer = await createComposer({ slug: uniqueSlug("composer"), name: uniqueName("Slug Test Composer"), actorId: user.id });
    composerId = composer.id;

    const collidingSlug = uniqueSlug("work-collision");
    const work = await createMusicalWork({ slug: collidingSlug, title: "First Work", composerId: composer.id, actorId: user.id });
    workId = work.id;

    await expect(
      createMusicalWork({ slug: collidingSlug, title: "A Completely Different Title", composerId: composer.id, actorId: user.id })
    ).rejects.toThrow(SlugConflictError);
  });

  it("edits a Musical Work's own fields, keeping the slug immutable", async () => {
    const user = await createTestUser();
    userId = user.id;
    const composer = await createComposer({ slug: uniqueSlug("composer"), name: uniqueName("Edit Work Composer"), actorId: user.id });
    composerId = composer.id;
    const work = await createMusicalWork({ slug: uniqueSlug("work"), title: "Original Title", composerId: composer.id, actorId: user.id });
    workId = work.id;

    const updated = await updateMusicalWork(work.id, { title: "Updated Title", catalogueNumber: "Op. 1", actorId: user.id });
    expect(updated.title).toBe("Updated Title");
    expect(updated.catalogueNumber).toBe("Op. 1");
    expect(updated.slug).toBe(work.slug);

    const audit = await prisma.auditLogEntry.findMany({ where: { entityType: "MusicalWork", entityId: work.id, action: "MUSICAL_WORK_UPDATED" } });
    expect(audit).toHaveLength(1);
  });

  it("reassigns a Musical Work's canonical Composer via changeMusicalWorkComposer, with its own distinct audit action", async () => {
    const user = await createTestUser();
    userId = user.id;
    const composer = await createComposer({ slug: uniqueSlug("composer"), name: uniqueName("Original Composer"), actorId: user.id });
    composerId = composer.id;
    const newComposer = await createComposer({ slug: uniqueSlug("composer"), name: uniqueName("New Composer"), actorId: user.id });
    secondComposerId = newComposer.id;
    const work = await createMusicalWork({ slug: uniqueSlug("work"), title: "Reassignable Work", composerId: composer.id, actorId: user.id });
    workId = work.id;

    const reassigned = await changeMusicalWorkComposer(work.id, newComposer.id, user.id);
    expect(reassigned.composerId).toBe(newComposer.id);

    const audit = await prisma.auditLogEntry.findMany({
      where: { entityType: "MusicalWork", entityId: work.id, action: "MUSICAL_WORK_COMPOSER_CHANGED" },
    });
    expect(audit).toHaveLength(1);

    await expect(changeMusicalWorkComposer(work.id, randomUUID(), user.id)).rejects.toThrow();
  });

  it("lists and searches Musical Works for Studio, including the joined Composer and archived ones", async () => {
    const user = await createTestUser();
    userId = user.id;
    const composer = await createComposer({ slug: uniqueSlug("composer"), name: uniqueName("List Test Composer"), actorId: user.id });
    composerId = composer.id;
    const uniqueMarker = randomUUID().slice(0, 8);
    const work = await createMusicalWork({ slug: uniqueSlug("work"), title: `Searchable ${uniqueMarker} Work`, composerId: composer.id, actorId: user.id });
    workId = work.id;

    const found = await listMusicalWorksForStudio(uniqueMarker);
    expect(found.map((w) => w.id)).toContain(work.id);
    expect(found.find((w) => w.id === work.id)?.composer.id).toBe(composer.id);

    await archiveMusicalWork(work.id, user.id);
    const foundAfterArchive = await listMusicalWorksForStudio(uniqueMarker);
    expect(foundAfterArchive.map((w) => w.id)).toContain(work.id);
  });

  it("archives and restores a Musical Work, audit-logging both", async () => {
    const user = await createTestUser();
    userId = user.id;
    const composer = await createComposer({ slug: uniqueSlug("composer"), name: uniqueName("Archive Work Composer"), actorId: user.id });
    composerId = composer.id;
    const work = await createMusicalWork({ slug: uniqueSlug("work"), title: "Archivable Work", composerId: composer.id, actorId: user.id });
    workId = work.id;

    const archived = await archiveMusicalWork(work.id, user.id);
    expect(archived.archivedAt).not.toBeNull();

    const restored = await restoreMusicalWork(work.id, user.id);
    expect(restored.archivedAt).toBeNull();

    const restoreAudit = await prisma.auditLogEntry.findMany({ where: { entityType: "MusicalWork", entityId: work.id, action: "MUSICAL_WORK_RESTORED" } });
    expect(restoreAudit).toHaveLength(1);
  });
});

describe("Integration with the 6G-4A/6G-4B public entity-page layer", () => {
  let composerId: string | null = null;
  let workId: string | null = null;
  let userId: string | null = null;
  let published: PublishedContentHandle | null = null;

  afterEach(async () => {
    // The published Recording references the Work (RESTRICT), so it is removed first.
    if (published) {
      await published.cleanup().catch(() => {});
      published = null;
    }
    if (workId) {
      await cleanupWork(workId).catch(() => {});
      workId = null;
    }
    if (composerId) {
      await cleanupComposer(composerId).catch(() => {});
      composerId = null;
    }
    if (userId) {
      await prisma.studioUser.deleteMany({ where: { id: userId } });
      userId = null;
    }
  });

  it("a Studio-created Composer appears through the canonical public /composers/[slug] data, and a Studio-created Work resolves through the relationship layer", async () => {
    const user = await createTestUser();
    userId = user.id;
    const composer = await createComposer({
      slug: uniqueSlug("public-composer"),
      name: uniqueName("Public Test Composer"),
      biography: "A real biography for the public page.",
      actorId: user.id,
    });
    composerId = composer.id;
    const work = await createMusicalWork({ slug: uniqueSlug("public-work"), title: "Public Test Work", composerId: composer.id, actorId: user.id });
    workId = work.id;

    // Public discovery is eligibility-based (Phase 6J-1): the Composer is public once a published Recording reaches it.
    expect(await getComposerEntityPageData(composer.slug)).toBeNull();
    published = await publishRecordingFor({ actorId: user.id, workIds: [work.id] });

    const publicData = await getComposerEntityPageData(composer.slug);
    expect(publicData).not.toBeNull();
    expect(publicData!.name).toBe(composer.name);
    expect(publicData!.description).toBe("A real biography for the public page.");
    expect(publicData!.relatedWorks).toEqual([{ id: work.id, slug: work.slug, title: work.title }]);

    const related = await getComposerRelatedContent(composer.id);
    expect(related.works.map((w) => w.id)).toEqual([work.id]);
  });

  it("an archived Composer is no longer publicly exposed, and becomes visible again after restore", async () => {
    const user = await createTestUser();
    userId = user.id;
    const composer = await createComposer({ slug: uniqueSlug("archive-public-composer"), name: uniqueName("Archive Public Composer"), actorId: user.id });
    composerId = composer.id;
    const work = await createMusicalWork({ slug: uniqueSlug("archive-public-work"), title: "Archive Public Work", composerId: composer.id, actorId: user.id });
    workId = work.id;
    published = await publishRecordingFor({ actorId: user.id, workIds: [work.id] });

    expect(await getComposerEntityPageData(composer.slug)).not.toBeNull();

    await archiveComposer(composer.id, user.id);
    expect(await getComposerEntityPageData(composer.slug)).toBeNull();

    await restoreComposer(composer.id, user.id);
    expect(await getComposerEntityPageData(composer.slug)).not.toBeNull();
  });

  it("creating a Composer and Musical Work never touches YouTube sync tables", async () => {
    const user = await createTestUser();
    userId = user.id;
    const [videoCountBefore, playlistCountBefore] = await Promise.all([
      prisma.youTubeVideo.count(),
      prisma.youTubePlaylist.count(),
    ]);

    const composer = await createComposer({ slug: uniqueSlug("no-sync-composer"), name: uniqueName("No Sync Composer"), actorId: user.id });
    composerId = composer.id;
    const work = await createMusicalWork({ slug: uniqueSlug("no-sync-work"), title: "No Sync Work", composerId: composer.id, actorId: user.id });
    workId = work.id;

    const [videoCountAfter, playlistCountAfter] = await Promise.all([
      prisma.youTubeVideo.count(),
      prisma.youTubePlaylist.count(),
    ]);
    expect(videoCountAfter).toBe(videoCountBefore);
    expect(playlistCountAfter).toBe(playlistCountBefore);
  });
});
