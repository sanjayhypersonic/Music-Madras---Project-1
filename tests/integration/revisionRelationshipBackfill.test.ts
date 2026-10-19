import { spawnSync } from "child_process";
import { readFileSync, readdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "crypto";

import { prisma } from "../../modules/db/client";
import { createOccasion, archiveOccasion } from "../../modules/db/repositories/occasionRepository";
import { createRightsInformation } from "../../modules/db/repositories/rightsInformationRepository";
import { approveSource, createSource } from "../../modules/db/repositories/sourceRepository";
import {
  attachSourceToRevision,
  detachSourceFromRevision,
} from "../../modules/db/repositories/recordingRevisionRelationshipsRepository";
import {
  archiveRecording,
  createDraftRecording,
  forkDraftFromPublished,
  publishCurrentDraft,
  publishRecordingDraft,
} from "../../modules/db/repositories/recordingRepository";
import { loadBackfillInput, runRevisionRelationshipBackfill } from "../../modules/backfill/revisionRelationships/backfillDatabase";
import { formatBackfillReport, planRevisionRelationshipBackfill, type BackfillInput } from "../../modules/backfill/revisionRelationships/backfillPlan";
import { parseBackfillDatabaseUrl, describeTarget, type Queryable } from "../../modules/backfill/revisionRelationships/backfillTarget";

// Phase 6J-11C — the relationship backfill against the isolated loopback test database.
//
// One fixture holds every case (published+draft, published only, draft only, superseded history, no pointers, archived,
// an unsafe pointer, an editor-detached link, pre-existing revision rows, duplicate and orphaned legacy rows). The tests
// run in order and share it: dry run (no writes) -> a failed execute (rolled back) -> a racing execute -> idempotent re-runs.
// Report figures are asserted on a plan filtered to THIS file's data (the database is shared with other suites' leftovers,
// which are never asserted on). Whatever the backfill inserts is removed again in afterAll.

const T = 120000;
const TOKEN = randomUUID().slice(0, 8);
const ROOT = process.cwd();

const databaseUrl = process.env.DATABASE_URL as string;
const connect = async () => {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  return client;
};

const userIds = {} as { admin: string; editor: string };
const recordingIds: string[] = [];
const orphanIds: string[] = [];
const sourceIds: string[] = [];
const rightsIds: string[] = [];
const occasionIds: string[] = [];
let counter = 0;
const uniq = (label: string) => `bf-${label}-${TOKEN}-${++counter}-${randomUUID().slice(0, 4)}`;

interface Fix {
  id: string;
  published?: string;
  draft?: string;
  superseded?: string;
}
const fx = {} as Record<"RA" | "RB" | "RC" | "RD" | "RE" | "RF" | "RG" | "RH" | "RI", Fix>;
const ids = {} as Record<"sA1" | "sA2" | "sH1" | "sI1" | "sI2" | "sC1" | "sW" | "rA1" | "oA1" | "oA2", string>;

async function newSource(label: string, approved: boolean) {
  const source = await createSource({ title: `BF Source ${uniq(label)}`, actorId: userIds.editor });
  sourceIds.push(source.id);
  if (approved) await approveSource(source.id, userIds.admin);
  return source.id;
}

async function draftRecording(label: string): Promise<Fix> {
  const rec = await createDraftRecording({ slug: uniq(label), actorId: userIds.editor, title: `BF ${label}` });
  recordingIds.push(rec.id);
  return { id: rec.id, draft: rec.currentDraftRevisionId! };
}
async function publishedRecording(label: string): Promise<Fix> {
  const f = await draftRecording(label);
  await publishCurrentDraft(f.id, userIds.admin);
  return { id: f.id, published: f.draft };
}
async function withDraft(f: Fix): Promise<Fix> {
  const draft = await forkDraftFromPublished(f.id, userIds.editor);
  return { ...f, draft: draft.id };
}

const legacy = {
  source: (recordingId: string, sourceId: string) => prisma.entitySource.create({ data: { entityType: "RECORDING", entityId: recordingId, sourceId } }),
  rights: (recordingId: string, rightsInformationId: string) => prisma.entityRights.create({ data: { entityType: "RECORDING", entityId: recordingId, rightsInformationId } }),
  occasion: (recordingId: string, occasionId: string) => prisma.entityOccasion.create({ data: { entityType: "RECORDING", entityId: recordingId, occasionId } }),
};

/** Row counts of every table the backfill reads or could write, plus the audit trail. */
async function tableCounts() {
  return {
    legacySources: await prisma.entitySource.count(),
    legacyRights: await prisma.entityRights.count(),
    legacyOccasions: await prisma.entityOccasion.count(),
    revSources: await prisma.recordingRevisionSource.count(),
    revRights: await prisma.recordingRevisionRights.count(),
    revOccasions: await prisma.recordingRevisionOccasion.count(),
    audits: await prisma.auditLogEntry.count(),
    recordings: await prisma.recording.count(),
  };
}
const keyOf = (revisionId: string, targetId: string) => `${revisionId}:${targetId}`;
async function revisionSnapshot() {
  const [s, r, o] = await Promise.all([prisma.recordingRevisionSource.findMany(), prisma.recordingRevisionRights.findMany(), prisma.recordingRevisionOccasion.findMany()]);
  return {
    source: new Map(s.map((x) => [keyOf(x.revisionId, x.sourceId), x.createdAt.toISOString()])),
    rights: new Map(r.map((x) => [keyOf(x.revisionId, x.rightsInformationId), x.createdAt.toISOString()])),
    occasion: new Map(o.map((x) => [keyOf(x.revisionId, x.occasionId), x.createdAt.toISOString()])),
  };
}
let baseline: Awaited<ReturnType<typeof revisionSnapshot>>;
/** The revision-scoped rows exactly as the fixture left them, before any backfill ran. */
let preBackfill: Awaited<ReturnType<typeof revisionSnapshot>>;
let legacyBaseline: { source: string[]; rights: string[]; occasion: string[] };
async function legacyRowsOfMine() {
  const mine = [...recordingIds, ...orphanIds];
  return {
    source: (await prisma.entitySource.findMany({ where: { entityId: { in: mine } }, orderBy: { id: "asc" } })).map((x) => `${x.id}:${x.entityId}:${x.sourceId}`),
    rights: (await prisma.entityRights.findMany({ where: { entityId: { in: mine } }, orderBy: { id: "asc" } })).map((x) => `${x.id}:${x.entityId}:${x.rightsInformationId}`),
    occasion: (await prisma.entityOccasion.findMany({ where: { entityId: { in: mine } }, orderBy: { id: "asc" } })).map((x) => `${x.id}:${x.entityId}:${x.occasionId}`),
  };
}

/** The pure plan, restricted to this file's recordings (so other suites' leftovers never affect an assertion). */
async function myPlan() {
  const db = await connect();
  try {
    const all = await loadBackfillInput(db);
    const mine = new Set(recordingIds);
    const scope = new Set([...recordingIds, ...orphanIds]);
    const myRevisionIds = new Set((await prisma.recordingRevision.findMany({ where: { recordingId: { in: recordingIds } }, select: { id: true } })).map((r) => r.id));
    const filtered: BackfillInput = {
      ...all,
      recordings: all.recordings.filter((r) => mine.has(r.id)),
      legacy: {
        source: all.legacy.source.filter((l) => scope.has(l.recordingId)),
        rights: all.legacy.rights.filter((l) => scope.has(l.recordingId)),
        occasion: all.legacy.occasion.filter((l) => scope.has(l.recordingId)),
      },
      existing: {
        source: all.existing.source.filter((l) => myRevisionIds.has(l.revisionId)),
        rights: all.existing.rights.filter((l) => myRevisionIds.has(l.revisionId)),
        occasion: all.existing.occasion.filter((l) => myRevisionIds.has(l.revisionId)),
      },
      detached: {
        source: all.detached.source.filter((l) => myRevisionIds.has(l.revisionId)),
        rights: all.detached.rights.filter((l) => myRevisionIds.has(l.revisionId)),
        occasion: all.detached.occasion.filter((l) => myRevisionIds.has(l.revisionId)),
      },
    };
    return planRevisionRelationshipBackfill(filtered);
  } finally {
    await db.end();
  }
}

const sourcesOn = async (revisionId: string) => (await prisma.recordingRevisionSource.findMany({ where: { revisionId } })).map((x) => x.sourceId).sort();
const rightsOn = async (revisionId: string) => (await prisma.recordingRevisionRights.findMany({ where: { revisionId } })).map((x) => x.rightsInformationId).sort();
const occasionsOn = async (revisionId: string) => (await prisma.recordingRevisionOccasion.findMany({ where: { revisionId } })).map((x) => x.occasionId).sort();

// ----------------------------------------------------------------------------------------------- the script, as a process

const TSX_CLI = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
const SCRIPT = path.join("scripts", "backfillRevisionRelationships.ts");
function runScript(args: string[], env: Record<string, string>, cwd: string = ROOT) {
  // A minimal environment: nothing from this worker (in particular not its DATABASE_URL) is inherited.
  const base: Record<string, string> = {};
  for (const key of ["PATH", "Path", "SystemRoot", "SYSTEMROOT", "TEMP", "TMP", "USERPROFILE", "HOME", "APPDATA", "LOCALAPPDATA", "ComSpec", "PATHEXT", "windir"]) {
    if (process.env[key]) base[key] = process.env[key] as string;
  }
  const result = spawnSync(process.execPath, [TSX_CLI, path.join(ROOT, SCRIPT), ...args], { cwd, env: { ...base, ...env } as NodeJS.ProcessEnv, encoding: "utf8", timeout: 90000 });
  return { code: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "", output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}
const target = parseBackfillDatabaseUrl(databaseUrl)!;
const GOOD_ENV = { BACKFILL_DATABASE_URL: databaseUrl, BACKFILL_TARGET_CONFIRM: describeTarget(target) };

beforeAll(async () => {
  expect(process.env.MM_INTEGRATION_DATABASE).toBe(describeTarget(target)); // this really is the guarded test database
  for (const [key, role] of [["admin", "ADMINISTRATOR"], ["editor", "EDITOR"]] as const) {
    userIds[key] = (await prisma.studioUser.create({ data: { id: randomUUID(), email: `bf-${key}-${TOKEN}@musicmadras.test`, name: `BF ${key}`, role, status: "ACTIVE" } })).id;
  }
  baseline = await revisionSnapshot();

  ids.sA1 = await newSource("sA1", false); // UNAPPROVED: must be preserved
  ids.sA2 = await newSource("sA2", true);
  ids.sH1 = await newSource("sH1", true);
  ids.sI1 = await newSource("sI1", true);
  ids.sI2 = await newSource("sI2", true);
  ids.sC1 = await newSource("sC1", true);
  ids.sW = await newSource("sW", true);
  ids.rA1 = (await createRightsInformation({ holder: `BF holder ${uniq("r")}`, actorId: userIds.editor })).id;
  rightsIds.push(ids.rA1);
  ids.oA1 = (await createOccasion({ slug: uniq("o1"), name: `BF Occasion ${uniq("n1")}`, actorId: userIds.editor })).id;
  ids.oA2 = (await createOccasion({ slug: uniq("o2"), name: `BF Occasion ${uniq("n2")}`, actorId: userIds.editor })).id;
  occasionIds.push(ids.oA1, ids.oA2);
  await archiveOccasion(ids.oA2, userIds.admin); // ARCHIVED: must be preserved

  fx.RA = await withDraft(await publishedRecording("RA")); // published + open draft
  fx.RB = await publishedRecording("RB"); // published only
  fx.RC = await draftRecording("RC"); // draft only
  {
    // superseded history: only the CURRENT published revision may receive links
    const first = await withDraft(await publishedRecording("RD"));
    await publishRecordingDraft({ recordingId: first.id, actorId: userIds.admin, expectedDraftRevisionId: first.draft, enforceCompleteness: false });
    fx.RD = { id: first.id, published: first.draft, superseded: first.published };
  }
  fx.RE = await publishedRecording("RE"); // no revision pointers at all
  await prisma.recording.update({ where: { id: fx.RE.id }, data: { currentPublishedRevisionId: null, currentDraftRevisionId: null } });
  fx.RF = await publishedRecording("RF");
  await archiveRecording(fx.RF.id, userIds.admin); // archived, pointers retained
  fx.RG = await draftRecording("RG"); // published pointer aimed at ANOTHER recording's revision; its own draft is fine
  await prisma.recording.update({ where: { id: fx.RG.id }, data: { currentPublishedRevisionId: fx.RD.superseded! } });
  fx.RH = await withDraft(await publishedRecording("RH")); // an editor attaches then detaches a link on the draft
  fx.RI = await draftRecording("RI"); // revision-scoped row exists BEFORE it is published
  await attachSourceToRevision(fx.RI.draft!, ids.sI1, userIds.editor);
  await publishCurrentDraft(fx.RI.id, userIds.admin);
  fx.RI = { id: fx.RI.id, published: fx.RI.draft };

  // legacy rows
  await legacy.source(fx.RA.id, ids.sA1);
  await legacy.source(fx.RA.id, ids.sA1); // duplicate (the table has no unique constraint)
  await legacy.source(fx.RA.id, ids.sA2);
  await legacy.source(fx.RB.id, ids.sA2);
  await legacy.source(fx.RD.id, ids.sA1);
  await legacy.source(fx.RE.id, ids.sA1);
  await legacy.source(fx.RG.id, ids.sA2);
  await legacy.source(fx.RH.id, ids.sH1);
  await legacy.source(fx.RI.id, ids.sI1);
  await legacy.source(fx.RI.id, ids.sI2);
  // a legacy row of ANOTHER entity type that happens to carry this Recording's id: it is not a Recording link and must never be projected
  await prisma.entitySource.create({ data: { entityType: "WORK", entityId: fx.RA.id, sourceId: ids.sW } });
  await legacy.rights(fx.RA.id, ids.rA1);
  await legacy.rights(fx.RA.id, ids.rA1); // duplicate
  await legacy.rights(fx.RB.id, ids.rA1);
  await legacy.rights(fx.RF.id, ids.rA1);
  await legacy.occasion(fx.RA.id, ids.oA1);
  await legacy.occasion(fx.RA.id, ids.oA2);
  await legacy.occasion(fx.RC.id, ids.oA1);
  const orphan = randomUUID();
  const orphan2 = randomUUID();
  orphanIds.push(orphan, orphan2);
  await legacy.source(orphan, ids.sA1);
  await legacy.source(orphan2, ids.sA1); // two orphans
  await legacy.rights(orphan, ids.rA1);
  await legacy.occasion(orphan, ids.oA1);

  // an editor's own edits on drafts (revision-scoped, no legacy counterpart / explicitly removed)
  await attachSourceToRevision(fx.RC.draft!, ids.sC1, userIds.editor); // editor-only row on RC's draft
  await attachSourceToRevision(fx.RH.draft!, ids.sH1, userIds.editor);
  await detachSourceFromRevision(fx.RH.draft!, ids.sH1, userIds.editor); // the editor REMOVED it from the draft

  legacyBaseline = await legacyRowsOfMine();
  preBackfill = await revisionSnapshot();
}, T);

afterAll(async () => {
  // remove whatever the backfill added (rows not present before this file), then this file's own data
  const now = await revisionSnapshot();
  const stray = (kind: "source" | "rights" | "occasion") => [...now[kind].keys()].filter((k) => !baseline[kind].has(k));
  for (const key of stray("source")) {
    const [revisionId, sourceId] = key.split(":");
    await prisma.recordingRevisionSource.deleteMany({ where: { revisionId, sourceId } });
  }
  for (const key of stray("rights")) {
    const [revisionId, rightsInformationId] = key.split(":");
    await prisma.recordingRevisionRights.deleteMany({ where: { revisionId, rightsInformationId } });
  }
  for (const key of stray("occasion")) {
    const [revisionId, occasionId] = key.split(":");
    await prisma.recordingRevisionOccasion.deleteMany({ where: { revisionId, occasionId } });
  }
  const revisionIds = (await prisma.recordingRevision.findMany({ where: { recordingId: { in: recordingIds } }, select: { id: true } })).map((r) => r.id);
  const mine = [...recordingIds, ...orphanIds];
  await prisma.auditLogEntry.deleteMany({ where: { OR: [{ entityId: { in: [...mine, ...revisionIds, ...sourceIds, ...occasionIds, ...rightsIds] } }, { actorId: { in: Object.values(userIds) } }] } });
  await prisma.entitySource.deleteMany({ where: { entityId: { in: mine } } });
  await prisma.entityRights.deleteMany({ where: { entityId: { in: mine } } });
  await prisma.entityOccasion.deleteMany({ where: { entityId: { in: mine } } });
  await prisma.recording.updateMany({ where: { id: { in: recordingIds } }, data: { currentPublishedRevisionId: null, currentDraftRevisionId: null } });
  await prisma.recording.deleteMany({ where: { id: { in: recordingIds } } });
  await prisma.source.deleteMany({ where: { id: { in: sourceIds } } });
  await prisma.rightsInformation.deleteMany({ where: { id: { in: rightsIds } } });
  await prisma.occasion.deleteMany({ where: { id: { in: occasionIds } } });
  await prisma.studioUser.deleteMany({ where: { id: { in: Object.values(userIds) } } });
}, T);

describe("the fixture's plan (pure planner over the real database state)", () => {
  it("accounts for every legacy row of each kind, with the expected figures", async () => {
    const { report } = await myPlan();
    expect(report.recordings).toMatchObject({ total: 9, archived: 1, withPublishedPointer: 7, withDraftPointer: 4, withSafeTarget: 8, withoutSafeTarget: 1, safeTargetRevisions: 10 });
    expect(report.kinds.source).toMatchObject({
      legacyRows: 12,
      orphanedLegacyRows: 2,
      duplicateLegacyRows: 1,
      distinctLinks: 9,
      skippedNoSafeRevision: 1,
      eligibleLinks: 8,
      plannedInserts: 9,
      alreadyPresent: 1,
      skippedEditorDetached: 1,
      revisionRowsWithoutLegacy: 1,
      preservedUnapprovedSources: 2,
    });
    expect(report.kinds.rights).toMatchObject({ legacyRows: 5, orphanedLegacyRows: 1, duplicateLegacyRows: 1, distinctLinks: 3, eligibleLinks: 3, plannedInserts: 4, alreadyPresent: 0 });
    expect(report.kinds.occasion).toMatchObject({ legacyRows: 4, orphanedLegacyRows: 1, duplicateLegacyRows: 0, distinctLinks: 3, eligibleLinks: 3, plannedInserts: 5, preservedArchivedOccasions: 1 });
    const codes = Object.fromEntries(report.anomalies.map((a) => [a.code, a.count]));
    expect(codes).toMatchObject({ ORPHANED_LEGACY_LINK: 4, DUPLICATE_LEGACY_LINK: 2, NO_REVISION_POINTER: 1, POINTER_REVISION_OTHER_RECORDING: 1 });
  }, T);
});

describe("dry run (the default) performs no writes", () => {
  it("changes nothing in any table, reports the plan, and runs inside a READ ONLY transaction", async () => {
    const before = { counts: await tableCounts(), revisions: await revisionSnapshot() };
    const db = await connect();
    const statements: string[] = [];
    const recording: Queryable = {
      query: (text: string, params?: unknown[]) => {
        statements.push(text.trim().split(/\s+/).slice(0, 3).join(" ").toLowerCase());
        return db.query(text, params as never) as never;
      },
    };
    try {
      const result = await runRevisionRelationshipBackfill(recording, { execute: false });
      expect(result.mode).toBe("DRY RUN");
      expect(result.inserted).toBeUndefined();
      expect(result.report.totals.plannedInserts).toBeGreaterThanOrEqual(18); // at least this file's 9 + 4 + 5
    } finally {
      await db.end();
    }
    expect(statements[0]).toBe("begin read only");
    expect(statements.some((s) => s.startsWith("insert") || s.startsWith("update") || s.startsWith("delete"))).toBe(false);
    expect(statements[statements.length - 1]).toBe("rollback");
    expect(await tableCounts()).toEqual(before.counts);
    expect(await revisionSnapshot()).toEqual(before.revisions);
  }, T);

  it("the DATABASE itself refuses a write inside that transaction (so 'no writes' does not depend on this code)", async () => {
    const db = await connect();
    try {
      await db.query("BEGIN READ ONLY");
      await expect(
        db.query('insert into recording_revision_sources ("revisionId", "sourceId") values ($1, $2)', [fx.RA.published, ids.sH1])
      ).rejects.toThrow(/read-only transaction/i);
    } finally {
      await db.query("ROLLBACK").catch(() => undefined);
      await db.end();
    }
  }, T);

  it("the real script without --execute is a dry run: exit 0, a report, and no writes", async () => {
    const before = await tableCounts();
    const run = runScript([], GOOD_ENV);
    expect(run.code, run.output).toBe(0);
    if (process.env.BF_REPORT_FILE) writeFileSync(process.env.BF_REPORT_FILE, run.stdout); // opt-in: lets a reviewer capture the real dry-run output
    expect(run.stdout).toContain("DRY RUN (no writes)");
    expect(run.stdout).toContain("Dry run only: nothing was written");
    expect(run.stdout).toMatch(/SOURCE links/);
    expect(await tableCounts()).toEqual(before);
    const json = runScript(["--json"], GOOD_ENV);
    expect(json.code, json.output).toBe(0);
    expect(JSON.parse(json.stdout)).toMatchObject({ mode: "DRY RUN", target: describeTarget(target) });
    expect(await tableCounts()).toEqual(before);
  }, T);
});

describe("an error rolls everything back", () => {
  it("a failure on the last write leaves no rows from the earlier writes, and a later run is not blocked", async () => {
    const before = { counts: await tableCounts(), revisions: await revisionSnapshot() };
    const db = await connect();
    const failing: Queryable = {
      query: (text: string, params?: unknown[]) => {
        if (/insert into recording_revision_occasions/i.test(text)) return Promise.reject(new Error("injected failure on the occasion insert"));
        return db.query(text, params as never) as never;
      },
    };
    try {
      await expect(runRevisionRelationshipBackfill(failing, { execute: true })).rejects.toThrow(/injected failure/);
    } finally {
      await db.end();
    }
    expect(await tableCounts()).toEqual(before.counts); // the source and rights inserts that ran first were rolled back
    expect(await revisionSnapshot()).toEqual(before.revisions);
    expect(await sourcesOn(fx.RB.published!)).toEqual([]);
  }, T);

  it("a failing post-check rolls back too (the writes are never committed unverified)", async () => {
    const before = await tableCounts();
    const db = await connect();
    let inserts = 0;
    const lying: Queryable = {
      query: (text: string, params?: unknown[]) => {
        // swallow the source inserts silently: the post-check will still see them as planned
        if (/insert into recording_revision_sources/i.test(text)) {
          inserts += 1;
          return Promise.resolve({ rows: [], rowCount: 0 }) as never;
        }
        return db.query(text, params as never) as never;
      },
    };
    try {
      await expect(runRevisionRelationshipBackfill(lying, { execute: true })).rejects.toThrow(/Post-check failed/);
    } finally {
      await db.end();
    }
    expect(inserts).toBeGreaterThan(0);
    expect(await tableCounts()).toEqual(before);
  }, T);
});

describe("locking", () => {
  it("a Recording that a publish/fork/archive holds locked blocks the backfill (bounded wait): it fails and nothing is written", async () => {
    const before = { counts: await tableCounts(), revisions: await revisionSnapshot() };
    const holder = await connect();
    const db = await connect();
    try {
      await holder.query("BEGIN");
      await holder.query("select id from recordings where id = $1 for update", [fx.RA.id]); // as publishRecordingDraft/forkDraftFromPublished would
      await expect(runRevisionRelationshipBackfill(db, { execute: true })).rejects.toThrow(/lock timeout|55P03/i);
    } finally {
      await holder.query("ROLLBACK").catch(() => undefined);
      await Promise.all([holder.end(), db.end()]);
    }
    expect(await tableCounts()).toEqual(before.counts);
    expect(await revisionSnapshot()).toEqual(before.revisions);
  }, T);
});

describe("execute", () => {
  it("runs queue on the backfill lock: while it is held both wait, then exactly one inserts everything and the other finds nothing left (no duplicates)", async () => {
    const holder = await connect();
    const [a, b] = await Promise.all([connect(), connect()]);
    const pre = await tableCounts();
    let results;
    try {
      await holder.query("BEGIN");
      await holder.query("select pg_advisory_xact_lock(hashtext($1))", ["revision-relationship-backfill"]);
      const runs = [runRevisionRelationshipBackfill(a, { execute: true }), runRevisionRelationshipBackfill(b, { execute: true })];
      const settledEarly = await Promise.race([Promise.all(runs).then(() => "settled"), new Promise((resolve) => setTimeout(() => resolve("waiting"), 1200))]);
      expect(settledEarly).toBe("waiting"); // both are blocked on the lock the holder has
      expect(await tableCounts()).toEqual(pre); // (and wrote nothing meanwhile)
      await holder.query("COMMIT");
      results = await Promise.all(runs);
    } finally {
      await holder.query("ROLLBACK").catch(() => undefined);
      await Promise.all([holder.end(), a.end(), b.end()]);
    }
    const insertedTotal = (r: (typeof results)[number]) => (r.inserted ? r.inserted.source + r.inserted.rights + r.inserted.occasion : 0);
    const totals = results.map(insertedTotal).sort((x, y) => y - x);
    expect(totals[1]).toBe(0); // the loser re-planned inside its transaction after the winner committed
    expect(totals[0]).toBeGreaterThanOrEqual(18);
    expect(results.every((r) => r.remainingAfterExecute === 0)).toBe(true);
  }, T);

  it("published and current-draft revisions got exactly the expected links; nothing else did", async () => {
    const { sA1, sA2, sI1, sI2, sC1, rA1, oA1, oA2 } = ids;
    // RA: published + draft — duplicates collapsed, unapproved source and archived occasion preserved
    for (const revisionId of [fx.RA.published!, fx.RA.draft!]) {
      expect(await sourcesOn(revisionId)).toEqual([sA1, sA2].sort()); // (and NOT the WORK-typed row's source)
      expect(await rightsOn(revisionId)).toEqual([rA1]);
      expect(await occasionsOn(revisionId)).toEqual([oA1, oA2].sort());
    }
    expect(await sourcesOn(fx.RB.published!)).toEqual([sA2]);
    expect(await rightsOn(fx.RB.published!)).toEqual([rA1]);
    expect(await occasionsOn(fx.RC.draft!)).toEqual([oA1]); // draft-only recording
    expect(await sourcesOn(fx.RC.draft!)).toEqual([sC1]); // the editor's own row, untouched
    expect(await sourcesOn(fx.RD.published!)).toEqual([sA1]);
    expect(await sourcesOn(fx.RF.published!)).toEqual([]); // archived: sources none (only rights)
    expect(await rightsOn(fx.RF.published!)).toEqual([rA1]); // archived recordings are projected like any other
    expect(await sourcesOn(fx.RG.draft!)).toEqual([sA2]); // the safe draft pointer only
    expect(await sourcesOn(fx.RI.published!)).toEqual([sI1, sI2].sort());
  }, T);

  it("superseded revisions, unsafe pointers and Recordings without pointers received nothing", async () => {
    const revisionsOfRD = await prisma.recordingRevision.findMany({ where: { recordingId: fx.RD.id } });
    expect(revisionsOfRD.map((r) => r.revisionStatus).sort()).toEqual(["PUBLISHED", "SUPERSEDED"]);
    expect(await sourcesOn(fx.RD.superseded!)).toEqual([]);
    expect(await rightsOn(fx.RD.superseded!)).toEqual([]);
    expect(await occasionsOn(fx.RD.superseded!)).toEqual([]);
    // RG's published pointer named another Recording's revision: that revision (RD's superseded one) still has nothing
    // RE has no pointers: none of its revisions got anything
    const reRevisions = await prisma.recordingRevision.findMany({ where: { recordingId: fx.RE.id }, select: { id: true } });
    for (const { id } of reRevisions) {
      expect(await sourcesOn(id)).toEqual([]);
      expect(await rightsOn(id)).toEqual([]);
      expect(await occasionsOn(id)).toEqual([]);
    }
  }, T);

  it("an editor's detach is respected, pre-existing rows are not rewritten, and editor-only rows survive", async () => {
    expect(await sourcesOn(fx.RH.published!)).toEqual([ids.sH1]);
    expect(await sourcesOn(fx.RH.draft!)).toEqual([]); // the editor removed it from the draft: not re-added
    // every revision-scoped row that existed before the backfill is still there with the SAME createdAt (not rewritten)
    const after = await revisionSnapshot();
    for (const kind of ["source", "rights", "occasion"] as const) {
      for (const [key, createdAt] of preBackfill[kind]) expect(after[kind].get(key), `${kind} ${key}`).toBe(createdAt);
    }
    expect(preBackfill.source.has(keyOf(fx.RI.published!, ids.sI1))).toBe(true); // the pre-existing row ...
    expect(preBackfill.source.has(keyOf(fx.RC.draft!, ids.sC1))).toBe(true); // ... and the editor-only row, both untouched
  }, T);

  it("legacy rows are exactly as they were: nothing deleted, rewritten or added", async () => {
    expect(await legacyRowsOfMine()).toEqual(legacyBaseline);
  }, T);

  it("the fixture's own plan now has nothing left to insert", async () => {
    const { report, inserts } = await myPlan();
    expect(inserts).toEqual([]);
    expect(report.totals.plannedInserts).toBe(0);
    expect(report.kinds.source.alreadyPresent).toBeGreaterThan(0);
    expect(report.kinds.source.skippedEditorDetached).toBe(1);
    // the anomalies are still reported on every run — they are facts about the legacy data, not about this run
    expect(report.anomalies.map((a) => a.code)).toEqual(expect.arrayContaining(["ORPHANED_LEGACY_LINK", "DUPLICATE_LEGACY_LINK", "NO_REVISION_POINTER", "POINTER_REVISION_OTHER_RECORDING"]));
  }, T);
});

describe("repeating the run is idempotent", () => {
  it("running --execute again inserts nothing and changes no row (createdAt included)", async () => {
    const before = { counts: await tableCounts(), revisions: await revisionSnapshot() };
    const db = await connect();
    try {
      const again = await runRevisionRelationshipBackfill(db, { execute: true });
      expect(again.inserted).toEqual({ source: 0, rights: 0, occasion: 0 });
      expect(again.report.totals.plannedInserts).toBe(0);
    } finally {
      await db.end();
    }
    expect(await tableCounts()).toEqual(before.counts);
    expect(await revisionSnapshot()).toEqual(before.revisions);
  }, T);

  it("the real script with --execute is idempotent too: exit 0, zero inserts, no change", async () => {
    const before = { counts: await tableCounts(), revisions: await revisionSnapshot() };
    const run = runScript(["--execute", "--json"], GOOD_ENV);
    expect(run.code, run.output).toBe(0);
    const parsed = JSON.parse(run.stdout) as { mode: string; inserted: Record<string, number>; remainingAfterExecute: number };
    expect(parsed).toMatchObject({ mode: "EXECUTE", inserted: { source: 0, rights: 0, occasion: 0 }, remainingAfterExecute: 0 });
    expect(await tableCounts()).toEqual(before.counts);
    expect(await revisionSnapshot()).toEqual(before.revisions);
  }, T);

  it("the composite primary keys make a duplicate impossible even if the backfill were bypassed", async () => {
    await expect(prisma.recordingRevisionSource.create({ data: { revisionId: fx.RA.published!, sourceId: ids.sA1 } })).rejects.toThrow();
  }, T);
});

describe("the script refuses an unsafe or ambiguous target (exit 4) and never falls back to DATABASE_URL", () => {
  const remoteLooking = "postgresql://owner:fallbackpw@ep-looks-like-production.example.com:5432/neondb";

  it("without BACKFILL_DATABASE_URL it refuses — even when DATABASE_URL, DIRECT_URL or TEST_DATABASE_URL are set", () => {
    const before = Date.now();
    const run = runScript(["--execute"], { DATABASE_URL: remoteLooking, DIRECT_URL: remoteLooking, TEST_DATABASE_URL: databaseUrl, BACKFILL_TARGET_CONFIRM: describeTarget(target) });
    expect(run.code, run.output).toBe(4);
    expect(run.stderr).toMatch(/BACKFILL_DATABASE_URL is not set/);
    expect(run.output).not.toMatch(/fallbackpw|ep-looks-like-production/); // it did not even reach for them
    expect(Date.now() - before).toBeLessThan(60000);
  }, T);

  it("refuses a remote target, a non-test database name, a missing/wrong acknowledgement, and unknown arguments", () => {
    const remote = runScript([], { BACKFILL_DATABASE_URL: remoteLooking, BACKFILL_TARGET_CONFIRM: "ep-looks-like-production.example.com:5432/neondb" });
    expect(remote.code, remote.output).toBe(4);
    expect(remote.stderr).toMatch(/not a loopback IP address/);
    expect(remote.output).not.toMatch(/fallbackpw/);

    const wrongName = runScript([], { BACKFILL_DATABASE_URL: `postgresql://postgres@127.0.0.1:${target.port}/postgres`, BACKFILL_TARGET_CONFIRM: `127.0.0.1:${target.port}/postgres` });
    expect(wrongName.code, wrongName.output).toBe(4);
    expect(wrongName.stderr).toMatch(/does not look like a test database/);

    const noConfirm = runScript([], { BACKFILL_DATABASE_URL: databaseUrl });
    expect(noConfirm.code, noConfirm.output).toBe(4);
    expect(noConfirm.stderr).toMatch(/BACKFILL_TARGET_CONFIRM must be set/);

    const wrongConfirm = runScript([], { BACKFILL_DATABASE_URL: databaseUrl, BACKFILL_TARGET_CONFIRM: "127.0.0.1:1/other_test" });
    expect(wrongConfirm.code, wrongConfirm.output).toBe(4);

    const unknown = runScript(["--force"], GOOD_ENV);
    expect(unknown.code, unknown.output).toBe(4);
    expect(unknown.stderr).toMatch(/unknown argument/);
  }, T);

  it("refuses a production environment even with a perfectly valid target", () => {
    const run = runScript([], { ...GOOD_ENV, NODE_ENV: "production" });
    expect(run.code, run.output).toBe(4);
    expect(run.stderr).toMatch(/production environment/);
  }, T);

  it("URL parameters cannot redirect the connection: ?host=, ?port=, ?hostaddr= and a fragment are refused before any connection is attempted", () => {
    const remoteHost = "ep-remote-must-never-be-contacted.example.com";
    for (const suffix of [`?host=${remoteHost}`, "?port=1", `?hostaddr=10.255.255.1`, "?sslmode=disable", "?", "#frag"]) {
      const run = runScript(["--execute"], { BACKFILL_DATABASE_URL: `${databaseUrl}${suffix}`, BACKFILL_TARGET_CONFIRM: describeTarget(target) });
      expect(run.code, `${suffix}: ${run.output}`).toBe(4);
      expect(run.stderr, suffix).toMatch(/query string or fragment is refused/);
      expect(run.output, suffix).not.toMatch(/Target:|cannot connect|ENOTFOUND|ECONNREFUSED/); // it never got as far as choosing or contacting a target
      expect(run.output, suffix).not.toContain(remoteHost);
    }
  }, T);

  it("a missing port is refused, and PGPORT / PGHOST / PGDATABASE / PGUSER in the environment cannot supply or change the destination", () => {
    const noPort = runScript([], { BACKFILL_DATABASE_URL: `postgresql://postgres@127.0.0.1/${target.database}`, BACKFILL_TARGET_CONFIRM: `127.0.0.1:5432/${target.database}`, PGPORT: target.port });
    expect(noPort.code, noPort.output).toBe(4);
    expect(noPort.stderr).toMatch(/port explicitly/);

    // Hostile PG* variables with a VALID target: the explicit fields win, so it still reaches exactly the validated database.
    const hostile = runScript(["--json"], { ...GOOD_ENV, PGHOST: "ep-remote-must-never-be-contacted.example.com", PGPORT: "1", PGDATABASE: "postgres", PGUSER: "nobody", PGHOSTADDR: "10.255.255.1" });
    expect(hostile.code, hostile.output).toBe(0);
    expect((JSON.parse(hostile.stdout) as { target: string }).target).toBe(describeTarget(target));
  }, T);

  it("the confirmed target, the printed target and the actual connection are the same: the server reports exactly that port and database", async () => {
    const run = runScript([], GOOD_ENV);
    expect(run.code, run.output).toBe(0);
    expect(run.stdout).toContain(`Target: ${describeTarget(target)}`);
    const client = await connect();
    try {
      const where = await client.query<{ db: string; port: number }>("select current_database() as db, inet_server_port() as port");
      expect(`127.0.0.1:${where.rows[0].port}/${where.rows[0].db}`).toBe(describeTarget(target));
    } finally {
      await client.end();
    }
  }, T);

  it("works the same from any working directory (the real-database comparison is resolved from the script's location, not process.cwd())", () => {
    const elsewhere = runScript([], GOOD_ENV, tmpdir());
    expect(elsewhere.code, elsewhere.output).toBe(0);
    expect(elsewhere.stdout).toContain(`Target: ${describeTarget(target)}`);
    expect(elsewhere.output).not.toMatch(/repository root|cannot safely inspect/);
  }, T);

  it("a database that merely LOOKS like a test database but is not marked is refused after connecting, and nothing is written to it", async () => {
    const admin = new Client({ connectionString: `postgresql://postgres@127.0.0.1:${target.port}/postgres` });
    await admin.connect();
    const name = `mm_backfill_test_unmarked_${TOKEN.replace(/[^a-z0-9]/gi, "")}`;
    try {
      await admin.query(`create database ${name}`);
      const url = `postgresql://postgres@127.0.0.1:${target.port}/${name}`;
      const run = runScript(["--execute"], { BACKFILL_DATABASE_URL: url, BACKFILL_TARGET_CONFIRM: `127.0.0.1:${target.port}/${name}` });
      expect(run.code, run.output).toBe(4);
      expect(run.stderr).toMatch(/not marked as the integration-test database/);
      expect(run.stderr).toMatch(/cannot be positively identified/);
    } finally {
      await admin.query(`drop database if exists ${name} with (force)`).catch(() => undefined);
      await admin.end();
    }
  }, T);
});

describe("Phase 6J-12: a detach on an older revision is not silently carried forward or resurrected", () => {
  // History built through the real lifecycle: rev1 published -> fork rev2, an editor attaches then DETACHES the link on rev2 ->
  // rev2 published (rev1 superseded) -> fork rev3. The legacy Recording-level link still exists.
  const mine = {} as { recordingId: string; sourceId: string; rev2: string; rev3: string };

  it("the lifecycle keeps the detached link off the next fork (it is copied from the published set, which lacks it)", async () => {
    const sourceId = await newSource("sJ", true);
    const first = await publishedRecording("RJ");
    const withDraft1 = await withDraft(first); // rev2
    await attachSourceToRevision(withDraft1.draft!, sourceId, userIds.editor);
    await detachSourceFromRevision(withDraft1.draft!, sourceId, userIds.editor); // the editor removed it
    await publishCurrentDraft(first.id, userIds.admin); // rev2 is now the published revision
    const rev3 = (await forkDraftFromPublished(first.id, userIds.editor)).id;
    await legacy.source(first.id, sourceId); // the Recording-level link still exists in the legacy table
    Object.assign(mine, { recordingId: first.id, sourceId, rev2: withDraft1.draft!, rev3 });

    expect(await sourcesOn(first.published!)).toEqual([]); // rev1: never had a revision-scoped row
    expect(await sourcesOn(mine.rev2)).toEqual([]);
    expect(await sourcesOn(mine.rev3)).toEqual([]); // not resurrected by the fork
  }, T);

  it("the dry run flags the newer draft as a conflict (still counting its plan) and says it blocks --execute", async () => {
    const before = await tableCounts();
    const db = await connect();
    try {
      const result = await runRevisionRelationshipBackfill(db, { execute: false });
      const flagged = result.report.anomalies.find((a) => a.code === "DETACH_EVIDENCE_ON_OLDER_REVISION");
      expect(flagged?.samples).toContain(`source:${mine.recordingId}:${mine.sourceId}`);
      expect(formatBackfillReport(result.report, "DRY RUN")).toContain("BLOCKS --execute");
    } finally {
      await db.end();
    }
    expect(await tableCounts()).toEqual(before);

    const run = runScript([], GOOD_ENV);
    expect(run.code, run.output).toBe(0); // a dry run is still allowed to report it
    expect(run.stdout).toMatch(/DETACH_EVIDENCE_ON_OLDER_REVISION: [1-9].*BLOCKS --execute/);
  }, T);

  it("--execute refuses while the conflict exists: it exits non-zero, rolls back, and writes nothing (for ANY Recording)", async () => {
    const before = await tableCounts();
    const snapshot = await revisionSnapshot();
    const run = runScript(["--execute"], GOOD_ENV);
    expect(run.code, run.output).toBe(2);
    expect(run.stderr).toMatch(/Refusing to execute: DETACH_EVIDENCE_ON_OLDER_REVISION/);
    expect(run.stderr).toMatch(/nothing was written/);
    expect(await tableCounts()).toEqual(before);
    const after = await revisionSnapshot();
    for (const kind of ["source", "rights", "occasion"] as const) expect([...after[kind].entries()].sort()).toEqual([...snapshot[kind].entries()].sort());
    expect(await sourcesOn(mine.rev3)).toEqual([]);

    const db = await connect();
    try {
      await expect(runRevisionRelationshipBackfill(db, { execute: true })).rejects.toThrow(/Refusing to execute/);
    } finally {
      await db.end();
    }
    expect(await tableCounts()).toEqual(before);
  }, T);

  it("once the conflict is gone (here: the audit evidence is removed by a person's decision in the test), execute proceeds normally", async () => {
    // This stands in for the human decision. Nothing in the product deletes audit rows; the test does it to prove the block is the ONLY thing in the way.
    await prisma.auditLogEntry.deleteMany({ where: { entityId: mine.rev2, action: "SOURCE_DETACHED_FROM_RECORDING_REVISION" } });
    const run = runScript(["--execute", "--json"], GOOD_ENV);
    expect(run.code, run.output).toBe(0);
    expect(await sourcesOn(mine.rev3)).toEqual([mine.sourceId]);
  }, T);
});

describe("Phase 6J-12A: a PUBLISHED detachment is canonical; an UNPUBLISHED draft detachment suppresses nothing elsewhere", () => {
  // Rule: an explicitly detached relationship becomes part of the published revision's canonical set when that revision is published;
  // later drafts fork from that set and must not get it back. A detach that stays in an unpublished draft is only that draft's state.
  const published = {} as { recordingId: string; sourceId: string; rev1: string; rev2: string; rev3: string };
  const unpublished = {} as { recordingId: string; sourceId: string; rev1: string; rev2: string };

  async function planAnomalySamples() {
    const db = await connect();
    try {
      const result = await runRevisionRelationshipBackfill(db, { execute: false });
      return result.report.anomalies.find((a) => a.code === "DETACH_EVIDENCE_ON_OLDER_REVISION")?.samples ?? [];
    } finally {
      await db.end();
    }
  }

  it("published detachment: the published set loses the link, every later fork lacks it, and the earlier published revision keeps it", async () => {
    const sourceId = await newSource("sK", true);
    const first = await draftRecording("RK");
    await attachSourceToRevision(first.draft!, sourceId, userIds.editor);
    await publishCurrentDraft(first.id, userIds.admin); // rev1: published WITH the link
    const rev2 = (await forkDraftFromPublished(first.id, userIds.editor)).id;
    expect(await sourcesOn(rev2)).toEqual([sourceId]); // the fork starts from the published set
    await detachSourceFromRevision(rev2, sourceId, userIds.editor);
    expect(await sourcesOn(first.draft!)).toEqual([sourceId]); // the published set is frozen while the draft is edited
    await publishCurrentDraft(first.id, userIds.admin); // rev2: the detachment is now canonical
    const rev3 = (await forkDraftFromPublished(first.id, userIds.editor)).id;
    await legacy.source(first.id, sourceId); // the Recording-level (legacy) link is still there
    Object.assign(published, { recordingId: first.id, sourceId, rev1: first.draft!, rev2, rev3 });

    expect(await sourcesOn(published.rev1)).toEqual([sourceId]); // superseded, unchanged
    expect(await sourcesOn(published.rev2)).toEqual([]); // canonical published set
    expect(await sourcesOn(published.rev3)).toEqual([]); // a later draft does NOT resurrect it
  }, T);

  it("unpublished draft detachment: the published set keeps the link, the draft alone lacks it", async () => {
    const sourceId = await newSource("sL", true);
    const first = await draftRecording("RL");
    await attachSourceToRevision(first.draft!, sourceId, userIds.editor);
    await publishCurrentDraft(first.id, userIds.admin); // rev1 published WITH the link
    const rev2 = (await forkDraftFromPublished(first.id, userIds.editor)).id;
    await detachSourceFromRevision(rev2, sourceId, userIds.editor); // never published
    await legacy.source(first.id, sourceId);
    Object.assign(unpublished, { recordingId: first.id, sourceId, rev1: first.draft!, rev2 });

    expect(await sourcesOn(unpublished.rev1)).toEqual([sourceId]); // the published page's set is untouched by the draft edit
    expect(await sourcesOn(unpublished.rev2)).toEqual([]);
  }, T);

  it("backfill: the published detachment's older-revision evidence is flagged (blocking), the unpublished draft's is not", async () => {
    const samples = await planAnomalySamples();
    expect(samples).toContain(`source:${published.recordingId}:${published.sourceId}`);
    expect(samples.some((s) => s.includes(unpublished.recordingId))).toBe(false);
  }, T);

  it("backfill: the unpublished draft's own state is respected (not re-added to that draft), and the published row is left as it is", async () => {
    const db = await connect();
    try {
      const all = await loadBackfillInput(db);
      const mineRevs = new Set([unpublished.rev1, unpublished.rev2]);
      const plan = planRevisionRelationshipBackfill({
        ...all,
        recordings: all.recordings.filter((r) => r.id === unpublished.recordingId),
        legacy: { source: all.legacy.source.filter((l) => l.recordingId === unpublished.recordingId), rights: [], occasion: [] },
        existing: { source: all.existing.source.filter((l) => mineRevs.has(l.revisionId)), rights: [], occasion: [] },
        detached: { source: all.detached.source.filter((l) => mineRevs.has(l.revisionId)), rights: [], occasion: [] },
      });
      expect(plan.inserts).toEqual([]);
      expect(plan.report.kinds.source).toMatchObject({ plannedInserts: 0, alreadyPresent: 1, skippedEditorDetached: 1 });
      expect(plan.report.anomalies).toEqual([]);
    } finally {
      await db.end();
    }
  }, T);

  it("backfill: while the published detachment is unresolved, --execute refuses and the later fork is not given the link back", async () => {
    const before = await tableCounts();
    const run = runScript(["--execute"], GOOD_ENV);
    expect(run.code, run.output).toBe(2);
    expect(run.stderr).toMatch(/Refusing to execute: DETACH_EVIDENCE_ON_OLDER_REVISION/);
    expect(await tableCounts()).toEqual(before);
    expect(await sourcesOn(published.rev3)).toEqual([]);
    expect(await sourcesOn(published.rev2)).toEqual([]);
    expect(await sourcesOn(unpublished.rev2)).toEqual([]);
  }, T);
});

describe("the backfill cannot reach the application's database configuration by construction", () => {
  const files = [
    "scripts/backfillRevisionRelationships.ts",
    "modules/backfill/revisionRelationships/backfillPlan.ts",
    "modules/backfill/revisionRelationships/backfillTarget.ts",
    "modules/backfill/revisionRelationships/backfillDatabase.ts",
    "modules/backfill/revisionRelationships/backfillRealDatabases.ts",
  ];

  it("none of its sources imports the application Prisma client, the Prisma adapter or dotenv/config", () => {
    for (const file of files) {
      const text = readFileSync(path.join(ROOT, file), "utf8");
      const imports = text.split("\n").filter((line) => /^\s*import\b/.test(line)).join("\n");
      expect(imports, file).not.toMatch(/modules\/db\/client|@prisma\/client|@prisma\/adapter-pg|dotenv\/config/);
    }
  });

  it("only the explicit backfill variables are read as a target; DATABASE_URL / DIRECT_URL appear only as things to compare against", () => {
    const script = readFileSync(path.join(ROOT, "scripts/backfillRevisionRelationships.ts"), "utf8");
    const targetModule = readFileSync(path.join(ROOT, "modules/backfill/revisionRelationships/backfillTarget.ts"), "utf8");
    expect(script).toContain("resolveBackfillTarget");
    expect(targetModule).toMatch(/env\.BACKFILL_DATABASE_URL/);
    expect(targetModule).not.toMatch(/env\.DATABASE_URL|env\.DIRECT_URL|process\.env/);
    expect(script).not.toMatch(/new Client\(\{ connectionString: process\.env/);
    // the driver is only ever handed the validated fields: never a connection string (which it would parse by its own, different rules)
    expect(script).toContain("new Client(target.clientConfig)");
    expect(script).not.toMatch(/connectionString/);
    expect(script).not.toMatch(/process\.cwd\(\)/);
  });

  it("is not wired into deployment, build, startup or any application code: nothing outside the backfill itself references it", () => {
    const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> };
    for (const [name, command] of Object.entries(pkg.scripts)) {
      if (name === "backfill:revision-relationships") {
        expect(command).toBe("tsx scripts/backfillRevisionRelationships.ts"); // the only entry: an operator command
        continue;
      }
      expect(command, `package.json script "${name}"`).not.toMatch(/backfill/i); // not a pre/post hook of build, start, install or test
    }
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return entry.name === "node_modules" || entry.name === ".next" ? [] : walk(full);
        return /\.(ts|tsx|mjs|js|json)$/.test(entry.name) ? [full] : [];
      });
    const outsiders = [...walk(path.join(ROOT, "app")), ...walk(path.join(ROOT, "modules")), ...walk(path.join(ROOT, "components")), ...walk(path.join(ROOT, "scripts"))]
      .filter((file) => !file.includes(`${path.sep}backfill${path.sep}`) && !file.endsWith("backfillRevisionRelationships.ts"))
      .filter((file) => /revisionRelationships\/backfill|backfillRevisionRelationships/.test(readFileSync(file, "utf8")));
    expect(outsiders).toEqual([]);
    for (const file of ["instrumentation.ts", "next.config.ts", "middleware.ts"]) {
      try {
        expect(readFileSync(path.join(ROOT, file), "utf8"), file).not.toMatch(/backfill/i);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; // the file does not exist: nothing to wire into
      }
    }
  });
});
