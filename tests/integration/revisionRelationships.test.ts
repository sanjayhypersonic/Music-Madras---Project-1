import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "crypto";

// Must be at the true top level — vi.mock is hoisted above every import.
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

// Fault injection (see lifecycleSerialization.test.ts): `action` fails the audit write; `afterAction` writes the audit row
// and then fails, so the row survives only if it was written outside the operation's transaction.
const inject = vi.hoisted(() => ({ action: null as string | null, afterAction: null as string | null }));
vi.mock("../../modules/audit/writeAuditLog", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../modules/audit/writeAuditLog")>();
  return {
    ...actual,
    writeAuditLog: (input: Parameters<typeof actual.writeAuditLog>[0], client?: Parameters<typeof actual.writeAuditLog>[1]) => {
      if (inject.action !== null && input.action === inject.action) return Promise.reject(new Error("injected audit failure"));
      if (inject.afterAction !== null && input.action === inject.afterAction) {
        return actual.writeAuditLog(input, client).then(() => {
          throw new Error("injected failure after audit write");
        });
      }
      return actual.writeAuditLog(input, client);
    },
  };
});

import { prisma } from "../../modules/db/client";
import { isUniqueConstraintViolation } from "../../modules/db/isUniqueConstraintViolation";
import { createOccasion, archiveOccasion, attachOccasionToEntity, detachOccasionFromEntity } from "../../modules/db/repositories/occasionRepository";
import { createRightsInformation, attachRightsInformationToEntity, detachRightsInformationFromEntity } from "../../modules/db/repositories/rightsInformationRepository";
import { createSource, approveSource, attachSourceToEntity, detachSourceFromEntity } from "../../modules/db/repositories/sourceRepository";
import { LegacyRecordingRelationshipsFrozenError } from "../../modules/mmke/provenance/legacyRecordingRelationshipsFrozen";
import { loadPublishedRecordingRelationships } from "../../modules/db/repositories/recordingRelationshipReadersRepository";
import { getRecordingContext } from "../../modules/db/repositories/recordingContextRepository";
import {
  DuplicateRevisionRelationshipError,
  RevisionRelationshipNotFoundError,
  attachOccasionToRevision,
  attachRightsToRevision,
  attachSourceToRevision,
  detachOccasionFromRevision,
  detachRightsFromRevision,
  detachSourceFromRevision,
  listOccasionsForRevision,
  listRightsForRevision,
  listSourcesForRevision,
} from "../../modules/db/repositories/recordingRevisionRelationshipsRepository";
import {
  RecordingBusyError,
  RevisionNotEditableError,
  archiveRecording,
  createDraftRecording,
  forkDraftFromPublished,
  publishCurrentDraft,
  publishRecordingDraft,
} from "../../modules/db/repositories/recordingRepository";

// Phase 6J-11B — revision-scoped relationships (sources, rights information, occasions): the repository functions under test.
// Since Phase 6L they are the ONLY way a Recording gets these links (Studio writers, the Organisation page and the AI context read them);
// the legacy Recording-level rows are frozen history that nothing writes or reads (section H).

const T = 120000;
const TOKEN = randomUUID().slice(0, 8);
const ROUNDS = 6;

const userIds = {} as { admin: string; editor: string };
const recordingIds: string[] = [];
const sourceIds: string[] = [];
const rightsIds: string[] = [];
const occasionIds: string[] = [];
let counter = 0;
const uniq = (label: string) => `r11-${label}-${TOKEN}-${++counter}-${randomUUID().slice(0, 4)}`;

async function newSource(approved = false) {
  const source = await createSource({ title: `R11 Source ${uniq("s")}`, url: "https://example.org/source", actorId: userIds.editor });
  sourceIds.push(source.id);
  if (approved) await approveSource(source.id, userIds.admin);
  return source.id;
}
async function newRights() {
  const rights = await createRightsInformation({ holder: `R11 holder ${uniq("r")}`, actorId: userIds.editor });
  rightsIds.push(rights.id);
  return rights.id;
}
async function newOccasion() {
  const occasion = await createOccasion({ slug: uniq("o"), name: `R11 Occasion ${uniq("on")}`, actorId: userIds.editor });
  occasionIds.push(occasion.id);
  return occasion.id;
}

