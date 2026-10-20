import { TABLES } from "../revisionRelationships/backfillDatabase";
import type { Queryable } from "../revisionRelationships/backfillTarget";
import {
  RELATIONSHIP_KINDS,
  planLegacyReprojection,
  type DetachProof,
  type LegacyRow,
  type ReprojectionPlan,
  type ReprojectionRecording,
  type ReprojectionRevision,
  type RelationshipKind,
  type RevisionLink,
  type ReprojectionInput,
} from "./reprojectionPlan";

// Phase 6J-12B — the database half of the revision-to-legacy re-projection (the ROLLBACK direction of the 6J-11C backfill).
// Same shape as the backfill: an injected `Queryable` (a connected `pg` client); never the application's Prisma client, so it cannot
// pick up DATABASE_URL. See reprojectionPlan.ts for the projection contract.
//
//  - DRY RUN: one READ ONLY transaction (the database itself refuses a write). Reports the plan and its fingerprint.
//  - EXECUTE: ONE transaction. A bounded lock_timeout; the backfill's global advisory lock and this tool's own (so the two operator
//    tools can never interleave, and two re-projections queue); a share lock on every Recording row (a publish / fork / archive cannot
//    move a pointer underneath it); SHARE ROW EXCLUSIVE on the three legacy tables (no legacy writer can add or remove a row between
//    planning and applying; readers are not blocked). The plan is computed INSIDE the transaction, and it must have the fingerprint of
//    the plan the operator reviewed; blocking conflicts refuse the run. Then: delete the proven removals, insert the missing links,
//    write ONE audit entry holding every removed row (to restore) and every inserted row id (to undo), and re-plan: nothing may remain.
//    Any error rolls everything back, so a failure can never leave a half-applied state.
//  - A refused or failed execution leaves an audit entry of its own (written after the rollback, best-effort).
// Revision-scoped rows and every Source / Rights / Occasion record are only ever READ.

export const REPROJECTION_LOCK_KEY = "legacy-relationship-reprojection";
const BACKFILL_LOCK_KEY = "revision-relationship-backfill"; // the backfill's key: held too, so the tools exclude each other
const LOCK_TIMEOUT = "5s";
const BATCH = 1000;

export class ReprojectionBlockedError extends Error {
  constructor(readonly codes: string[]) {
    super(
      `Refusing to execute: ${codes.join(", ")}. A person must decide each conflict (a legacy link the revision set does not explain, or an unsafe revision pointer); ` +
        "the tool never deletes or guesses on its own. Nothing was written (docs/recording-publication-safety.md, section 14)."
    );
    this.name = "ReprojectionBlockedError";
  }
}

export class ReprojectionPlanChangedError extends Error {
  constructor() {
    super("Refusing to execute: the plan computed now differs from the plan whose fingerprint was supplied (the data changed since the dry run, or the fingerprint is wrong). Re-run the dry run, review it, and use its fingerprint. Nothing was written.");
    this.name = "ReprojectionPlanChangedError";
  }
}

export async function loadReprojectionInput(db: Queryable): Promise<ReprojectionInput> {
  const recordings = (
    await db.query<ReprojectionRecording>(
      'select id, status::text as status, "currentPublishedRevisionId", "currentDraftRevisionId" from recordings order by id'
    )
  ).rows;
  const pointerIds = [...new Set(recordings.flatMap((r) => [r.currentPublishedRevisionId, r.currentDraftRevisionId]).filter((id): id is string => id !== null))];
  const revisions =
    pointerIds.length === 0
      ? []
      : (await db.query<ReprojectionRevision>('select id, "recordingId", "revisionStatus"::text as "revisionStatus" from recording_revisions where id = any($1::text[])', [pointerIds])).rows;

  const revisionLinks = {} as Record<RelationshipKind, RevisionLink[]>;
  const legacy = {} as Record<RelationshipKind, LegacyRow[]>;
  const detached = {} as Record<RelationshipKind, DetachProof[]>;
  for (const kind of RELATIONSHIP_KINDS) {
    const t = TABLES[kind];
    revisionLinks[kind] =
      pointerIds.length === 0
        ? []
        : (await db.query<RevisionLink>(`select "revisionId", "${t.revisionTargetColumn}" as "targetId" from ${t.revisionTable} where "revisionId" = any($1::text[])`, [pointerIds])).rows;
    legacy[kind] = (
      await db.query<LegacyRow>(`select id as "rowId", "entityId" as "recordingId", "${t.legacyTargetColumn}" as "targetId" from ${t.legacyTable} where "entityType" = 'RECORDING' order by id`)
    ).rows;
    const rows = (
      await db.query<{ revisionId: string; recordingId: string | null; revisionStatus: string | null; beforeSnapshot: Record<string, unknown> | null }>(
        `select a."entityId" as "revisionId", r."recordingId" as "recordingId", r."revisionStatus"::text as "revisionStatus", a."beforeSnapshot" as "beforeSnapshot"
           from audit_log_entries a left join recording_revisions r on r.id = a."entityId"
          where a."entityType" = 'RecordingRevision' and a.action = $1`,
        [t.detachAction]
      )
    ).rows;
    detached[kind] = rows.flatMap((row) => {
      const targetId = row.beforeSnapshot?.[t.detachSnapshotKey];
      return typeof targetId === "string" ? [{ revisionId: row.revisionId, targetId, recordingId: row.recordingId, revisionStatus: row.revisionStatus }] : [];
    });
  }

  const unapprovedSourceIds = (await db.query<{ id: string }>(`select id from sources where "approvalState"::text <> 'APPROVED'`)).rows.map((r) => r.id);
  const archivedOccasionIds = (await db.query<{ id: string }>('select id from occasions where "archivedAt" is not null')).rows.map((r) => r.id);
  return { recordings, revisions, revisionLinks, legacy, detached, unapprovedSourceIds, archivedOccasionIds };
}

