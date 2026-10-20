import { spawnSync } from "child_process";
import { randomUUID } from "crypto";
import { readFileSync, readdirSync } from "fs";
import path from "path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "../../modules/db/client";
import { archiveOccasion, createOccasion } from "../../modules/db/repositories/occasionRepository";
import { createRightsInformation } from "../../modules/db/repositories/rightsInformationRepository";
import { approveSource, createSource } from "../../modules/db/repositories/sourceRepository";
import {
  attachOccasionToRevision,
  attachRightsToRevision,
  attachSourceToRevision,
  detachSourceFromRevision,
} from "../../modules/db/repositories/recordingRevisionRelationshipsRepository";
import { archiveRecording, createDraftRecording, forkDraftFromPublished, publishCurrentDraft } from "../../modules/db/repositories/recordingRepository";
import { ReprojectionBlockedError, ReprojectionPlanChangedError, loadReprojectionInput, runLegacyReprojection } from "../../modules/backfill/legacyReprojection/reprojectionDatabase";
import { planLegacyReprojection, type ReprojectionInput } from "../../modules/backfill/legacyReprojection/reprojectionPlan";
import { describeTarget, parseBackfillDatabaseUrl } from "../../modules/backfill/revisionRelationships/backfillTarget";

// Phase 6J-12B — the revision-to-legacy re-projection against the isolated loopback test database.
//
// One fixture, built through the real lifecycle, holds every case (published + open draft, a published detachment followed by a fork, a
// never-published draft, an unpublished draft detachment, no pointers, an archived Recording, duplicate and orphaned legacy rows).
// The tests run in order and share it: plan -> dry run (no writes) -> argument/fingerprint refusals -> a failed execute (rolled back)
// -> a lock timeout (rolled back) -> a real execute -> recovery from the audit entry -> idempotence -> conflicts that block a run.
// Whatever the tool writes is removed again in afterAll.

const T = 120000;
const TOKEN = randomUUID().slice(0, 8);
const ROOT = process.cwd();
const databaseUrl = process.env.DATABASE_URL as string;
const target = parseBackfillDatabaseUrl(databaseUrl)!;

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
const uniq = (label: string) => `rp-${label}-${TOKEN}-${++counter}-${randomUUID().slice(0, 4)}`;

interface Fix {
  id: string;
  published?: string;
  draft?: string;
}
const fx = {} as Record<"RA" | "RB" | "RC" | "RD" | "RE" | "RF", Fix & { rev1?: string; rev2?: string; rev3?: string }>;
const ids = {} as Record<string, string>;

async function newSource(label: string, approved: boolean) {
  const source = await createSource({ title: `RP Source ${uniq(label)}`, actorId: userIds.editor });
  sourceIds.push(source.id);
  if (approved) await approveSource(source.id, userIds.admin);
  return source.id;
}
async function draftRecording(label: string): Promise<Fix> {
  const rec = await createDraftRecording({ slug: uniq(label), actorId: userIds.editor, title: `RP ${label}` });
  recordingIds.push(rec.id);
  return { id: rec.id, draft: rec.currentDraftRevisionId! };
}
const fork = async (recordingId: string) => (await forkDraftFromPublished(recordingId, userIds.editor)).id;
const publish = (recordingId: string) => publishCurrentDraft(recordingId, userIds.admin);

const legacy = {
  source: (recordingId: string, sourceId: string) => prisma.entitySource.create({ data: { entityType: "RECORDING", entityId: recordingId, sourceId } }),
  rights: (recordingId: string, rightsInformationId: string) => prisma.entityRights.create({ data: { entityType: "RECORDING", entityId: recordingId, rightsInformationId } }),
  occasion: (recordingId: string, occasionId: string) => prisma.entityOccasion.create({ data: { entityType: "RECORDING", entityId: recordingId, occasionId } }),
};

/** Every table the tool reads or could write, plus the audit trail. */
async function tableCounts() {
  return {
    legacySources: await prisma.entitySource.count(),
    legacyRights: await prisma.entityRights.count(),
    legacyOccasions: await prisma.entityOccasion.count(),
    revSources: await prisma.recordingRevisionSource.count(),
    revRights: await prisma.recordingRevisionRights.count(),
    revOccasions: await prisma.recordingRevisionOccasion.count(),
    recordings: await prisma.recording.count(),
    revisions: await prisma.recordingRevision.count(),
    sources: await prisma.source.count(),
  };
}
const auditCount = (action: string) => prisma.auditLogEntry.count({ where: { action } });
async function legacySnapshot() {
  const mine = [...recordingIds, ...orphanIds];
  const [s, r, o] = await Promise.all([
    prisma.entitySource.findMany({ where: { entityId: { in: mine } }, orderBy: { id: "asc" } }),
    prisma.entityRights.findMany({ where: { entityId: { in: mine } }, orderBy: { id: "asc" } }),
    prisma.entityOccasion.findMany({ where: { entityId: { in: mine } }, orderBy: { id: "asc" } }),
  ]);
  return {
    source: s.map((x) => `${x.id}|${x.entityId}|${x.sourceId}`),
    rights: r.map((x) => `${x.id}|${x.entityId}|${x.rightsInformationId}`),
    occasion: o.map((x) => `${x.id}|${x.entityId}|${x.occasionId}`),
  };
}
const legacyTargets = async (recordingId: string) => ({
  source: (await prisma.entitySource.findMany({ where: { entityId: recordingId } })).map((x) => x.sourceId).sort(),
  rights: (await prisma.entityRights.findMany({ where: { entityId: recordingId } })).map((x) => x.rightsInformationId).sort(),
  occasion: (await prisma.entityOccasion.findMany({ where: { entityId: recordingId } })).map((x) => x.occasionId).sort(),
});
const sourcesOn = async (revisionId: string) => (await prisma.recordingRevisionSource.findMany({ where: { revisionId } })).map((x) => x.sourceId).sort();