interface KindAdapter {
  kind: "source" | "rights" | "occasion";
  create: () => Promise<string>;
  attach: (revisionId: string, targetId: string, actorId: string) => Promise<unknown>;
  detach: (revisionId: string, targetId: string, actorId: string) => Promise<void>;
  ids: (revisionId: string) => Promise<string[]>;
  count: (where: { revisionId?: { in: string[] } | string }) => Promise<number>;
  insertRaw: (revisionId: string, targetId: string) => Promise<unknown>;
  attachedAction: string;
  detachedAction: string;
  deleteTarget: (id: string) => Promise<unknown>;
}

const KINDS: KindAdapter[] = [
  {
    kind: "source",
    create: () => newSource(),
    attach: attachSourceToRevision,
    detach: detachSourceFromRevision,
    ids: async (revisionId) => (await listSourcesForRevision(revisionId)).map((l) => l.sourceId).sort(),
    count: (where) => prisma.recordingRevisionSource.count({ where }),
    insertRaw: (revisionId, sourceId) => prisma.recordingRevisionSource.create({ data: { revisionId, sourceId } }),
    attachedAction: "SOURCE_ATTACHED_TO_RECORDING_REVISION",
    detachedAction: "SOURCE_DETACHED_FROM_RECORDING_REVISION",
    deleteTarget: (id) => prisma.source.delete({ where: { id } }),
  },
  {
    kind: "rights",
    create: () => newRights(),
    attach: attachRightsToRevision,
    detach: detachRightsFromRevision,
    ids: async (revisionId) => (await listRightsForRevision(revisionId)).map((l) => l.rightsInformationId).sort(),
    count: (where) => prisma.recordingRevisionRights.count({ where }),
    insertRaw: (revisionId, rightsInformationId) => prisma.recordingRevisionRights.create({ data: { revisionId, rightsInformationId } }),
    attachedAction: "RIGHTS_ATTACHED_TO_RECORDING_REVISION",
    detachedAction: "RIGHTS_DETACHED_FROM_RECORDING_REVISION",
    deleteTarget: (id) => prisma.rightsInformation.delete({ where: { id } }),
  },
  {
    kind: "occasion",
    create: () => newOccasion(),
    attach: attachOccasionToRevision,
    detach: detachOccasionFromRevision,
    ids: async (revisionId) => (await listOccasionsForRevision(revisionId)).map((l) => l.occasionId).sort(),
    count: (where) => prisma.recordingRevisionOccasion.count({ where }),
    insertRaw: (revisionId, occasionId) => prisma.recordingRevisionOccasion.create({ data: { revisionId, occasionId } }),
    attachedAction: "OCCASION_ATTACHED_TO_RECORDING_REVISION",
    detachedAction: "OCCASION_DETACHED_FROM_RECORDING_REVISION",
    deleteTarget: (id) => prisma.occasion.delete({ where: { id } }),
  },
];

async function newDraft(label: string) {
  const recording = await createDraftRecording({ slug: uniq(label), actorId: userIds.editor, title: `R11 ${label}` });
  recordingIds.push(recording.id);
  return { id: recording.id, draftId: recording.currentDraftRevisionId! };
}
async function liveOnly(label: string) {
  const rec = await newDraft(label);
  await publishCurrentDraft(rec.id, userIds.admin);
  return { id: rec.id, publishedId: rec.draftId };
}
async function liveWithOpenDraft(label: string) {
  const rec = await liveOnly(label);
  const draft = await forkDraftFromPublished(rec.id, userIds.editor);
  return { ...rec, draftId: draft.id };
}

const revisionAudits = (revisionId: string, action: string) => prisma.auditLogEntry.count({ where: { entityType: "RecordingRevision", entityId: revisionId, action } });