export interface ReprojectionRunResult {
  mode: "DRY RUN" | "EXECUTE";
  plan: ReprojectionPlan;
  /** EXECUTE only. */
  runId?: string;
  inserted?: Record<RelationshipKind, number>;
  deleted?: Record<RelationshipKind, number>;
}

export type ReprojectionOptions = { execute: false } | { execute: true; expectedFingerprint: string };

async function recordFailure(db: Queryable, reason: string, fingerprint: string | null): Promise<void> {
  try {
    await db.query(
      `insert into audit_log_entries (id, "actorId", action, "entityType", "entityId", "afterSnapshot")
       values (gen_random_uuid()::text, null, 'LEGACY_RELATIONSHIPS_REPROJECTION_FAILED', 'LegacyReprojection', gen_random_uuid()::text, $1::jsonb)`,
      [JSON.stringify({ reason, fingerprint })]
    );
  } catch {
    /* best effort: the run already failed and rolled back */
  }
}

export async function runLegacyReprojection(db: Queryable, options: ReprojectionOptions): Promise<ReprojectionRunResult> {
  if (!options.execute) {
    await db.query("BEGIN READ ONLY");
    try {
      return { mode: "DRY RUN", plan: planLegacyReprojection(await loadReprojectionInput(db)) };
    } finally {
      await db.query("ROLLBACK").catch(() => undefined);
    }
  }

  let seenFingerprint: string | null = null;
  await db.query("BEGIN");
  try {
    await db.query(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`);
    await db.query("select pg_advisory_xact_lock(hashtext($1))", [BACKFILL_LOCK_KEY]);
    await db.query("select pg_advisory_xact_lock(hashtext($1))", [REPROJECTION_LOCK_KEY]);
    await db.query("select id from recordings order by id for share");
    await db.query("LOCK TABLE entity_sources, entity_rights, entity_occasions IN SHARE ROW EXCLUSIVE MODE");

    const plan = planLegacyReprojection(await loadReprojectionInput(db));
    seenFingerprint = plan.fingerprint;
    if (plan.blocking.length > 0) throw new ReprojectionBlockedError(plan.blocking.map((a) => `${a.code} x${a.count}`));
    if (plan.fingerprint !== options.expectedFingerprint) throw new ReprojectionPlanChangedError();

    const deleted = {} as Record<RelationshipKind, number>;
    const inserted = {} as Record<RelationshipKind, number>;
    const insertedRows: { kind: RelationshipKind; id: string; recordingId: string; targetId: string }[] = [];
    for (const kind of RELATIONSHIP_KINDS) {
      const t = TABLES[kind];
      const removals = plan.removals.filter((r) => r.kind === kind);
      deleted[kind] = 0;
      for (let offset = 0; offset < removals.length; offset += BATCH) {
        const chunk = removals.slice(offset, offset + BATCH);
        const result = await db.query(`delete from ${t.legacyTable} where "entityType" = 'RECORDING' and id = any($1::text[])`, [chunk.map((r) => r.rowId)]);
        deleted[kind] += result.rowCount ?? 0;
      }
      if (deleted[kind] !== removals.length) throw new Error(`Deleted ${deleted[kind]} ${kind} row(s) but the plan has ${removals.length}; rolling back.`);

      const adds = plan.inserts.filter((i) => i.kind === kind);
      inserted[kind] = 0;
      for (let offset = 0; offset < adds.length; offset += BATCH) {
        const chunk = adds.slice(offset, offset + BATCH);
        const result = await db.query<{ id: string; recordingId: string; targetId: string }>(
          `insert into ${t.legacyTable} (id, "entityType", "entityId", "${t.legacyTargetColumn}")
           select gen_random_uuid()::text, 'RECORDING', u.r, u.t from unnest($1::text[], $2::text[]) as u(r, t)
           returning id, "entityId" as "recordingId", "${t.legacyTargetColumn}" as "targetId"`,
          [chunk.map((i) => i.recordingId), chunk.map((i) => i.targetId)]
        );
        inserted[kind] += result.rowCount ?? 0;
        for (const row of result.rows) insertedRows.push({ kind, ...row });
      }
      if (inserted[kind] !== adds.length) throw new Error(`Inserted ${inserted[kind]} ${kind} row(s) but the plan has ${adds.length}; rolling back.`);
    }

    const runId = (await db.query<{ id: string }>("select gen_random_uuid()::text as id")).rows[0].id;
    await db.query(
      `insert into audit_log_entries (id, "actorId", action, "entityType", "entityId", "beforeSnapshot", "afterSnapshot")
       values (gen_random_uuid()::text, null, 'LEGACY_RELATIONSHIPS_REPROJECTED', 'LegacyReprojection', $1, $2::jsonb, $3::jsonb)`,
      [runId, JSON.stringify({ removedRows: plan.removals }), JSON.stringify({ fingerprint: plan.fingerprint, insertedRows, counts: { inserted, deleted } })]
    );

    const after = planLegacyReprojection(await loadReprojectionInput(db));
    if (after.inserts.length !== 0 || after.removals.length !== 0) {
      throw new Error(`Post-check failed: ${after.inserts.length} insert(s) and ${after.removals.length} removal(s) remain after the writes; rolling back.`);
    }
    await db.query("COMMIT");
    return { mode: "EXECUTE", plan, runId, inserted, deleted };
  } catch (error) {
    await db.query("ROLLBACK").catch(() => undefined);
    await recordFailure(db, error instanceof Error ? error.name : "Error", seenFingerprint);
    throw error;
  }
}