/** The pure plan over the real database state, restricted to this file's recordings (other suites' leftovers never matter). */
async function myPlan() {
  const db = await connect();
  try {
    const all = await loadReprojectionInput(db);
    const mine = new Set(recordingIds);
    const scope = new Set([...recordingIds, ...orphanIds]);
    const filtered: ReprojectionInput = {
      ...all,
      recordings: all.recordings.filter((r) => mine.has(r.id)),
      legacy: {
        source: all.legacy.source.filter((l) => scope.has(l.recordingId)),
        rights: all.legacy.rights.filter((l) => scope.has(l.recordingId)),
        occasion: all.legacy.occasion.filter((l) => scope.has(l.recordingId)),
      },
    };
    return planLegacyReprojection(filtered);
  } finally {
    await db.end();
  }
}

async function wholeDryRun() {
  const db = await connect();
  try {
    return await runLegacyReprojection(db, { execute: false });
  } finally {
    await db.end();
  }
}

// ------------------------------------------------------------------------------------------------ the script, as a process
const TSX_CLI = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
const SCRIPT = path.join("scripts", "reprojectLegacyRelationships.ts");
function runScript(args: string[], env: Record<string, string>, cwd: string = ROOT) {
  const base: Record<string, string> = {};
  for (const key of ["PATH", "Path", "SystemRoot", "SYSTEMROOT", "TEMP", "TMP", "USERPROFILE", "HOME", "APPDATA", "LOCALAPPDATA", "ComSpec", "PATHEXT", "windir"]) {
    if (process.env[key]) base[key] = process.env[key] as string;
  }
  const result = spawnSync(process.execPath, [TSX_CLI, path.join(ROOT, SCRIPT), ...args], { cwd, env: { ...base, ...env } as NodeJS.ProcessEnv, encoding: "utf8", timeout: 90000 });
  return { code: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "", output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}
const GOOD_ENV = { REPROJECT_DATABASE_URL: databaseUrl, REPROJECT_TARGET_CONFIRM: describeTarget(target) };
const dryRunJson = () => JSON.parse(runScript(["--json"], GOOD_ENV).stdout) as { fingerprint: string; inserts: unknown[]; removals: unknown[]; report: { totals: { inserts: number; removalRows: number; conflicts: number } } };

let preExecute: Awaited<ReturnType<typeof legacySnapshot>>;
let reviewedFingerprint: string;

beforeAll(async () => {
  expect(process.env.MM_INTEGRATION_DATABASE).toBe(describeTarget(target));
  for (const [key, role] of [["admin", "ADMINISTRATOR"], ["editor", "EDITOR"]] as const) {
    userIds[key] = (await prisma.studioUser.create({ data: { id: randomUUID(), email: `rp-${key}-${TOKEN}@musicmadras.test`, name: `RP ${key}`, role, status: "ACTIVE" } })).id;
  }

  for (const [key, approved] of [["s1", true], ["sU", false], ["s2", true], ["sB1", true], ["sB2", true], ["sC1", true], ["sC2", true], ["sD1", true], ["sE", true], ["sF1", true], ["sOrph", true]] as const) {
    ids[key] = await newSource(key, approved);
  }
  ids.r1 = (await createRightsInformation({ holder: `RP holder ${uniq("r")}`, actorId: userIds.editor })).id;
  rightsIds.push(ids.r1);
  ids.o1 = (await createOccasion({ slug: uniq("o1"), name: `RP Occasion ${uniq("n1")}`, actorId: userIds.editor })).id;
  ids.oArch = (await createOccasion({ slug: uniq("o2"), name: `RP Occasion ${uniq("n2")}`, actorId: userIds.editor })).id;
  occasionIds.push(ids.o1, ids.oArch);

  // RA: published {s1, sU, r1, o1, oArch}; an open draft adds s2 (an unpublished edit legacy cannot hold)
  {
    const a = await draftRecording("RA");
    await attachSourceToRevision(a.draft!, ids.s1, userIds.editor);
    await attachSourceToRevision(a.draft!, ids.sU, userIds.editor);
    await attachRightsToRevision(a.draft!, ids.r1, userIds.editor);
    await attachOccasionToRevision(a.draft!, ids.o1, userIds.editor);
    await attachOccasionToRevision(a.draft!, ids.oArch, userIds.editor);
    await publish(a.id);
    await archiveOccasion(ids.oArch, userIds.admin); // archived AFTER being attached
    const draft = await fork(a.id);
    await attachSourceToRevision(draft, ids.s2, userIds.editor);
    fx.RA = { id: a.id, published: a.draft, draft };
  }
  // RB: a PUBLISHED detachment followed by a fork: rev1 {sB1,sB2} -> rev2 detaches sB1 and is published -> rev3 forked (lacks sB1)
  {
    const b = await draftRecording("RB");
    await attachSourceToRevision(b.draft!, ids.sB1, userIds.editor);
    await attachSourceToRevision(b.draft!, ids.sB2, userIds.editor);
    await publish(b.id);
    const rev2 = await fork(b.id);
    await detachSourceFromRevision(rev2, ids.sB1, userIds.editor);
    await publish(b.id);
    const rev3 = await fork(b.id);
    fx.RB = { id: b.id, rev1: b.draft, rev2, rev3, published: rev2, draft: rev3 };
  }
  // RC: never published; its draft attached then detached sC2 (the draft IS the authoritative state)
  {
    const c = await draftRecording("RC");
    await attachSourceToRevision(c.draft!, ids.sC1, userIds.editor);
    await attachSourceToRevision(c.draft!, ids.sC2, userIds.editor);
    await detachSourceFromRevision(c.draft!, ids.sC2, userIds.editor);
    fx.RC = c;
  }
  // RD: published {sD1}; the open draft detaches sD1 but is never published (the published set keeps it)
  {
    const d = await draftRecording("RD");
    await attachSourceToRevision(d.draft!, ids.sD1, userIds.editor);
    await publish(d.id);
    const draft = await fork(d.id);
    await detachSourceFromRevision(draft, ids.sD1, userIds.editor);
    fx.RD = { id: d.id, published: d.draft, draft };
  }
  // RE: no pointers at all
  {
    const e = await draftRecording("RE");
    await publish(e.id);
    await prisma.recording.update({ where: { id: e.id }, data: { currentPublishedRevisionId: null, currentDraftRevisionId: null } });
    fx.RE = { id: e.id };
  }
  // RF: archived (pointers retained), published {sF1}
  {
    const f = await draftRecording("RF");
    await attachSourceToRevision(f.draft!, ids.sF1, userIds.editor);
    await publish(f.id);
    await archiveRecording(f.id, userIds.admin);
    fx.RF = { id: f.id, published: f.draft };
  }

  // legacy rows (the state a rolled-back cutover would find)
  await legacy.source(fx.RA.id, ids.s1);
  await legacy.source(fx.RA.id, ids.s1); // duplicate: the table has no unique constraint
  await legacy.rights(fx.RA.id, ids.r1);
  await legacy.source(fx.RB.id, ids.sB1); // detached in published history -> must go
  await legacy.source(fx.RB.id, ids.sB2);
  await legacy.source(fx.RC.id, ids.sC1);
  await legacy.source(fx.RC.id, ids.sC2); // detached from the authoritative draft -> must go
  await legacy.source(fx.RD.id, ids.sD1); // detached only in an UNPUBLISHED draft -> stays
  await legacy.source(fx.RE.id, ids.sE); // no pointers -> untouched
  const orphan = randomUUID();
  orphanIds.push(orphan);
  await legacy.source(orphan, ids.sOrph); // no such Recording -> untouched
  preExecute = await legacySnapshot();
}, T);

afterAll(async () => {
  const revisionIds = (await prisma.recordingRevision.findMany({ where: { recordingId: { in: recordingIds } }, select: { id: true } })).map((r) => r.id);
  const mine = [...recordingIds, ...orphanIds];
  await prisma.auditLogEntry.deleteMany({
    where: { OR: [{ action: { in: ["LEGACY_RELATIONSHIPS_REPROJECTED", "LEGACY_RELATIONSHIPS_REPROJECTION_FAILED"] } }, { entityId: { in: [...mine, ...revisionIds, ...sourceIds, ...occasionIds, ...rightsIds] } }, { actorId: { in: Object.values(userIds) } }] },
  });
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
  it("the lifecycle left the revision sets this contract relies on", async () => {
    expect(await sourcesOn(fx.RB.rev1!)).toEqual([ids.sB1, ids.sB2].sort()); // superseded: unchanged
    expect(await sourcesOn(fx.RB.rev2!)).toEqual([ids.sB2]); // the published detachment is canonical
    expect(await sourcesOn(fx.RB.rev3!)).toEqual([ids.sB2]); // the next fork does not get it back
    expect(await sourcesOn(fx.RD.published!)).toEqual([ids.sD1]); // an unpublished detachment leaves the published set alone
    expect(await sourcesOn(fx.RD.draft!)).toEqual([]);
  });

  it("accounts for every legacy row of each kind, with the expected figures", async () => {
    const plan = await myPlan();
    const r = plan.report;
    expect(r.recordings).toEqual({ total: 6, withAuthority: 5, authorityPublished: 4, authorityDraft: 1, withoutAuthority: 1 });
    expect(r.kinds.source).toMatchObject({
      legacyRows: 9, orphanedLegacyRows: 1, duplicateLegacyRows: 1, distinctLinks: 7, skippedNoAuthority: 1,
      retained: 4, removedLinks: 2, removedRows: 2, conflicts: 0, authoritativeLinks: 6, inserted: 2, preservedUnapprovedSources: 1,
    });
    expect(r.kinds.rights).toMatchObject({ legacyRows: 1, distinctLinks: 1, retained: 1, removedLinks: 0, inserted: 0, authoritativeLinks: 1 });
    expect(r.kinds.occasion).toMatchObject({ legacyRows: 0, distinctLinks: 0, retained: 0, inserted: 2, authoritativeLinks: 2, preservedArchivedOccasions: 1 });
    expect(r.totals).toEqual({ inserts: 4, removalRows: 2, conflicts: 0 });
    expect(Object.fromEntries(r.anomalies.map((a) => [a.code, a.count]))).toEqual({
      DUPLICATE_LEGACY_LINK: 1, NO_REVISION_POINTER: 1, ORPHANED_LEGACY_LINK: 1, UNPUBLISHED_DRAFT_DIFFERENCE: 2,
    });
    expect(plan.blocking).toEqual([]);
    for (const kind of ["source", "rights", "occasion"] as const) {
      const k = r.kinds[kind];
      expect(k.legacyRows).toBe(k.orphanedLegacyRows + k.duplicateLegacyRows + k.distinctLinks);
      expect(k.distinctLinks).toBe(k.skippedNoAuthority + k.retained + k.removedLinks + k.conflicts);
      expect(k.authoritativeLinks).toBe(k.retained + k.inserted);
    }
  });

  it("removes exactly the proven detachments; keeps the unpublished draft's detachment out of it; never resurrects through the fork", async () => {
    const plan = await myPlan();
    const removedTargets = plan.removals.map((x) => `${x.recordingId}:${x.targetId}`).sort();
    expect(removedTargets).toEqual([`${fx.RB.id}:${ids.sB1}`, `${fx.RC.id}:${ids.sC2}`].sort());
    expect(plan.inserts.map((x) => `${x.kind}:${x.recordingId}:${x.targetId}`).sort()).toEqual(
      [`source:${fx.RA.id}:${ids.sU}`, `source:${fx.RF.id}:${ids.sF1}`, `occasion:${fx.RA.id}:${ids.o1}`, `occasion:${fx.RA.id}:${ids.oArch}`].sort()
    );
    expect(plan.inserts.some((x) => x.targetId === ids.s2)).toBe(false); // the unpublished draft edit is NOT carried back
    expect(plan.removals.some((x) => x.recordingId === fx.RD.id)).toBe(false);
  });
});

describe("dry run (the default) performs no writes", () => {
  it("changes nothing, reports the plan with its fingerprint, and runs inside a READ ONLY transaction", async () => {
    const counts = await tableCounts();
    const legacyBefore = await legacySnapshot();
    const audits = await prisma.auditLogEntry.count();
    const result = await wholeDryRun();
    expect(result.mode).toBe("DRY RUN");
    expect(result.plan.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(await tableCounts()).toEqual(counts);
    expect(await legacySnapshot()).toEqual(legacyBefore);
    expect(await prisma.auditLogEntry.count()).toBe(audits);
    const db = await connect();
    try {
      await db.query("BEGIN READ ONLY");
      await expect(db.query(`delete from entity_sources where "entityId" = $1`, [fx.RB.id])).rejects.toThrow(/read-only transaction/);
    } finally {
      await db.query("ROLLBACK").catch(() => undefined);
      await db.end();
    }
  }, T);

  it("the real script without --execute is a dry run: exit 0, a report with a fingerprint and the next step, and no writes", async () => {
    const counts = await tableCounts();
    const run = runScript([], GOOD_ENV);
    expect(run.code, run.output).toBe(0);
    expect(run.stdout).toMatch(/Revision-to-legacy re-projection - DRY RUN \(no writes\)/);
    expect(run.stdout).toMatch(/Plan fingerprint: [0-9a-f]{64}/);
    expect(run.stdout).toMatch(/Dry run only: nothing was written/);
    expect(await tableCounts()).toEqual(counts);
    expect(await legacySnapshot()).toEqual(preExecute);
    const json = dryRunJson();
    expect(json.removals).toHaveLength(2);
    expect(json.inserts).toHaveLength(4);
    reviewedFingerprint = json.fingerprint;
  }, T);
});

describe("execution is explicit, tied to a reviewed plan, and refused otherwise (exit 4 before any connection, or exit 2 and nothing written)", () => {
  it("--execute needs the plan fingerprint; a malformed or stray fingerprint is refused; unknown flags are refused", () => {
    for (const args of [["--execute"], ["--execute", "--plan-fingerprint=abc"], ["--execute", "--plan-fingerprint=" + "G".repeat(64)], ["--plan-fingerprint=" + "a".repeat(64)], ["--force"], ["--execute", "--plan-fingerprint=" + "a".repeat(64), "--plan-fingerprint=" + "b".repeat(64)]]) {
      const run = runScript(args, GOOD_ENV);
      expect(run.code, `${args.join(" ")}: ${run.output}`).toBe(4);
    }
  }, T);

  it("a fingerprint that is not the current plan's is refused after the plan is recomputed inside the transaction: exit 2, nothing written, a failure audit entry", async () => {
    const counts = await tableCounts();
    const failures = await auditCount("LEGACY_RELATIONSHIPS_REPROJECTION_FAILED");
    const run = runScript(["--execute", `--plan-fingerprint=${"0".repeat(64)}`], GOOD_ENV);
    expect(run.code, run.output).toBe(2);
    expect(run.stderr).toMatch(/plan computed now differs from the plan whose fingerprint was supplied/);
    expect(await tableCounts()).toEqual(counts);
    expect(await legacySnapshot()).toEqual(preExecute);
    expect(await auditCount("LEGACY_RELATIONSHIPS_REPROJECTION_FAILED")).toBe(failures + 1);
    const db = await connect();
    try {
      await expect(runLegacyReprojection(db, { execute: true, expectedFingerprint: "f".repeat(64) })).rejects.toBeInstanceOf(ReprojectionPlanChangedError);
    } finally {
      await db.end();
    }
  }, T);
});

describe("a failed execution rolls back atomically", () => {
  it("a failure on the LAST write (the audit entry) undoes every delete and insert; the failure is audited; a later run is not blocked", async () => {
    const counts = await tableCounts();
    const failures = await auditCount("LEGACY_RELATIONSHIPS_REPROJECTION_FAILED");
    const admin = await connect();
    try {
      await admin.query(
        `create function reproject_test_fail() returns trigger language plpgsql as $$ begin if new.action = 'LEGACY_RELATIONSHIPS_REPROJECTED' then raise exception 'injected failure after all writes'; end if; return new; end $$`
      );
      await admin.query(`create trigger reproject_test_fail before insert on audit_log_entries for each row execute function reproject_test_fail()`);
      const db = await connect();
      try {
        await expect(runLegacyReprojection(db, { execute: true, expectedFingerprint: (await wholeDryRun()).plan.fingerprint })).rejects.toThrow(/injected failure after all writes/);
      } finally {
        await db.end();
      }
    } finally {
      await admin.query("drop trigger if exists reproject_test_fail on audit_log_entries").catch(() => undefined);
      await admin.query("drop function if exists reproject_test_fail()").catch(() => undefined);
      await admin.end();
    }
    expect(await tableCounts()).toEqual(counts);
    expect(await legacySnapshot()).toEqual(preExecute); // not one row deleted or added
    expect(await auditCount("LEGACY_RELATIONSHIPS_REPROJECTED")).toBe(0);
    expect(await auditCount("LEGACY_RELATIONSHIPS_REPROJECTION_FAILED")).toBe(failures + 1);
    expect((await wholeDryRun()).plan.fingerprint).toBe(reviewedFingerprint); // the plan is unchanged, and the tool is usable again
  }, T);

  it("a Recording that another transaction holds locked blocks the run (bounded wait): it fails with a lock timeout and writes nothing", async () => {
    const counts = await tableCounts();
    const holder = await connect();
    try {
      await holder.query("BEGIN");
      await holder.query("select id from recordings where id = $1 for update", [fx.RA.id]);
      const db = await connect();
      const started = Date.now();
      try {
        await expect(runLegacyReprojection(db, { execute: true, expectedFingerprint: reviewedFingerprint })).rejects.toThrow(/lock timeout/i);
      } finally {
        await db.end();
      }
      expect(Date.now() - started).toBeLessThan(30000);
    } finally {
      await holder.query("ROLLBACK").catch(() => undefined);
      await holder.end();
    }
    expect(await tableCounts()).toEqual(counts);
    expect(await legacySnapshot()).toEqual(preExecute);
  }, T);

  it("a legacy writer that holds a legacy table lock also blocks it (the legacy tables are locked against concurrent writers while it runs)", async () => {
    const holder = await connect();
    try {
      await holder.query("BEGIN");
      await holder.query(`insert into entity_sources (id, "entityType", "entityId", "sourceId") values (gen_random_uuid()::text, 'WORK', $1, $2)`, [randomUUID(), ids.sOrph]);
      const db = await connect();
      try {
        await expect(runLegacyReprojection(db, { execute: true, expectedFingerprint: reviewedFingerprint })).rejects.toThrow(/lock timeout/i);
      } finally {
        await db.end();
      }
    } finally {
      await holder.query("ROLLBACK").catch(() => undefined);
      await holder.end();
    }
    expect(await legacySnapshot()).toEqual(preExecute);
  }, T);
});

describe("execute", () => {
  it("applies exactly the reviewed plan in one transaction: the proven removals, the missing links, nothing else", async () => {
    const revisionRowsBefore = [await prisma.recordingRevisionSource.count(), await prisma.recordingRevisionRights.count(), await prisma.recordingRevisionOccasion.count()];
    const run = runScript(["--execute", `--plan-fingerprint=${reviewedFingerprint}`, "--json"], GOOD_ENV);
    expect(run.code, run.output).toBe(0);
    const out = JSON.parse(run.stdout) as { mode: string; runId: string; inserted: Record<string, number>; deleted: Record<string, number> };
    expect(out.mode).toBe("EXECUTE");
    expect(out.inserted).toEqual({ source: 2, rights: 0, occasion: 2 });
    expect(out.deleted).toEqual({ source: 2, rights: 0, occasion: 0 });

    expect(await legacyTargets(fx.RA.id)).toEqual({ source: [ids.s1, ids.s1, ids.sU].sort(), rights: [ids.r1], occasion: [ids.o1, ids.oArch].sort() }); // incl. the duplicate row, untouched
    expect(await legacyTargets(fx.RB.id)).toEqual({ source: [ids.sB2], rights: [], occasion: [] }); // the published detachment was applied
    expect(await legacyTargets(fx.RC.id)).toEqual({ source: [ids.sC1], rights: [], occasion: [] });
    expect(await legacyTargets(fx.RD.id)).toEqual({ source: [ids.sD1], rights: [], occasion: [] }); // unpublished draft detachment: unchanged
    expect(await legacyTargets(fx.RE.id)).toEqual({ source: [ids.sE], rights: [], occasion: [] }); // no pointers: untouched
    expect(await legacyTargets(fx.RF.id)).toEqual({ source: [ids.sF1], rights: [], occasion: [] });
    expect(await legacyTargets(orphanIds[0])).toEqual({ source: [ids.sOrph], rights: [], occasion: [] }); // orphan: untouched
    expect([await prisma.recordingRevisionSource.count(), await prisma.recordingRevisionRights.count(), await prisma.recordingRevisionOccasion.count()]).toEqual(revisionRowsBefore); // revision-scoped data only READ
    // the unrelated pre-existing rows keep their ids
    const now = await legacySnapshot();
    for (const row of preExecute.source.filter((r) => r.includes(fx.RE.id) || r.includes(fx.RD.id) || r.includes(orphanIds[0]))) expect(now.source).toContain(row);
  }, T);

  it("writes ONE audit entry holding every removed row (to restore) and every inserted row id (to undo)", async () => {
    const entries = await prisma.auditLogEntry.findMany({ where: { action: "LEGACY_RELATIONSHIPS_REPROJECTED" } });
    expect(entries).toHaveLength(1);
    const before = entries[0].beforeSnapshot as { removedRows: { kind: string; rowId: string; recordingId: string; targetId: string }[] };
    const after = entries[0].afterSnapshot as { fingerprint: string; insertedRows: { kind: string; id: string; recordingId: string; targetId: string }[]; counts: unknown };
    expect(after.fingerprint).toBe(reviewedFingerprint);
    expect(before.removedRows.map((r) => r.rowId).sort()).toEqual(
      preExecute.source.filter((r) => r.includes(`|${fx.RB.id}|${ids.sB1}`) || r.includes(`|${fx.RC.id}|${ids.sC2}`)).map((r) => r.split("|")[0]).sort()
    );
    expect(after.insertedRows).toHaveLength(4);
    expect(entries[0].entityType).toBe("LegacyReprojection");
  }, T);

  it("RECOVERY: the audit entry alone is enough to put the legacy tables back exactly as they were (same rows, same ids)", async () => {
    const entry = (await prisma.auditLogEntry.findMany({ where: { action: "LEGACY_RELATIONSHIPS_REPROJECTED" } }))[0];
    const removed = (entry.beforeSnapshot as { removedRows: { kind: string; rowId: string; recordingId: string; targetId: string }[] }).removedRows;
    const inserted = (entry.afterSnapshot as { insertedRows: { kind: string; id: string }[] }).insertedRows;
    await prisma.entitySource.deleteMany({ where: { id: { in: inserted.filter((r) => r.kind === "source").map((r) => r.id) } } });
    await prisma.entityOccasion.deleteMany({ where: { id: { in: inserted.filter((r) => r.kind === "occasion").map((r) => r.id) } } });
    for (const row of removed.filter((r) => r.kind === "source")) await prisma.entitySource.create({ data: { id: row.rowId, entityType: "RECORDING", entityId: row.recordingId, sourceId: row.targetId } });
    expect(await legacySnapshot()).toEqual(preExecute);
    // and the tool can then do it again: the same plan, hence the same fingerprint
    expect((await wholeDryRun()).plan.fingerprint).toBe(reviewedFingerprint);
    const run = runScript(["--execute", `--plan-fingerprint=${reviewedFingerprint}`], GOOD_ENV);
    expect(run.code, run.output).toBe(0);
  }, T);

  it("is idempotent: the next dry run has nothing to do, and executing that (empty) plan changes no legacy row", async () => {
    const afterFirst = await legacySnapshot();
    const json = dryRunJson();
    expect(json.report.totals).toEqual({ inserts: 0, removalRows: 0, conflicts: 0 });
    expect(json.inserts).toEqual([]);
    expect(json.removals).toEqual([]);
    const run = runScript(["--execute", `--plan-fingerprint=${json.fingerprint}`, "--json"], GOOD_ENV);
    expect(run.code, run.output).toBe(0);
    expect(JSON.parse(run.stdout)).toMatchObject({ inserted: { source: 0, rights: 0, occasion: 0 }, deleted: { source: 0, rights: 0, occasion: 0 } });
    expect(await legacySnapshot()).toEqual(afterFirst);
  }, T);
});

describe("conflicts are reported, never guessed: they block a run and the rows are kept", () => {
  it("a legacy link the revision set does not explain, and an unsafe authoritative pointer, both BLOCK --execute; nothing is deleted", async () => {
    const g = await draftRecording("RG");
    ids.sG1 = await newSource("sG1", true);
    ids.sGm = await newSource("sGm", true);
    await attachSourceToRevision(g.draft!, ids.sG1, userIds.editor);
    await publish(g.id);
    await legacy.source(g.id, ids.sG1);
    await legacy.source(g.id, ids.sGm); // in legacy, nowhere in the revision history: no proof it was removed
    const h = await draftRecording("RH");
    await publish(h.id);
    await prisma.recording.update({ where: { id: h.id }, data: { currentPublishedRevisionId: fx.RB.rev1 } }); // another Recording's (superseded) revision
    await legacy.source(h.id, ids.sG1);

    const counts = await tableCounts();
    const snapshot = await legacySnapshot();
    const dry = runScript([], GOOD_ENV);
    expect(dry.code, dry.output).toBe(0);
    expect(dry.stdout).toMatch(/LEGACY_LINK_NOT_IN_REVISION_SET: 1.*BLOCKS --execute/);
    expect(dry.stdout).toMatch(/AUTHORITATIVE_POINTER_STATUS_MISMATCH|AUTHORITATIVE_POINTER_OTHER_RECORDING/);
    expect(dry.stdout).toMatch(/BLOCKED: resolve the conflicts above/);
    const fingerprint = dryRunJson().fingerprint;
    const run = runScript(["--execute", `--plan-fingerprint=${fingerprint}`], GOOD_ENV);
    expect(run.code, run.output).toBe(2);
    expect(run.stderr).toMatch(/Refusing to execute: .*LEGACY_LINK_NOT_IN_REVISION_SET/);
    expect(await tableCounts()).toEqual(counts);
    expect(await legacySnapshot()).toEqual(snapshot);
    expect((await legacyTargets(g.id)).source).toContain(ids.sGm); // the unexplained row is still there

    const db = await connect();
    try {
      await expect(runLegacyReprojection(db, { execute: true, expectedFingerprint: fingerprint })).rejects.toBeInstanceOf(ReprojectionBlockedError);
    } finally {
      await db.end();
    }
  }, T);
});

describe("the script refuses an unsafe or ambiguous target (exit 4), validates the real destination, and never falls back", () => {
  const remoteLooking = "postgresql://owner:fallbackpw@ep-looks-like-production.example.com:5432/neondb";

  it("without REPROJECT_DATABASE_URL it refuses — even when BACKFILL_*, DATABASE_URL, DIRECT_URL or TEST_DATABASE_URL are set", () => {
    const run = runScript([], { BACKFILL_DATABASE_URL: databaseUrl, BACKFILL_TARGET_CONFIRM: describeTarget(target), DATABASE_URL: remoteLooking, DIRECT_URL: remoteLooking, TEST_DATABASE_URL: databaseUrl, REPROJECT_TARGET_CONFIRM: describeTarget(target) });
    expect(run.code, run.output).toBe(4);
    expect(run.stderr).toMatch(/REPROJECT_DATABASE_URL is not set/);
    expect(run.output).not.toMatch(/fallbackpw|ep-looks-like-production/);
  }, T);

  it("refuses a remote target, URL query overrides, a missing port, a missing/wrong acknowledgement, and a production environment", () => {
    const remote = runScript([], { REPROJECT_DATABASE_URL: remoteLooking, REPROJECT_TARGET_CONFIRM: "ep-looks-like-production.example.com:5432/neondb" });
    expect(remote.code, remote.output).toBe(4);
    expect(remote.stderr).toMatch(/not a loopback IP address/);
    expect(remote.output).not.toMatch(/fallbackpw/);

    for (const suffix of ["?host=ep-remote-must-never-be-contacted.example.com", "?port=1", "?hostaddr=10.255.255.1", "?sslmode=disable", "#frag"]) {
      const run = runScript(["--json"], { REPROJECT_DATABASE_URL: `${databaseUrl}${suffix}`, REPROJECT_TARGET_CONFIRM: describeTarget(target) });
      expect(run.code, `${suffix}: ${run.output}`).toBe(4);
      expect(run.output, suffix).not.toMatch(/cannot connect|ENOTFOUND|ECONNREFUSED|ep-remote-must-never/);
    }

    const noPort = runScript([], { REPROJECT_DATABASE_URL: `postgresql://postgres@127.0.0.1/${target.database}`, REPROJECT_TARGET_CONFIRM: `127.0.0.1:5432/${target.database}`, PGPORT: target.port });
    expect(noPort.code, noPort.output).toBe(4);
    expect(noPort.stderr).toMatch(/port explicitly/);

    expect(runScript([], { REPROJECT_DATABASE_URL: databaseUrl }).code).toBe(4);
    expect(runScript([], { REPROJECT_DATABASE_URL: databaseUrl, REPROJECT_TARGET_CONFIRM: "127.0.0.1:1/other_test" }).code).toBe(4);
    const production = runScript([], { ...GOOD_ENV, NODE_ENV: "production" });
    expect(production.code, production.output).toBe(4);
    expect(production.stderr).toMatch(/production environment/);
  }, T);

  it("hostile PG* variables cannot change the destination; the confirmed target IS the actual connection; the working directory does not matter", async () => {
    const hostile = runScript(["--json"], { ...GOOD_ENV, PGHOST: "ep-remote-must-never-be-contacted.example.com", PGPORT: "1", PGDATABASE: "postgres", PGUSER: "nobody", PGHOSTADDR: "10.255.255.1" });
    expect(hostile.code, hostile.output).toBe(0);
    expect((JSON.parse(hostile.stdout) as { target: string }).target).toBe(describeTarget(target));
    const client = await connect();
    try {
      const where = await client.query<{ db: string; port: number }>("select current_database() as db, inet_server_port() as port");
      expect(`127.0.0.1:${where.rows[0].port}/${where.rows[0].db}`).toBe(describeTarget(target));
    } finally {
      await client.end();
    }
    const elsewhere = runScript([], GOOD_ENV, path.parse(ROOT).root);
    expect(elsewhere.code, elsewhere.output).toBe(0);
  }, T);

  it("a database that merely LOOKS like a test database but is not marked is refused after connecting, and nothing is written to it", async () => {
    const admin = new Client({ connectionString: `postgresql://postgres@127.0.0.1:${target.port}/postgres` });
    await admin.connect();
    const name = `mm_reproject_test_unmarked_${TOKEN.replace(/[^a-z0-9]/gi, "")}`;
    try {
      await admin.query(`create database ${name}`);
      const run = runScript(["--execute", `--plan-fingerprint=${"a".repeat(64)}`], { REPROJECT_DATABASE_URL: `postgresql://postgres@127.0.0.1:${target.port}/${name}`, REPROJECT_TARGET_CONFIRM: `127.0.0.1:${target.port}/${name}` });
      expect(run.code, run.output).toBe(4);
      expect(run.stderr).toMatch(/not marked as the integration-test database/);
    } finally {
      await admin.query(`drop database if exists ${name} with (force)`).catch(() => undefined);
      await admin.end();
    }
  }, T);
});

describe("the re-projection is not wired into anything (preparing rollback is not approving a cutover)", () => {
  it("only an operator command references it; no application code, build, start or test hook does", () => {
    const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> };
    for (const [name, command] of Object.entries(pkg.scripts)) {
      if (name === "reproject:legacy-relationships") {
        expect(command).toBe("tsx scripts/reprojectLegacyRelationships.ts");
        continue;
      }
      expect(command, `package.json script "${name}"`).not.toMatch(/reproject/i);
    }
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return entry.name === "node_modules" || entry.name === ".next" ? [] : walk(full);
        return /\.(ts|tsx|mjs|js|json)$/.test(entry.name) ? [full] : [];
      });
    const outsiders = [...walk(path.join(ROOT, "app")), ...walk(path.join(ROOT, "modules")), ...walk(path.join(ROOT, "components")), ...walk(path.join(ROOT, "scripts"))]
      .filter((file) => !file.includes(`${path.sep}legacyReprojection${path.sep}`) && !file.endsWith("reprojectLegacyRelationships.ts"))
      .filter((file) => /legacyReprojection|reprojectLegacyRelationships/.test(readFileSync(file, "utf8")));
    expect(outsiders).toEqual([]);
    for (const file of ["instrumentation.ts", "next.config.ts", "middleware.ts"]) {
      try {
        expect(readFileSync(path.join(ROOT, file), "utf8"), file).not.toMatch(/reproject/i);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
  });

  it("its sources never import the application Prisma client, the adapter or dotenv/config, and the tool never inserts or edits a revision-scoped row", () => {
    for (const file of ["scripts/reprojectLegacyRelationships.ts", "modules/backfill/legacyReprojection/reprojectionPlan.ts", "modules/backfill/legacyReprojection/reprojectionDatabase.ts"]) {
      const text = readFileSync(path.join(ROOT, file), "utf8");
      const imports = text.split("\n").filter((line) => /^\s*import\b/.test(line)).join("\n");
      expect(imports, file).not.toMatch(/modules\/db\/client|@prisma\/client|@prisma\/adapter-pg|dotenv\/config/);
    }
    const db = readFileSync(path.join(ROOT, "modules/backfill/legacyReprojection/reprojectionDatabase.ts"), "utf8");
    expect(db).not.toMatch(/(insert into|update|delete from)\s+\$\{t\.revisionTable\}|(insert into|update|delete from)\s+recording_revision|(insert into|update|delete from)\s+recordings\b/i);
  });
});
