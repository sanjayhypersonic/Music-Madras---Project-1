import { randomUUID } from "crypto";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Must be at the true top level — vi.mock is hoisted above every import.
const mockGetCurrentStudioSession = vi.fn();
vi.mock("../../modules/auth/authService", () => ({
  getCurrentStudioSession: () => mockGetCurrentStudioSession(),
}));

import { prisma } from "../../modules/db/client";
import { createOccasion } from "../../modules/db/repositories/occasionRepository";
import { createRightsInformation } from "../../modules/db/repositories/rightsInformationRepository";
import { approveSource, createSource } from "../../modules/db/repositories/sourceRepository";
import { createDraftRecording, forkDraftFromPublished, publishCurrentDraft, publishRecordingDraft } from "../../modules/db/repositories/recordingRepository";
import { loadPublishedRecordingRelationships } from "../../modules/db/repositories/recordingRelationshipReadersRepository";
import { runRevisionRelationshipBackfill } from "../../modules/backfill/revisionRelationships/backfillDatabase";
import { ReprojectionPlanChangedError, runLegacyReprojection } from "../../modules/backfill/legacyReprojection/reprojectionDatabase";
import { attachSourceAction, detachSourceAction } from "../../app/(studio)/studio/(protected)/recordings/[id]/relationships/actions";

// Phase 6L — the CUTOVER AND ROLLBACK REHEARSAL, on the isolated loopback test database only (the integration runner refuses anything else).
//
// The story, in order, on synthetic data:
//   1. BEFORE the cutover a live Recording has only legacy Recording-level rows (history). The revision readers show nothing for it: there is no read-time
//      fallback, which is exactly why the backfill is a prerequisite.
//   2. BACKFILL (dry run, then execute): the legacy links become revision-scoped on the Recording's revisions; a second dry run plans nothing.
//   3. THE SWITCH: an Editor uses the new Studio actions on a draft. This is the "first revision-scoped write": the published set and the (now frozen)
//      legacy rows do not move; publication makes the detach canonical.
//   4. ROLLBACK: the re-projection dry run plans exactly the change a rolled-back release would need (insert the new link, remove the link whose
//      detachment was published); a wrong fingerprint is refused and writes nothing; the reviewed run executes atomically, audited; a second plan is empty.
//   5. RECOVERY: the audit entry of the committed run restores the legacy tables exactly as they were before it.
//   6. After the rollback the legacy rows equal the published revision's set: what a rolled-back release would show visitors is what visitors saw.
// The tools run on the whole database, so this file relies on the suite's usual serial, clean-up-after-yourself discipline (as the backfill and
// re-projection tests do). Nothing here touches production.

const T = 120000;
const TOKEN = randomUUID().slice(0, 8);
const databaseUrl = process.env.DATABASE_URL as string;
const startedAt = new Date();
const users = {} as Record<"editor" | "admin", string>;
const recordingIds: string[] = [];
const sourceIds: string[] = [];
const rightsIds: string[] = [];
const occasionIds: string[] = [];
const ids = {} as Record<string, string>;
const rev = {} as Record<string, string>;

const connect = async () => {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  return client;
};
const withDb = async <T>(fn: (db: Client) => Promise<T>) => {
  const db = await connect();
  try {
    return await fn(db);
  } finally {
    await db.end();
  }
};
const sorted = (xs: string[]) => [...xs].sort();

function as(role: "EDITOR") {
  mockGetCurrentStudioSession.mockResolvedValue({ user: { id: users.editor, role, name: role, email: "editor@example.test", status: "ACTIVE" } });
}
async function redirectOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (err) {
    const digest = (err as { digest?: unknown })?.digest;
    if (typeof digest === "string" && digest.startsWith("NEXT_REDIRECT")) return decodeURIComponent(digest.split(";").slice(2, -2).join(";").replace(/\+/g, " "));
    throw err;
  }
  throw new Error("Action did not redirect");
}
const form = (name: string, value: string) => {
  const data = new FormData();
  data.set(name, value);
  return data;
};

