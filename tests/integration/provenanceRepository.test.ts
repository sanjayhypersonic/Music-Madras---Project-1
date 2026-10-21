import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { prisma } from "../../modules/db/client";
import { UnsupportedProvenanceEntityTypeError } from "../../modules/mmke/provenance/provenanceEntityType";
import { LegacyRecordingRelationshipsFrozenError } from "../../modules/mmke/provenance/legacyRecordingRelationshipsFrozen";
import {
  approveSource,
  attachSourceToEntity,
  createSource,
  detachSourceFromEntity,
  disableSource,
  listApprovedSourcesForEntity,
  listSources,
  listSourcesForEntity,
  rejectSource,
  updateSource,
} from "../../modules/db/repositories/sourceRepository";
import { createCitation, listCitationsForSource, updateCitation } from "../../modules/db/repositories/citationRepository";
import {
  attachRightsInformationToEntity,
  createRightsInformation,
  detachRightsInformationFromEntity,
  listRightsForEntity,
  listRightsInformation,
  updateRightsInformation,
} from "../../modules/db/repositories/rightsInformationRepository";
import { createComposer } from "../../modules/db/repositories/composerRepository";
import { createMusicalWork } from "../../modules/db/repositories/musicalWorkRepository";
import { createDraftRecording, publishCurrentDraft } from "../../modules/db/repositories/recordingRepository";
import { listOccasionsForEntity } from "../../modules/db/repositories/occasionRepository";
import { listPublishedCollections } from "../../modules/db/repositories/collectionRepository";

// Phase 6G-13: proves the Source/Citation/RightsInformation repositories
// (activating the existing schema, no migration) against the real
// database. Real DB, disposable test-prefixed fixtures only — mirrors the
// established pattern in tests/integration/occasionRepository.test.ts.

const TEST_TAG = "phase6g13";

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
      name: "Phase 6G-13 Test User",
      role: "EDITOR",
      status: "ACTIVE",
    },
  });
}

async function cleanupSource(sourceId: string) {
  await prisma.citation.deleteMany({ where: { sourceId } });
  await prisma.entitySource.deleteMany({ where: { sourceId } });
  await prisma.auditLogEntry.deleteMany({ where: { entityType: "Source", entityId: sourceId } });
  await prisma.source.delete({ where: { id: sourceId } }).catch(() => {});
}

async function cleanupRights(rightsId: string) {
  await prisma.entityRights.deleteMany({ where: { rightsInformationId: rightsId } });
  await prisma.auditLogEntry.deleteMany({ where: { entityType: "RightsInformation", entityId: rightsId } });
  await prisma.rightsInformation.delete({ where: { id: rightsId } }).catch(() => {});
}