function holdEditLock(recordingId: string) {
  let release!: () => void;
  let acquired!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  const got = new Promise<void>((resolve) => (acquired = resolve));
  const done = prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`recording-edit:${recordingId}`}))`;
      acquired();
      await released;
    },
    { timeout: 60000, maxWait: 10000 }
  );
  return { got, release, done };
}
const PENDING = Symbol("pending");
async function stillPending(promise: Promise<unknown>, afterMs = 600) {
  return (await Promise.race([promise.then(() => "settled", () => "settled"), new Promise((resolve) => setTimeout(() => resolve(PENDING), afterMs))])) === PENDING;
}
const settle = <V,>(promise: Promise<V>) => promise.then((value) => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));

beforeAll(async () => {
  for (const [key, role] of [["admin", "ADMINISTRATOR"], ["editor", "EDITOR"]] as const) {
    userIds[key] = (await prisma.studioUser.create({ data: { id: randomUUID(), email: `r11-${key}-${TOKEN}@musicmadras.test`, name: `R11 ${key}`, role, status: "ACTIVE" } })).id;
  }
}, T);

afterAll(async () => {
  const revisionIds = (await prisma.recordingRevision.findMany({ where: { recordingId: { in: recordingIds } }, select: { id: true } })).map((r) => r.id);
  await prisma.auditLogEntry.deleteMany({ where: { OR: [{ entityId: { in: [...recordingIds, ...revisionIds, ...sourceIds, ...occasionIds, ...rightsIds] } }, { actorId: { in: Object.values(userIds) } }] } });
  await prisma.entitySource.deleteMany({ where: { entityType: "RECORDING", entityId: { in: recordingIds } } });
  await prisma.entityRights.deleteMany({ where: { entityType: "RECORDING", entityId: { in: recordingIds } } });
  await prisma.entityOccasion.deleteMany({ where: { entityType: "RECORDING", entityId: { in: recordingIds } } });
  await prisma.recording.deleteMany({ where: { id: { in: recordingIds } } }); // cascades the revisions and their revision-scoped links
  await prisma.source.deleteMany({ where: { id: { in: sourceIds } } });
  await prisma.rightsInformation.deleteMany({ where: { id: { in: rightsIds } } });
  await prisma.occasion.deleteMany({ where: { id: { in: occasionIds } } });
  await prisma.studioUser.deleteMany({ where: { id: { in: Object.values(userIds) } } });
}, T);

for (const k of KINDS) {
  describe(`${k.kind} links on a revision`, () => {
    it("attach and detach work on the current draft, each with its audit entry in the same transaction", async () => {
      const rec = await newDraft(`${k.kind}-ok`);
      const target = await k.create();
      await k.attach(rec.draftId, target, userIds.editor);
      expect(await k.ids(rec.draftId)).toEqual([target]);
      expect(await revisionAudits(rec.draftId, k.attachedAction)).toBe(1);
      await k.detach(rec.draftId, target, userIds.editor);
      expect(await k.ids(rec.draftId)).toEqual([]);
      expect(await revisionAudits(rec.draftId, k.detachedAction)).toBe(1);
    }, T);

    it("a duplicate is rejected by the DATABASE (composite primary key) and by the function, with one audit entry and no raw error", async () => {
      const rec = await newDraft(`${k.kind}-dup`);
      const target = await k.create();
      await k.attach(rec.draftId, target, userIds.editor);
      const raw = await k.insertRaw(rec.draftId, target).then(() => null, (e: unknown) => e);
      expect(isUniqueConstraintViolation(raw)).toBe(true); // the constraint, not a pre-check
      const err = await k.attach(rec.draftId, target, userIds.editor).then(() => null, (e: unknown) => e);
      expect(err).toBeInstanceOf(DuplicateRevisionRelationshipError);
      expect((err as Error).message).not.toMatch(/prisma|constraint|invocation/i);
      expect(await k.count({ revisionId: rec.draftId })).toBe(1);
      expect(await revisionAudits(rec.draftId, k.attachedAction)).toBe(1);
    }, T);

    it("detaching something that is not attached is refused with a typed error and no audit entry", async () => {
      const rec = await newDraft(`${k.kind}-missing`);
      const target = await k.create();
      await expect(k.detach(rec.draftId, target, userIds.editor)).rejects.toBeInstanceOf(RevisionRelationshipNotFoundError);
      expect(await revisionAudits(rec.draftId, k.detachedAction)).toBe(0);
    }, T);

    const ineligible: Array<[string, () => Promise<{ revisionId: string; reason: string }>]> = [
      ["the PUBLISHED revision of a live Recording", async () => ({ revisionId: (await liveOnly(`${k.kind}-i1`)).publishedId, reason: "STALE_REVISION" })],
      ["the PUBLISHED revision while a second draft is open", async () => ({ revisionId: (await liveWithOpenDraft(`${k.kind}-i2`)).publishedId, reason: "STALE_REVISION" })],
      [
        "a SUPERSEDED revision",
        async () => {
          const r = await liveWithOpenDraft(`${k.kind}-i3`);
          await publishRecordingDraft({ recordingId: r.id, actorId: userIds.admin, expectedDraftRevisionId: r.draftId, enforceCompleteness: false });
          return { revisionId: r.publishedId, reason: "STALE_REVISION" };
        },
      ],
      [
        "a DRAFT revision that is not the current draft",
        async () => {
          const r = await newDraft(`${k.kind}-i4`);
          const stray = await prisma.recordingRevision.create({ data: { recordingId: r.id, revisionNumber: 900, revisionStatus: "DRAFT", createdById: userIds.editor, updatedById: userIds.editor } });
          return { revisionId: stray.id, reason: "STALE_REVISION" };
        },
      ],
      [
        "the open draft of an ARCHIVED Recording",
        async () => {
          const r = await newDraft(`${k.kind}-i5`);
          await archiveRecording(r.id, userIds.admin);
          return { revisionId: r.draftId, reason: "RECORDING_ARCHIVED" };
        },
      ],
      ["a revision that does not exist", async () => ({ revisionId: randomUUID(), reason: "STALE_REVISION" })],
    ];
    for (const [name, build] of ineligible) {
      it(`refuses to edit ${name}: nothing is written`, async () => {
        const { revisionId, reason } = await build();
        const target = await k.create();
        const err = await k.attach(revisionId, target, userIds.editor).then(() => null, (e: unknown) => e);
        expect(err).toBeInstanceOf(RevisionNotEditableError);
        expect((err as RevisionNotEditableError).reason).toBe(reason);
        const detachErr = await k.detach(revisionId, target, userIds.editor).then(() => null, (e: unknown) => e);
        expect(detachErr).toBeInstanceOf(RevisionNotEditableError);
        expect(await k.count({ revisionId })).toBe(0);
        expect(await revisionAudits(revisionId, k.attachedAction)).toBe(0);
      }, T);
    }

    it("a published revision's links cannot be changed by detaching either (the published set is frozen)", async () => {
      const rec = await newDraft(`${k.kind}-frozen`);
      const target = await k.create();
      await k.attach(rec.draftId, target, userIds.editor);
      await publishCurrentDraft(rec.id, userIds.admin);
      await expect(k.detach(rec.draftId, target, userIds.editor)).rejects.toBeInstanceOf(RevisionNotEditableError);
      expect(await k.ids(rec.draftId)).toEqual([target]);
    }, T);

    it("referential integrity: no orphan rows can be created, a used catalogue record cannot be deleted, and a revision's links go with it", async () => {
      const rec = await newDraft(`${k.kind}-fk`);
      const target = await k.create();
      await expect(k.insertRaw(randomUUID(), target)).rejects.toThrow(); // unknown revision
      await expect(k.insertRaw(rec.draftId, randomUUID())).rejects.toThrow(); // unknown catalogue record
      await expect(k.attach(rec.draftId, randomUUID(), userIds.editor)).rejects.toThrow(/does not exist/);
      expect(await k.count({ revisionId: rec.draftId })).toBe(0);
      await k.attach(rec.draftId, target, userIds.editor);
      await expect(k.deleteTarget(target)).rejects.toThrow(); // RESTRICT: the revision uses it
      expect(await k.ids(rec.draftId)).toEqual([target]);
      await prisma.recording.delete({ where: { id: rec.id } }); // cascades revision -> links
      expect(await k.count({ revisionId: rec.draftId })).toBe(0);
    }, T);

    for (const mode of ["action", "afterAction"] as const) {
      it(`${mode === "action" ? "a failing" : "a failing-after"} audit write rolls the attach back (no link, no audit row)`, async () => {
        const rec = await newDraft(`${k.kind}-atomic-a-${mode}`);
        const target = await k.create();
        inject[mode] = k.attachedAction;
        try {
          await expect(k.attach(rec.draftId, target, userIds.editor)).rejects.toThrow(/injected/);
        } finally {
          inject[mode] = null;
        }
        expect(await k.count({ revisionId: rec.draftId })).toBe(0);
        expect(await revisionAudits(rec.draftId, k.attachedAction)).toBe(0);
        await k.attach(rec.draftId, target, userIds.editor); // and it works once the fault is gone
        expect(await k.ids(rec.draftId)).toEqual([target]);
      }, T);

      it(`${mode === "action" ? "a failing" : "a failing-after"} audit write rolls the detach back (the link stays, no audit row)`, async () => {
        const rec = await newDraft(`${k.kind}-atomic-d-${mode}`);
        const target = await k.create();
        await k.attach(rec.draftId, target, userIds.editor);
        inject[mode] = k.detachedAction;
        try {
          await expect(k.detach(rec.draftId, target, userIds.editor)).rejects.toThrow(/injected/);
        } finally {
          inject[mode] = null;
        }
        expect(await k.ids(rec.draftId)).toEqual([target]);
        expect(await revisionAudits(rec.draftId, k.detachedAction)).toBe(0);
      }, T);
    }

    it("concurrency: simultaneous identical attaches yield one link and explicit duplicate errors (never a raw database error)", async () => {
      for (let round = 0; round < ROUNDS; round++) {
        const rec = await newDraft(`${k.kind}-conc-same`);
        const target = await k.create();
        const results = await Promise.allSettled([1, 2, 3, 4, 5].map(() => k.attach(rec.draftId, target, userIds.editor)));
        expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
        for (const r of results.filter((x) => x.status === "rejected")) expect((r as PromiseRejectedResult).reason).toBeInstanceOf(DuplicateRevisionRelationshipError);
        expect(await k.count({ revisionId: rec.draftId })).toBe(1);
        expect(await revisionAudits(rec.draftId, k.attachedAction)).toBe(1);
      }
    }, T);

    it("concurrency: simultaneous attaches of different records all succeed, one audit entry each", async () => {
      const rec = await newDraft(`${k.kind}-conc-diff`);
      const targets = await Promise.all([1, 2, 3, 4].map(() => k.create()));
      const results = await Promise.allSettled(targets.map((t) => k.attach(rec.draftId, t, userIds.editor)));
      expect(results.map((r) => r.status)).toEqual(targets.map(() => "fulfilled"));
      expect(await k.ids(rec.draftId)).toEqual([...targets].sort());
      expect(await revisionAudits(rec.draftId, k.attachedAction)).toBe(targets.length);
    }, T);

    it("concurrency: a write waits for the Recording's edit lock (the shared protocol), then applies", async () => {
      const rec = await newDraft(`${k.kind}-lock-wait`);
      const target = await k.create();
      const holder = holdEditLock(rec.id);
      await holder.got;
      const attach = settle(k.attach(rec.draftId, target, userIds.editor));
      expect(await stillPending(attach)).toBe(true);
      expect(await k.count({ revisionId: rec.draftId })).toBe(0);
      holder.release();
      await holder.done;
      expect((await attach).ok).toBe(true);
      expect(await k.ids(rec.draftId)).toEqual([target]);
    }, T);

    it("concurrency: the wait is bounded (RecordingBusyError) and nothing is written", async () => {
      const rec = await newDraft(`${k.kind}-lock-busy`);
      const target = await k.create();
      const holder = holdEditLock(rec.id);
      await holder.got;
      try {
        await expect(k.attach(rec.draftId, target, userIds.editor)).rejects.toBeInstanceOf(RecordingBusyError);
      } finally {
        holder.release();
        await holder.done;
      }
      expect(await k.count({ revisionId: rec.draftId })).toBe(0);
    }, T);

    it(`concurrency: an attach racing publication gives a coherent serial outcome and the published set never changes afterwards (${ROUNDS} rounds)`, async () => {
      for (let round = 0; round < ROUNDS; round++) {
        const rec = await newDraft(`${k.kind}-conc-pub`);
        const target = await k.create();
        const [attach, publish] = await Promise.all([settle(k.attach(rec.draftId, target, userIds.editor)), publishRecordingDraft({ recordingId: rec.id, actorId: userIds.admin, expectedDraftRevisionId: rec.draftId, enforceCompleteness: false })]);
        expect(publish.ok).toBe(true);
        const ids = await k.ids(rec.draftId);
        if (attach.ok) {
          expect(ids).toEqual([target]); // done before the publication: part of what was published
          expect(await revisionAudits(rec.draftId, k.attachedAction)).toBe(1);
        } else {
          expect((attach as { error: unknown }).error).toBeInstanceOf(RevisionNotEditableError); // refused after it
          expect(ids).toEqual([]);
          expect(await revisionAudits(rec.draftId, k.attachedAction)).toBe(0);
        }
        await expect(k.attach(rec.draftId, await k.create(), userIds.editor)).rejects.toBeInstanceOf(RevisionNotEditableError);
        expect(await k.ids(rec.draftId)).toEqual(ids); // frozen
      }
    }, T);
  });
}

describe("forking copies the published revision's relationships", () => {
  async function publishedWithAllRelationships(label: string) {
    const rec = await newDraft(label);
    const sources = [await newSource(), await newSource()];
    const rights = [await newRights()];
    const occasions = [await newOccasion(), await newOccasion()];
    for (const id of sources) await attachSourceToRevision(rec.draftId, id, userIds.editor);
    for (const id of rights) await attachRightsToRevision(rec.draftId, id, userIds.editor);
    for (const id of occasions) await attachOccasionToRevision(rec.draftId, id, userIds.editor);
    await publishCurrentDraft(rec.id, userIds.admin);
    return { ...rec, publishedId: rec.draftId, sources: [...sources].sort(), rights: [...rights].sort(), occasions: [...occasions].sort() };
  }
  const sets = async (revisionId: string) => ({
    sources: (await listSourcesForRevision(revisionId)).map((l) => l.sourceId).sort(),
    rights: (await listRightsForRevision(revisionId)).map((l) => l.rightsInformationId).sort(),
    occasions: (await listOccasionsForRevision(revisionId)).map((l) => l.occasionId).sort(),
  });

  it("the new draft gets exactly the published revision's three sets; the shared catalogue rows are not copied", async () => {
    const rec = await publishedWithAllRelationships("fork-copy");
    const catalogueBefore = { sources: await prisma.source.count(), rights: await prisma.rightsInformation.count(), occasions: await prisma.occasion.count() };
    const draft = await forkDraftFromPublished(rec.id, userIds.editor);
    expect(await sets(draft.id)).toEqual({ sources: rec.sources, rights: rec.rights, occasions: rec.occasions });
    expect(await sets(rec.publishedId)).toEqual({ sources: rec.sources, rights: rec.rights, occasions: rec.occasions });
    expect({ sources: await prisma.source.count(), rights: await prisma.rightsInformation.count(), occasions: await prisma.occasion.count() }).toEqual(catalogueBefore);
    const audit = await prisma.auditLogEntry.findFirstOrThrow({ where: { entityType: "Recording", entityId: rec.id, action: "RECORDING_DRAFT_FORKED_FROM_PUBLISHED" } });
    expect(audit.afterSnapshot).toMatchObject({ copiedSourceCount: 2, copiedRightsCount: 1, copiedOccasionCount: 2 });
  }, T);

  it("draft and published stay independent after the fork, in both directions", async () => {
    const rec = await publishedWithAllRelationships("fork-indep");
    const draft = await forkDraftFromPublished(rec.id, userIds.editor);
    const extraSource = await newSource();
    const extraOccasion = await newOccasion();
    await attachSourceToRevision(draft.id, extraSource, userIds.editor);
    await detachSourceFromRevision(draft.id, rec.sources[0], userIds.editor);
    await attachOccasionToRevision(draft.id, extraOccasion, userIds.editor);
    await detachRightsFromRevision(draft.id, rec.rights[0], userIds.editor);
    expect(await sets(rec.publishedId)).toEqual({ sources: rec.sources, rights: rec.rights, occasions: rec.occasions }); // untouched
    expect(await sets(draft.id)).toEqual({ sources: [rec.sources[1], extraSource].sort(), rights: [], occasions: [...rec.occasions, extraOccasion].sort() });
    // the published revision cannot be edited to compensate
    await expect(attachSourceToRevision(rec.publishedId, extraSource, userIds.editor)).rejects.toBeInstanceOf(RevisionNotEditableError);
  }, T);

  it("publishing the edited draft leaves each revision with its own set (the earlier one is superseded, unchanged)", async () => {
    const rec = await publishedWithAllRelationships("fork-publish");
    const draft = await forkDraftFromPublished(rec.id, userIds.editor);
    const extra = await newSource();
    await attachSourceToRevision(draft.id, extra, userIds.editor);
    expect((await publishRecordingDraft({ recordingId: rec.id, actorId: userIds.admin, expectedDraftRevisionId: draft.id, enforceCompleteness: false })).ok).toBe(true);
    expect((await sets(draft.id)).sources).toEqual([...rec.sources, extra].sort());
    expect(await sets(rec.publishedId)).toEqual({ sources: rec.sources, rights: rec.rights, occasions: rec.occasions });
  }, T);

  it("a revision with no relationships forks to a draft with none", async () => {
    const rec = await liveOnly("fork-empty");
    const draft = await forkDraftFromPublished(rec.id, userIds.editor);
    expect(await sets(draft.id)).toEqual({ sources: [], rights: [], occasions: [] });
  }, T);

  it("a failed fork leaves no draft and no partial relationship copy", async () => {
    for (const mode of ["action", "afterAction"] as const) {
      const rec = await publishedWithAllRelationships(`fork-atomic-${mode}`);
      const revisionsBefore = await prisma.recordingRevision.count({ where: { recordingId: rec.id } });
      inject[mode] = "RECORDING_DRAFT_FORKED_FROM_PUBLISHED";
      try {
        await expect(forkDraftFromPublished(rec.id, userIds.editor)).rejects.toThrow(/injected/);
      } finally {
        inject[mode] = null;
      }
      expect(await prisma.recordingRevision.count({ where: { recordingId: rec.id } })).toBe(revisionsBefore);
      const links = await prisma.recordingRevisionSource.count({ where: { revision: { recordingId: rec.id } } });
      expect(links).toBe(rec.sources.length); // only the published revision's own rows
      expect((await prisma.recording.findUniqueOrThrow({ where: { id: rec.id } })).currentDraftRevisionId).toBeNull();
      expect((await forkDraftFromPublished(rec.id, userIds.editor)).id).toBeTruthy(); // and the retry works
    }
  }, T);

  it("simultaneous forks still produce exactly one draft with exactly one copy of the relationships", async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const rec = await publishedWithAllRelationships("fork-conc");
      const results = await Promise.all([1, 2, 3].map(() => settle(forkDraftFromPublished(rec.id, userIds.editor))));
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      const draftId = (results.find((r) => r.ok) as { value: { id: string } }).value.id;
      expect(await sets(draftId)).toEqual({ sources: rec.sources, rights: rec.rights, occasions: rec.occasions });
      expect(await prisma.recordingRevisionSource.count({ where: { revision: { recordingId: rec.id } } })).toBe(rec.sources.length * 2);
    }
  }, T);

  it("an archived occasion on the published revision is copied as it is (the copy is exact; reading-time rules are unchanged)", async () => {
    const rec = await newDraft("fork-archived-occasion");
    const occasion = await newOccasion();
    await attachOccasionToRevision(rec.draftId, occasion, userIds.editor);
    await publishCurrentDraft(rec.id, userIds.admin);
    await archiveOccasion(occasion, userIds.admin);
    const draft = await forkDraftFromPublished(rec.id, userIds.editor);
    expect((await sets(draft.id)).occasions).toEqual([occasion]);
    await expect(attachOccasionToRevision(draft.id, occasion, userIds.editor)).rejects.toThrow(/already attached|archived/i);
  }, T);
});

describe("occasion-specific rules", () => {
  it("an archived Occasion cannot be newly attached to a draft (same convention as the legacy attach); nothing is written", async () => {
    const rec = await newDraft("occasion-archived");
    const occasion = await newOccasion();
    await archiveOccasion(occasion, userIds.admin);
    await expect(attachOccasionToRevision(rec.draftId, occasion, userIds.editor)).rejects.toThrow(/archived and cannot be newly attached/);
    expect((await listOccasionsForRevision(rec.draftId)).length).toBe(0);
    expect(await revisionAudits(rec.draftId, "OCCASION_ATTACHED_TO_RECORDING_REVISION")).toBe(0);
  }, T);

  it("an Occasion archived AFTER it was attached can still be detached from the draft", async () => {
    const rec = await newDraft("occasion-archived-later");
    const occasion = await newOccasion();
    await attachOccasionToRevision(rec.draftId, occasion, userIds.editor);
    await archiveOccasion(occasion, userIds.admin);
    await detachOccasionFromRevision(rec.draftId, occasion, userIds.editor);
    expect((await listOccasionsForRevision(rec.draftId)).length).toBe(0);
  }, T);
});

describe("H. cutover (Phase 6L): the legacy Recording-level rows are frozen history, and nothing reads them", () => {
  const legacyRows = (recordingId: string) =>
    Promise.all([
      prisma.entitySource.findMany({ where: { entityType: "RECORDING", entityId: recordingId }, orderBy: { id: "asc" } }),
      prisma.entityRights.findMany({ where: { entityType: "RECORDING", entityId: recordingId }, orderBy: { id: "asc" } }),
      prisma.entityOccasion.findMany({ where: { entityType: "RECORDING", entityId: recordingId }, orderBy: { id: "asc" } }),
    ]);

  it("revision-scoped writes and the fork never touch pre-existing legacy rows, and the assembled context does not read them", async () => {
    const rec = await liveOnly("legacy-untouched");
    const legacySource = await newSource(true);
    const legacyRights = await newRights();
    const legacyOccasion = await newOccasion();
    // Legacy rows as they exist from before the cutover (history), seeded the way the backfill tests do: directly.
    await prisma.entitySource.create({ data: { entityType: "RECORDING", entityId: rec.id, sourceId: legacySource } });
    await prisma.entityRights.create({ data: { entityType: "RECORDING", entityId: rec.id, rightsInformationId: legacyRights } });
    await prisma.entityOccasion.create({ data: { entityType: "RECORDING", entityId: rec.id, occasionId: legacyOccasion } });
    const legacyBefore = await legacyRows(rec.id);
    const contextBefore = await getRecordingContext(rec.id, "PUBLISHED");
    expect(contextBefore.ok).toBe(true);
    expect(JSON.stringify(contextBefore)).not.toContain(legacySource); // the frozen row is not evidence

    const draft = await forkDraftFromPublished(rec.id, userIds.editor);
    await attachSourceToRevision(draft.id, await newSource(true), userIds.editor);
    await attachRightsToRevision(draft.id, await newRights(), userIds.editor);
    await attachOccasionToRevision(draft.id, await newOccasion(), userIds.editor);

    expect(await legacyRows(rec.id)).toEqual(legacyBefore); // identical rows: nothing created, changed or removed
    expect(JSON.stringify(await getRecordingContext(rec.id, "PUBLISHED"))).toBe(JSON.stringify(contextBefore)); // a draft edit does not change the published context
  }, T);

  it("legacy writes for a Recording are refused (attach and detach, all three kinds) and create nothing; other entity types are unaffected", async () => {
    const rec = await newDraft("legacy-refused");
    const source = await newSource();
    const rights = await newRights();
    const occasion = await newOccasion();
    const frozen = LegacyRecordingRelationshipsFrozenError;
    await expect(attachSourceToEntity({ entityType: "RECORDING", entityId: rec.id, sourceId: source, actorId: userIds.editor })).rejects.toBeInstanceOf(frozen);
    await expect(attachRightsInformationToEntity({ entityType: "RECORDING", entityId: rec.id, rightsInformationId: rights, actorId: userIds.editor })).rejects.toBeInstanceOf(frozen);
    await expect(attachOccasionToEntity({ entityType: "RECORDING", entityId: rec.id, occasionId: occasion, actorId: userIds.editor })).rejects.toBeInstanceOf(frozen);
    await expect(detachSourceFromEntity("RECORDING", rec.id, source, userIds.editor)).rejects.toBeInstanceOf(frozen);
    await expect(detachRightsInformationFromEntity("RECORDING", rec.id, rights, userIds.editor)).rejects.toBeInstanceOf(frozen);
    await expect(detachOccasionFromEntity("RECORDING", rec.id, occasion, userIds.editor)).rejects.toBeInstanceOf(frozen);
    expect(await legacyRows(rec.id)).toEqual([[], [], []]);
    expect(await prisma.recordingRevisionSource.count({ where: { revisionId: rec.draftId } })).toBe(0);
    expect(await prisma.recordingRevisionRights.count({ where: { revisionId: rec.draftId } })).toBe(0);
    expect(await prisma.recordingRevisionOccasion.count({ where: { revisionId: rec.draftId } })).toBe(0);
    // Not frozen: a different entity type still attaches through the generic writer (a Work is the Recording's neighbour in the catalogue).
    const otherEntityId = randomUUID();
    await expect(attachSourceToEntity({ entityType: "WORK", entityId: otherEntityId, sourceId: source, actorId: userIds.editor })).resolves.toBeDefined();
    await prisma.entitySource.deleteMany({ where: { entityType: "WORK", entityId: otherEntityId } });
    await prisma.auditLogEntry.deleteMany({ where: { entityType: "WORK", entityId: otherEntityId } });
  }, T);

  it("a Recording whose only links are legacy rows (no backfill) forks and publishes, and its published revision has NO links: there is no read-time fallback", async () => {
    const rec = await liveOnly("legacy-only");
    await prisma.entitySource.create({ data: { entityType: "RECORDING", entityId: rec.id, sourceId: await newSource(true) } });
    const draft = await forkDraftFromPublished(rec.id, userIds.editor);
    expect((await publishRecordingDraft({ recordingId: rec.id, actorId: userIds.admin, expectedDraftRevisionId: draft.id, enforceCompleteness: false })).ok).toBe(true);
    expect((await legacyRows(rec.id))[0]).toHaveLength(1); // kept as history
    const published = await loadPublishedRecordingRelationships([rec.id]);
    expect(published.byRecording.get(rec.id)?.sources).toEqual([]); // the reader shows the revision's (empty) set, not the legacy row
  }, T);
});