const legacyOf = async (recordingId: string) => ({
  sources: sorted((await prisma.entitySource.findMany({ where: { entityType: "RECORDING", entityId: recordingId } })).map((x) => x.sourceId)),
  rights: sorted((await prisma.entityRights.findMany({ where: { entityType: "RECORDING", entityId: recordingId } })).map((x) => x.rightsInformationId)),
  occasions: sorted((await prisma.entityOccasion.findMany({ where: { entityType: "RECORDING", entityId: recordingId } })).map((x) => x.occasionId)),
});
async function legacySnapshot() {
  const where = { entityId: { in: recordingIds } };
  const [s, r, o] = await Promise.all([
    prisma.entitySource.findMany({ where, orderBy: { id: "asc" } }),
    prisma.entityRights.findMany({ where, orderBy: { id: "asc" } }),
    prisma.entityOccasion.findMany({ where, orderBy: { id: "asc" } }),
  ]);
  return { s: s.map((x) => `${x.id}|${x.entityId}|${x.sourceId}`), r: r.map((x) => `${x.id}|${x.entityId}|${x.rightsInformationId}`), o: o.map((x) => `${x.id}|${x.entityId}|${x.occasionId}`) };
}
async function publishedOf(recordingId: string) {
  const sets = (await loadPublishedRecordingRelationships([recordingId])).byRecording.get(recordingId);
  return {
    sources: sorted(sets?.sources.map((l) => l.sourceId) ?? []),
    rights: sorted(sets?.rights.map((l) => l.rightsInformationId) ?? []),
    occasions: sorted(sets?.occasions.map((l) => l.occasionId) ?? []),
  };
}

let preExecuteSnapshot: Awaited<ReturnType<typeof legacySnapshot>>;
let reviewedFingerprint = "";
let runId = "";

beforeAll(async () => {
  await purgeFixtures();
  for (const [key, role] of [["admin", "ADMINISTRATOR"], ["editor", "EDITOR"]] as const) {
    users[key] = (await prisma.studioUser.create({ data: { id: randomUUID(), email: `rehearsal-${key}-${TOKEN}@musicmadras.test`, name: `Rehearsal ${key}`, role, status: "ACTIVE" } })).id;
  }
  for (const key of ["sA1", "sA2", "sNew", "sQ"]) {
    const source = await createSource({ title: `Rehearsal ${key} ${TOKEN}`, actorId: users.editor });
    ids[key] = source.id;
    sourceIds.push(source.id);
    await approveSource(source.id, users.admin);
  }
  ids.rA = (await createRightsInformation({ holder: `Rehearsal holder ${TOKEN}`, actorId: users.editor })).id;
  rightsIds.push(ids.rA);
  ids.oA = (await createOccasion({ slug: `rehearsal-o-${TOKEN}`, name: `Rehearsal occasion ${TOKEN}`, actorId: users.editor })).id;
  occasionIds.push(ids.oA);

  // A: live before the cutover, with legacy links only (history). Q: never published, legacy link only.
  const a = await createDraftRecording({ slug: `rehearsal-a-${TOKEN}`, actorId: users.editor, title: "Rehearsal A" });
  await publishCurrentDraft(a.id, users.admin);
  const q = await createDraftRecording({ slug: `rehearsal-q-${TOKEN}`, actorId: users.editor, title: "Rehearsal Q" });
  ids.A = a.id;
  ids.Q = q.id;
  rev.Q = q.currentDraftRevisionId!;
  recordingIds.push(a.id, q.id);
  for (const key of ["sA1", "sA2"]) await prisma.entitySource.create({ data: { entityType: "RECORDING", entityId: a.id, sourceId: ids[key] } });
  await prisma.entityRights.create({ data: { entityType: "RECORDING", entityId: a.id, rightsInformationId: ids.rA } });
  await prisma.entityOccasion.create({ data: { entityType: "RECORDING", entityId: a.id, occasionId: ids.oA } });
  await prisma.entitySource.create({ data: { entityType: "RECORDING", entityId: q.id, sourceId: ids.sQ } });
}, T);

/**
 * Removes this file's own fixtures, found by their naming prefix (never anything else): runs before the test, so a crashed earlier run cannot leave rows
 * behind that the whole-database tools would then include in their plans, and again afterwards.
 */