describe("Source CRUD against a real database", () => {
  let sourceId: string | null = null;
  let userId: string | null = null;

  afterEach(async () => {
    if (sourceId) {
      await cleanupSource(sourceId).catch(() => {});
      sourceId = null;
    }
    if (userId) {
      await prisma.studioUser.deleteMany({ where: { id: userId } });
      userId = null;
    }
  });

  it("creates a Source with title/url/publisher and audit-logs the creation", async () => {
    const user = await createTestUser();
    userId = user.id;

    const source = await createSource({
      title: uniqueName("A Choral History of Chennai"),
      url: "https://example.org/history",
      publisher: "Example Press",
      actorId: user.id,
    });
    sourceId = source.id;

    expect(source.publisher).toBe("Example Press");
    const audit = await prisma.auditLogEntry.findMany({ where: { entityType: "Source", entityId: source.id, action: "SOURCE_CREATED" } });
    expect(audit).toHaveLength(1);
  });

  it("creates a bare-URL Source with no title, since title is optional in the schema", async () => {
    const user = await createTestUser();
    userId = user.id;

    const source = await createSource({ url: "https://example.org/bare", actorId: user.id });
    sourceId = source.id;
    expect(source.title).toBeNull();
  });

  it("rejects a duplicate-normalized title", async () => {
    const user = await createTestUser();
    userId = user.id;
    const title = uniqueName("Duplicate Source Title");

    const first = await createSource({ title, actorId: user.id });
    sourceId = first.id;

    await expect(createSource({ title: `  ${title.toUpperCase()}  `, actorId: user.id })).rejects.toThrow(/already exists/i);
  });

  it("edits a Source's fields and audit-logs before/after", async () => {
    const user = await createTestUser();
    userId = user.id;
    const source = await createSource({ title: uniqueName("Editable Source"), actorId: user.id });
    sourceId = source.id;

    const updated = await updateSource(source.id, { publisher: "New Publisher", actorId: user.id });
    expect(updated.publisher).toBe("New Publisher");

    const audit = await prisma.auditLogEntry.findMany({ where: { entityType: "Source", entityId: source.id, action: "SOURCE_UPDATED" } });
    expect(audit).toHaveLength(1);
  });

  it("lists and searches Sources by title, url, or publisher", async () => {
    const user = await createTestUser();
    userId = user.id;
    const marker = randomUUID().slice(0, 8);
    const source = await createSource({ title: `Searchable ${marker} Source`, actorId: user.id });
    sourceId = source.id;

    const found = await listSources(marker);
    expect(found.map((s) => s.id)).toContain(source.id);
  });
});

describe("Citation management against a real database", () => {
  let sourceId: string | null = null;
  let userId: string | null = null;

  afterEach(async () => {
    if (sourceId) {
      await cleanupSource(sourceId).catch(() => {});
      sourceId = null;
    }
    if (userId) {
      await prisma.studioUser.deleteMany({ where: { id: userId } });
      userId = null;
    }
  });

  it("creates a Citation attached to a Source, and one with no Source, and audit-logs both", async () => {
    const user = await createTestUser();
    userId = user.id;
    const source = await createSource({ title: uniqueName("Citation Source"), actorId: user.id });
    sourceId = source.id;

    const withSource = await createCitation({ text: "p. 42, as recorded in the parish register.", sourceId: source.id, actorId: user.id });
    expect(withSource.sourceId).toBe(source.id);

    const withoutSource = await createCitation({ text: "Oral history, uncorroborated.", actorId: user.id });
    expect(withoutSource.sourceId).toBeNull();

    const audit = await prisma.auditLogEntry.findMany({ where: { entityType: "Citation", action: "CITATION_CREATED" } });
    expect(audit.length).toBeGreaterThanOrEqual(2);

    await prisma.auditLogEntry.deleteMany({ where: { entityType: "Citation", entityId: withoutSource.id } });
    await prisma.citation.delete({ where: { id: withoutSource.id } });
  });

  it("rejects creating a Citation for a nonexistent Source id", async () => {
    const user = await createTestUser();
    userId = user.id;
    await expect(createCitation({ text: "Orphan citation", sourceId: randomUUID(), actorId: user.id })).rejects.toThrow();
  });

  it("lists Citations scoped to their Source, and edits a Citation's text", async () => {
    const user = await createTestUser();
    userId = user.id;
    const source = await createSource({ title: uniqueName("List Citations Source"), actorId: user.id });
    sourceId = source.id;
    const citation = await createCitation({ text: "Original text.", sourceId: source.id, actorId: user.id });

    const listed = await listCitationsForSource(source.id);
    expect(listed.map((c) => c.id)).toEqual([citation.id]);

    const updated = await updateCitation(citation.id, { text: "Revised text.", actorId: user.id });
    expect(updated.text).toBe("Revised text.");
    const audit = await prisma.auditLogEntry.findMany({ where: { entityType: "Citation", entityId: citation.id, action: "CITATION_UPDATED" } });
    expect(audit).toHaveLength(1);
  });
});

describe("RightsInformation CRUD against a real database", () => {
  let rightsId: string | null = null;
  let userId: string | null = null;

  afterEach(async () => {
    if (rightsId) {
      await cleanupRights(rightsId).catch(() => {});
      rightsId = null;
    }
    if (userId) {
      await prisma.studioUser.deleteMany({ where: { id: userId } });
      userId = null;
    }
  });

  it("creates RightsInformation and audit-logs the creation", async () => {
    const user = await createTestUser();
    userId = user.id;

    const rights = await createRightsInformation({
      holder: uniqueName("Estate of Test Composer"),
      licenseType: "All rights reserved",
      notes: "Contact estate before reuse.",
      actorId: user.id,
    });
    rightsId = rights.id;

    expect(rights.licenseType).toBe("All rights reserved");
    const audit = await prisma.auditLogEntry.findMany({ where: { entityType: "RightsInformation", entityId: rights.id, action: "RIGHTS_INFORMATION_CREATED" } });
    expect(audit).toHaveLength(1);
  });

  it("edits RightsInformation and audit-logs before/after", async () => {
    const user = await createTestUser();
    userId = user.id;
    const rights = await createRightsInformation({ holder: uniqueName("Editable Holder"), actorId: user.id });
    rightsId = rights.id;

    const updated = await updateRightsInformation(rights.id, { licenseType: "CC BY-NC", actorId: user.id });
    expect(updated.licenseType).toBe("CC BY-NC");
    const audit = await prisma.auditLogEntry.findMany({ where: { entityType: "RightsInformation", entityId: rights.id, action: "RIGHTS_INFORMATION_UPDATED" } });
    expect(audit).toHaveLength(1);
  });

  it("lists and searches RightsInformation by holder or licence type", async () => {
    const user = await createTestUser();
    userId = user.id;
    const marker = randomUUID().slice(0, 8);
    const rights = await createRightsInformation({ holder: `Searchable ${marker} Holder`, actorId: user.id });
    rightsId = rights.id;

    const found = await listRightsInformation(marker);
    expect(found.map((r) => r.id)).toContain(rights.id);
  });
});