async function purgeFixtures() {
  const recordings = (await prisma.recording.findMany({ where: { slug: { startsWith: "rehearsal-" } }, select: { id: true } })).map((r) => r.id);
  const revisionIds = (await prisma.recordingRevision.findMany({ where: { recordingId: { in: recordings } }, select: { id: true } })).map((r) => r.id);
  const sources = (await prisma.source.findMany({ where: { title: { startsWith: "Rehearsal " } }, select: { id: true } })).map((r) => r.id);
  const rights = (await prisma.rightsInformation.findMany({ where: { holder: { startsWith: "Rehearsal holder" } }, select: { id: true } })).map((r) => r.id);
  const occasions = (await prisma.occasion.findMany({ where: { slug: { startsWith: "rehearsal-o-" } }, select: { id: true } })).map((r) => r.id);
  const userRows = (await prisma.studioUser.findMany({ where: { email: { startsWith: "rehearsal-" } }, select: { id: true } })).map((r) => r.id);

  await prisma.entitySource.deleteMany({ where: { OR: [{ entityId: { in: recordings } }, { sourceId: { in: sources } }] } });
  await prisma.entityRights.deleteMany({ where: { OR: [{ entityId: { in: recordings } }, { rightsInformationId: { in: rights } }] } });
  await prisma.entityOccasion.deleteMany({ where: { OR: [{ entityId: { in: recordings } }, { occasionId: { in: occasions } }] } });
  await prisma.auditLogEntry.deleteMany({
    where: { OR: [{ entityId: { in: [...recordings, ...revisionIds, ...sources, ...rights, ...occasions] } }, { actorId: { in: userRows } }, { entityType: "LegacyReprojection", timestamp: { gte: startedAt } }] },
  });
  await prisma.recording.updateMany({ where: { id: { in: recordings } }, data: { currentPublishedRevisionId: null, currentDraftRevisionId: null } });
  await prisma.recording.deleteMany({ where: { id: { in: recordings } } });
  await prisma.source.deleteMany({ where: { id: { in: sources } } });
  await prisma.rightsInformation.deleteMany({ where: { id: { in: rights } } });
  await prisma.occasion.deleteMany({ where: { id: { in: occasions } } });
  await prisma.studioUser.deleteMany({ where: { id: { in: userRows } } });
}