describe("Provenance attachment (EntitySource / EntityRights) against a real database", () => {
  let sourceId: string | null = null;
  let rightsId: string | null = null;
  let userId: string | null = null;
  let composerId: string | null = null;
  let workId: string | null = null;
  let recordingId: string | null = null;

  afterEach(async () => {
    if (composerId) {
      await prisma.entitySource.deleteMany({ where: { entityType: "COMPOSER", entityId: composerId } });
      await prisma.entityRights.deleteMany({ where: { entityType: "COMPOSER", entityId: composerId } });
      await prisma.auditLogEntry.deleteMany({ where: { entityType: "COMPOSER", entityId: composerId } });
    }
    if (workId) {
      await prisma.entitySource.deleteMany({ where: { entityType: "WORK", entityId: workId } });
      await prisma.entityRights.deleteMany({ where: { entityType: "WORK", entityId: workId } });
      await prisma.auditLogEntry.deleteMany({ where: { entityType: "WORK", entityId: workId } });
    }
    if (recordingId) {
      await prisma.entitySource.deleteMany({ where: { entityType: "RECORDING", entityId: recordingId } });
      await prisma.entityRights.deleteMany({ where: { entityType: "RECORDING", entityId: recordingId } });
      await prisma.auditLogEntry.deleteMany({ where: { entityType: "RECORDING", entityId: recordingId } });
      const revisions = await prisma.recordingRevision.findMany({ where: { recordingId }, select: { id: true } });
      await prisma.auditLogEntry.deleteMany({ where: { entityType: "Recording", entityId: recordingId } });
      if (revisions.length > 0) {
        await prisma.auditLogEntry.deleteMany({ where: { entityType: "RecordingRevision", entityId: { in: revisions.map((r) => r.id) } } });
      }
      await prisma.recording.delete({ where: { id: recordingId } }).catch(() => {});
      recordingId = null;
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
    if (sourceId) {
      await cleanupSource(sourceId).catch(() => {});
      sourceId = null;
    }
    if (rightsId) {
      await cleanupRights(rightsId).catch(() => {});
      rightsId = null;
    }
    if (userId) {
      await prisma.studioUser.deleteMany({ where: { id: userId } });
      userId = null;
    }
  });

  it("attaches a Source and RightsInformation to a Composer, a Work, and a Recording, each audit-logged", async () => {
    const user = await createTestUser();
    userId = user.id;
    const source = await createSource({ title: uniqueName("Attach Source"), actorId: user.id });
    sourceId = source.id;
    const rights = await createRightsInformation({ holder: uniqueName("Attach Rights Holder"), actorId: user.id });
    rightsId = rights.id;

    const composer = await createComposer({ slug: uniqueSlug("composer"), name: uniqueName("Attach Composer"), actorId: user.id });
    composerId = composer.id;
    const work = await createMusicalWork({ slug: uniqueSlug("work"), title: "Attach Work", composerId: composer.id, actorId: user.id });
    workId = work.id;
    const draft = await createDraftRecording({ slug: uniqueSlug("recording"), actorId: user.id, title: "Attach Recording" });
    const recording = await publishCurrentDraft(draft.id, user.id);
    recordingId = recording.id;

    for (const [entityType, entityId] of [
      ["COMPOSER", composer.id],
      ["WORK", work.id],
    ] as const) {
      await attachSourceToEntity({ entityType, entityId, sourceId: source.id, actorId: user.id });
      await attachRightsInformationToEntity({ entityType, entityId, rightsInformationId: rights.id, actorId: user.id });
    }

    // Phase 6L: a Recording's sources and rights belong to a draft revision; the generic writers refuse the frozen legacy entity type and write nothing.
    await expect(attachSourceToEntity({ entityType: "RECORDING", entityId: recording.id, sourceId: source.id, actorId: user.id })).rejects.toBeInstanceOf(LegacyRecordingRelationshipsFrozenError);
    await expect(attachRightsInformationToEntity({ entityType: "RECORDING", entityId: recording.id, rightsInformationId: rights.id, actorId: user.id })).rejects.toBeInstanceOf(LegacyRecordingRelationshipsFrozenError);
    await expect(detachSourceFromEntity("RECORDING", recording.id, source.id, user.id)).rejects.toBeInstanceOf(LegacyRecordingRelationshipsFrozenError);
    await expect(detachRightsInformationFromEntity("RECORDING", recording.id, rights.id, user.id)).rejects.toBeInstanceOf(LegacyRecordingRelationshipsFrozenError);
    expect(await prisma.entitySource.count({ where: { entityType: "RECORDING", entityId: recording.id } })).toBe(0);
    expect(await prisma.entityRights.count({ where: { entityType: "RECORDING", entityId: recording.id } })).toBe(0);

    expect((await listSourcesForEntity("COMPOSER", composer.id)).map((l) => l.sourceId)).toEqual([source.id]);
    expect((await listSourcesForEntity("WORK", work.id)).map((l) => l.sourceId)).toEqual([source.id]);
    expect((await listRightsForEntity("COMPOSER", composer.id)).map((l) => l.rightsInformationId)).toEqual([rights.id]);
    expect((await listRightsForEntity("WORK", work.id)).map((l) => l.rightsInformationId)).toEqual([rights.id]);

    for (const entityType of ["COMPOSER", "WORK"]) {
      expect((await prisma.auditLogEntry.findMany({ where: { entityType, action: "SOURCE_ATTACHED" } })).length).toBeGreaterThanOrEqual(1);
      expect((await prisma.auditLogEntry.findMany({ where: { entityType, action: "RIGHTS_INFORMATION_ATTACHED" } })).length).toBeGreaterThanOrEqual(1);
    }
  });

  it("prevents attaching the same Source, or the same RightsInformation, to the same entity twice", async () => {
    const user = await createTestUser();
    userId = user.id;
    const source = await createSource({ title: uniqueName("Dup Source"), actorId: user.id });
    sourceId = source.id;
    const rights = await createRightsInformation({ holder: uniqueName("Dup Rights"), actorId: user.id });
    rightsId = rights.id;
    const composer = await createComposer({ slug: uniqueSlug("composer"), name: uniqueName("Dup Attach Composer"), actorId: user.id });
    composerId = composer.id;

    await attachSourceToEntity({ entityType: "COMPOSER", entityId: composer.id, sourceId: source.id, actorId: user.id });
    await expect(
      attachSourceToEntity({ entityType: "COMPOSER", entityId: composer.id, sourceId: source.id, actorId: user.id })
    ).rejects.toThrow(/already attached/i);

    await attachRightsInformationToEntity({ entityType: "COMPOSER", entityId: composer.id, rightsInformationId: rights.id, actorId: user.id });
    await expect(
      attachRightsInformationToEntity({ entityType: "COMPOSER", entityId: composer.id, rightsInformationId: rights.id, actorId: user.id })
    ).rejects.toThrow(/already attached/i);

    expect(await listSourcesForEntity("COMPOSER", composer.id)).toHaveLength(1);
    expect(await listRightsForEntity("COMPOSER", composer.id)).toHaveLength(1);
  });

  it("detaches a Source and RightsInformation, each audit-logged", async () => {
    const user = await createTestUser();
    userId = user.id;
    const source = await createSource({ title: uniqueName("Detach Source"), actorId: user.id });
    sourceId = source.id;
    const rights = await createRightsInformation({ holder: uniqueName("Detach Rights"), actorId: user.id });
    rightsId = rights.id;
    const composer = await createComposer({ slug: uniqueSlug("composer"), name: uniqueName("Detach Composer"), actorId: user.id });
    composerId = composer.id;

    await attachSourceToEntity({ entityType: "COMPOSER", entityId: composer.id, sourceId: source.id, actorId: user.id });
    await attachRightsInformationToEntity({ entityType: "COMPOSER", entityId: composer.id, rightsInformationId: rights.id, actorId: user.id });

    await detachSourceFromEntity("COMPOSER", composer.id, source.id, user.id);
    await detachRightsInformationFromEntity("COMPOSER", composer.id, rights.id, user.id);

    expect(await listSourcesForEntity("COMPOSER", composer.id)).toHaveLength(0);
    expect(await listRightsForEntity("COMPOSER", composer.id)).toHaveLength(0);
    expect(await prisma.auditLogEntry.findMany({ where: { entityType: "COMPOSER", action: "SOURCE_DETACHED" } })).toHaveLength(1);
    expect(await prisma.auditLogEntry.findMany({ where: { entityType: "COMPOSER", action: "RIGHTS_INFORMATION_DETACHED" } })).toHaveLength(1);
  });

  it("rejects an unsupported entity type (PROGRAMME) for both Source and RightsInformation attachment", async () => {
    const user = await createTestUser();
    userId = user.id;
    const source = await createSource({ title: uniqueName("Unsupported Source"), actorId: user.id });
    sourceId = source.id;
    const rights = await createRightsInformation({ holder: uniqueName("Unsupported Rights"), actorId: user.id });
    rightsId = rights.id;

    await expect(
      attachSourceToEntity({ entityType: "PROGRAMME", entityId: randomUUID(), sourceId: source.id, actorId: user.id })
    ).rejects.toThrow(UnsupportedProvenanceEntityTypeError);
    await expect(
      attachRightsInformationToEntity({ entityType: "PROGRAMME", entityId: randomUUID(), rightsInformationId: rights.id, actorId: user.id })
    ).rejects.toThrow(UnsupportedProvenanceEntityTypeError);

    expect(await prisma.entitySource.count({ where: { entityType: "PROGRAMME" } })).toBe(0);
    expect(await prisma.entityRights.count({ where: { entityType: "PROGRAMME" } })).toBe(0);
  });

  it("referential integrity: hard-deleting the Source or RightsInformation cascades and removes its attachments (never left orphaned)", async () => {
    const user = await createTestUser();
    userId = user.id;
    const source = await createSource({ title: uniqueName("Cascade Source"), actorId: user.id });
    const rights = await createRightsInformation({ holder: uniqueName("Cascade Rights"), actorId: user.id });
    const composer = await createComposer({ slug: uniqueSlug("composer"), name: uniqueName("Cascade Composer"), actorId: user.id });
    composerId = composer.id;

    await attachSourceToEntity({ entityType: "COMPOSER", entityId: composer.id, sourceId: source.id, actorId: user.id });
    await attachRightsInformationToEntity({ entityType: "COMPOSER", entityId: composer.id, rightsInformationId: rights.id, actorId: user.id });

    await prisma.auditLogEntry.deleteMany({ where: { entityType: "Source", entityId: source.id } });
    await prisma.source.delete({ where: { id: source.id } });
    await prisma.auditLogEntry.deleteMany({ where: { entityType: "RightsInformation", entityId: rights.id } });
    await prisma.rightsInformation.delete({ where: { id: rights.id } });

    expect(await prisma.entitySource.count({ where: { sourceId: source.id } })).toBe(0);
    expect(await prisma.entityRights.count({ where: { rightsInformationId: rights.id } })).toBe(0);
  });
});

describe("Phase 6H-8 — Source approval state against a real database", () => {
  let sourceId: string | null = null;
  let userId: string | null = null;

  afterEach(async () => {
    if (sourceId) {
      await cleanupSource(sourceId).catch(() => {});
      sourceId = null;
    }
    if (userId) {
      await prisma.studioUser.deleteMany({ where: { id: userId } });
      userId = null;
    }
  });

  it("defaults every new Source to UNREVIEWED", async () => {
    const user = await createTestUser();
    userId = user.id;
    const source = await createSource({ title: uniqueName("Default State Source"), actorId: user.id });
    sourceId = source.id;
    expect(source.approvalState).toBe("UNREVIEWED");
    expect(source.approvedById).toBeNull();
    expect(source.approvedAt).toBeNull();
  });

  it("approves a Source, recording who/when, and audit-logs the transition", async () => {
    const user = await createTestUser();
    userId = user.id;
    const source = await createSource({ title: uniqueName("Approvable Source"), actorId: user.id });
    sourceId = source.id;

    const approved = await approveSource(source.id, user.id);
    expect(approved.approvalState).toBe("APPROVED");
    expect(approved.approvedById).toBe(user.id);
    expect(approved.approvedAt).not.toBeNull();

    const audit = await prisma.auditLogEntry.findMany({ where: { entityType: "Source", entityId: source.id, action: "SOURCE_APPROVED" } });
    expect(audit).toHaveLength(1);
  });

  it("rejects a Source and audit-logs the transition", async () => {
    const user = await createTestUser();
    userId = user.id;
    const source = await createSource({ title: uniqueName("Rejectable Source"), actorId: user.id });
    sourceId = source.id;

    const rejected = await rejectSource(source.id, user.id);
    expect(rejected.approvalState).toBe("REJECTED");
    const audit = await prisma.auditLogEntry.findMany({ where: { entityType: "Source", entityId: source.id, action: "SOURCE_REJECTED" } });
    expect(audit).toHaveLength(1);
  });

  it("disables a previously-approved Source and audit-logs the transition", async () => {
    const user = await createTestUser();
    userId = user.id;
    const source = await createSource({ title: uniqueName("Disablable Source"), actorId: user.id });
    sourceId = source.id;

    await approveSource(source.id, user.id);
    const disabled = await disableSource(source.id, user.id);
    expect(disabled.approvalState).toBe("DISABLED");
    const audit = await prisma.auditLogEntry.findMany({ where: { entityType: "Source", entityId: source.id, action: "SOURCE_DISABLED" } });
    expect(audit).toHaveLength(1);
  });

  it("re-approves a previously REJECTED or DISABLED Source (re-review is not a one-way door)", async () => {
    const user = await createTestUser();
    userId = user.id;
    const source = await createSource({ title: uniqueName("Reinstatable Source"), actorId: user.id });
    sourceId = source.id;

    await rejectSource(source.id, user.id);
    const reApproved = await approveSource(source.id, user.id);
    expect(reApproved.approvalState).toBe("APPROVED");
  });

  it("rejects an invalid transition — cannot disable a Source that was never approved", async () => {
    const user = await createTestUser();
    userId = user.id;
    const source = await createSource({ title: uniqueName("Never Approved Source"), actorId: user.id });
    sourceId = source.id;

    await expect(disableSource(source.id, user.id)).rejects.toThrow(/cannot be disabled/i);
  });

  it("never auto-approves on creation, update, or attachment — approval requires an explicit, separate action", async () => {
    const user = await createTestUser();
    userId = user.id;
    const source = await createSource({ title: uniqueName("Never Auto-Approved"), actorId: user.id });
    sourceId = source.id;
    const composer = await createComposer({ slug: uniqueSlug("composer"), name: uniqueName("Never Auto-Approved Composer"), actorId: user.id });
    try {
      await updateSource(source.id, { publisher: "Some Publisher", actorId: user.id });
      await attachSourceToEntity({ entityType: "COMPOSER", entityId: composer.id, sourceId: source.id, actorId: user.id });

      const reloaded = await listSourcesForEntity("COMPOSER", composer.id);
      expect(reloaded[0].source.approvalState).toBe("UNREVIEWED");
    } finally {
      await prisma.entitySource.deleteMany({ where: { entityType: "COMPOSER", entityId: composer.id } });
      await prisma.auditLogEntry.deleteMany({ where: { entityType: "COMPOSER", entityId: composer.id } });
      await prisma.composer.delete({ where: { id: composer.id } });
    }
  });

  it("listApprovedSourcesForEntity returns only APPROVED sources, while listSourcesForEntity still returns every attached Source regardless of state", async () => {
    const user = await createTestUser();
    userId = user.id;
    const approved = await createSource({ title: uniqueName("Filter Approved"), actorId: user.id });
    const unreviewed = await createSource({ title: uniqueName("Filter Unreviewed"), actorId: user.id });
    const composer = await createComposer({ slug: uniqueSlug("composer"), name: uniqueName("Filter Composer"), actorId: user.id });
    try {
      await attachSourceToEntity({ entityType: "COMPOSER", entityId: composer.id, sourceId: approved.id, actorId: user.id });
      await attachSourceToEntity({ entityType: "COMPOSER", entityId: composer.id, sourceId: unreviewed.id, actorId: user.id });
      await approveSource(approved.id, user.id);

      const approvedOnly = await listApprovedSourcesForEntity("COMPOSER", composer.id);
      expect(approvedOnly.map((l) => l.sourceId)).toEqual([approved.id]);

      const everyAttached = await listSourcesForEntity("COMPOSER", composer.id);
      expect(everyAttached.map((l) => l.sourceId).sort()).toEqual([approved.id, unreviewed.id].sort());
    } finally {
      await prisma.entitySource.deleteMany({ where: { entityType: "COMPOSER", entityId: composer.id } });
      await prisma.auditLogEntry.deleteMany({ where: { entityType: "COMPOSER", entityId: composer.id } });
      await prisma.composer.delete({ where: { id: composer.id } });
      await cleanupSource(approved.id);
      await cleanupSource(unreviewed.id);
    }
  });
});

describe("Regression: Phase 6G-13 does not affect Occasion, Collections, or Recording publication", () => {
  it("Occasion attachment lookups still work unchanged", async () => {
    await expect(listOccasionsForEntity("PROGRAMME", randomUUID())).resolves.toEqual([]);
  });

  it("Collection listing still works unchanged", async () => {
    await expect(listPublishedCollections()).resolves.toEqual(expect.any(Array));
  });
});