afterAll(purgeFixtures, T);
describe("the cutover and rollback rehearsal (loopback test database only)", () => {
  it("1. before the backfill the revision readers show nothing for a Recording that only has legacy rows: there is no fallback", async () => {
    expect(await legacyOf(ids.A)).toEqual({ sources: sorted([ids.sA1, ids.sA2]), rights: [ids.rA], occasions: [ids.oA] });
    expect(await publishedOf(ids.A)).toEqual({ sources: [], rights: [], occasions: [] });
  }, T);

  it("2. the backfill dry run plans the links, the execute writes them without touching legacy rows, and a second dry run plans nothing", async () => {
    const legacyBefore = await legacySnapshot();
    const dry = await withDb((db) => runRevisionRelationshipBackfill(db, { execute: false }));
    expect(dry.mode).toBe("DRY RUN");
    expect(dry.report.totals.plannedInserts).toBeGreaterThanOrEqual(5); // A: two sources + rights + occasion; Q: one source
    const executed = await withDb((db) => runRevisionRelationshipBackfill(db, { execute: true }));
    expect(executed.remainingAfterExecute).toBe(0);

    expect(await publishedOf(ids.A)).toEqual({ sources: sorted([ids.sA1, ids.sA2]), rights: [ids.rA], occasions: [ids.oA] });
    expect((await prisma.recordingRevisionSource.findMany({ where: { revisionId: rev.Q } })).map((l) => l.sourceId)).toEqual([ids.sQ]);
    expect(await legacySnapshot()).toEqual(legacyBefore); // the backfill is insert-only on the revision-scoped tables
    const again = await withDb((db) => runRevisionRelationshipBackfill(db, { execute: false }));
    expect(again.report.totals.plannedInserts).toBe(0);
  }, T);

  it("3. THE SWITCH: new Studio actions edit a draft only; the published set and the frozen legacy rows do not move; publication makes the detach canonical", async () => {
    as("EDITOR");
    const legacyBefore = await legacySnapshot();
    const publishedBefore = await publishedOf(ids.A);
    rev.Adraft = (await forkDraftFromPublished(ids.A, users.editor)).id;

    await redirectOf(() => attachSourceAction(ids.A, rev.Adraft, form("sourceId", ids.sNew)));
    await redirectOf(() => detachSourceAction(ids.A, rev.Adraft, ids.sA1));
    expect(await publishedOf(ids.A)).toEqual(publishedBefore); // draft edits: public set unchanged
    expect(await legacySnapshot()).toEqual(legacyBefore); // legacy rows frozen: no dual write

    expect((await publishRecordingDraft({ recordingId: ids.A, actorId: users.admin, expectedDraftRevisionId: rev.Adraft, enforceCompleteness: false })).ok).toBe(true);
    expect(await publishedOf(ids.A)).toEqual({ sources: sorted([ids.sA2, ids.sNew]), rights: [ids.rA], occasions: [ids.oA] });
    expect(await legacySnapshot()).toEqual(legacyBefore); // still frozen after publication
  }, T);

  it("4. ROLLBACK dry run: the plan inserts the new link and removes the link whose detachment was published, and nothing else for these Recordings; no blocking conflict", async () => {
    const dry = await withDb((db) => runLegacyReprojection(db, { execute: false }));
    expect(dry.mode).toBe("DRY RUN");
    expect(dry.plan.blocking).toEqual([]);
    const mine = new Set(recordingIds);
    const inserts = dry.plan.inserts.filter((i) => mine.has(i.recordingId));
    const removals = dry.plan.removals.filter((r) => mine.has(r.recordingId));
    expect(inserts.map((i) => `${i.kind}:${i.recordingId === ids.A ? "A" : "Q"}:${i.targetId}`)).toEqual([`source:A:${ids.sNew}`]);
    expect(removals.map((r) => `${r.kind}:${r.recordingId === ids.A ? "A" : "Q"}:${r.targetId}`)).toEqual([`source:A:${ids.sA1}`]);
    reviewedFingerprint = dry.plan.fingerprint;
    expect(reviewedFingerprint).toMatch(/^[0-9a-f]{64}$/);
    preExecuteSnapshot = await legacySnapshot(); // the state a recovery must restore
  }, T);

  it("5. a wrong fingerprint is refused and writes nothing; the reviewed run executes atomically and is audited; a second plan is empty", async () => {
    await expect(withDb((db) => runLegacyReprojection(db, { execute: true, expectedFingerprint: "0".repeat(64) }))).rejects.toBeInstanceOf(ReprojectionPlanChangedError);
    expect(await legacySnapshot()).toEqual(preExecuteSnapshot);

    const executed = await withDb((db) => runLegacyReprojection(db, { execute: true, expectedFingerprint: reviewedFingerprint }));
    runId = executed.runId!;
    expect(executed.mode).toBe("EXECUTE");
    expect(await legacyOf(ids.A)).toEqual({ sources: sorted([ids.sA2, ids.sNew]), rights: [ids.rA], occasions: [ids.oA] });
    expect(await legacyOf(ids.Q)).toEqual({ sources: [ids.sQ], rights: [], occasions: [] }); // never-published draft: unchanged
    const audit = await prisma.auditLogEntry.findFirstOrThrow({ where: { action: "LEGACY_RELATIONSHIPS_REPROJECTED", entityId: runId } });
    expect(audit.afterSnapshot).toMatchObject({ fingerprint: reviewedFingerprint });

    const after = await withDb((db) => runLegacyReprojection(db, { execute: false }));
    expect(after.plan.inserts).toEqual([]);
    expect(after.plan.removals).toEqual([]);
  }, T);

  it("6. after the rollback the legacy rows equal the published revision's set: what a rolled-back release shows is what visitors saw", async () => {
    const published = await publishedOf(ids.A);
    expect(await legacyOf(ids.A)).toEqual(published);
  }, T);

  it("7. RECOVERY: the audit entry of the committed run restores the legacy tables exactly as they were before it", async () => {
    const audit = await prisma.auditLogEntry.findFirstOrThrow({ where: { action: "LEGACY_RELATIONSHIPS_REPROJECTED", entityId: runId } });
    const removed = ((audit.beforeSnapshot as { removedRows: Array<{ kind: string; rowId: string; recordingId: string; targetId: string }> }).removedRows) ?? [];
    const inserted = ((audit.afterSnapshot as { insertedRows: Array<{ kind: string; id: string }> }).insertedRows) ?? [];
    expect(removed.length).toBe(1);
    expect(inserted.length).toBe(1);

    for (const row of inserted) {
      if (row.kind === "source") await prisma.entitySource.delete({ where: { id: row.id } });
      else if (row.kind === "rights") await prisma.entityRights.delete({ where: { id: row.id } });
      else await prisma.entityOccasion.delete({ where: { id: row.id } });
    }
    for (const row of removed) {
      if (row.kind === "source") await prisma.entitySource.create({ data: { id: row.rowId, entityType: "RECORDING", entityId: row.recordingId, sourceId: row.targetId } });
      else if (row.kind === "rights") await prisma.entityRights.create({ data: { id: row.rowId, entityType: "RECORDING", entityId: row.recordingId, rightsInformationId: row.targetId } });
      else await prisma.entityOccasion.create({ data: { id: row.rowId, entityType: "RECORDING", entityId: row.recordingId, occasionId: row.targetId } });
    }
    expect(await legacySnapshot()).toEqual(preExecuteSnapshot);
  }, T);
});
