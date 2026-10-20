import {
  RELATIONSHIP_KINDS,
  planRevisionRelationshipBackfill,
  type BackfillInput,
  type BackfillPlan,
  type BackfillReport,
  type DetachEvidenceRow,
  EXECUTE_BLOCKING_ANOMALIES,
  type LegacyLinkRow,
  type PlannedInsert,
  type RelationshipKind,
  type RevisionLinkRow,
} from "./backfillPlan";
import type { Queryable } from "./backfillTarget";

// Phase 6J-11C — the database half of the relationship backfill: read what exists, hand it to the pure planner, and (only
// when asked) write the plan. It talks to Postgres through an injected `Queryable` (a connected `pg` client) — it never
// imports the application's Prisma client, so it cannot silently pick up DATABASE_URL.
//
//  - DRY RUN runs in a READ ONLY transaction: the database itself refuses any write, so "no writes" does not depend on this
//    code being bug-free.
//  - EXECUTE is ONE transaction: a global advisory lock (concurrent runs queue, never interleave), a bounded lock_timeout,
//    share-locks on every Recording row (a publish/fork/archive cannot move a pointer underneath it), the plan is computed
//    INSIDE the transaction after the locks are held, rows are inserted with ON CONFLICT DO NOTHING (the composite primary
//    keys make duplicates impossible even if something were to race), and a post-check re-plans and requires zero remaining
//    inserts before COMMIT. Any error rolls the whole thing back.
// Legacy rows are only ever READ.

/** Advisory-lock key serializing backfill runs. */
export const BACKFILL_LOCK_KEY = "revision-relationship-backfill";
const LOCK_TIMEOUT = "5s";
const BATCH = 1000;

export interface KindTables {
  legacyTable: string;
  legacyTargetColumn: string;
  revisionTable: string;
  revisionTargetColumn: string;
  detachAction: string;
  detachSnapshotKey: string;
}

export const TABLES: Record<RelationshipKind, KindTables> = {
  source: {
    legacyTable: "entity_sources",
    legacyTargetColumn: "sourceId",
    revisionTable: "recording_revision_sources",
    revisionTargetColumn: "sourceId",
    detachAction: "SOURCE_DETACHED_FROM_RECORDING_REVISION",
    detachSnapshotKey: "sourceId",
  },
  rights: {
    legacyTable: "entity_rights",
    legacyTargetColumn: "rightsInformationId",
    revisionTable: "recording_revision_rights",
    revisionTargetColumn: "rightsInformationId",
    detachAction: "RIGHTS_DETACHED_FROM_RECORDING_REVISION",
    detachSnapshotKey: "rightsInformationId",
  },
  occasion: {
    legacyTable: "entity_occasions",
    legacyTargetColumn: "occasionId",
    revisionTable: "recording_revision_occasions",
    revisionTargetColumn: "occasionId",
    detachAction: "OCCASION_DETACHED_FROM_RECORDING_REVISION",
    detachSnapshotKey: "occasionId",
  },
};

export async function loadBackfillInput(db: Queryable): Promise<BackfillInput> {
  const recordings = (
    await db.query<{ id: string; status: string; currentPublishedRevisionId: string | null; currentDraftRevisionId: string | null }>(
      'select id, status::text as status, "currentPublishedRevisionId", "currentDraftRevisionId" from recordings order by id'
    )
  ).rows;

  const pointerIds = [...new Set(recordings.flatMap((r) => [r.currentPublishedRevisionId, r.currentDraftRevisionId]).filter((id): id is string => id !== null))];
  const revisions =
    pointerIds.length === 0
      ? []
      : (await db.query<{ id: string; recordingId: string; revisionStatus: string; revisionNumber: number }>('select id, "recordingId", "revisionStatus"::text as "revisionStatus", "revisionNumber" from recording_revisions where id = any($1::text[])', [pointerIds])).rows;

  const legacy = {} as Record<RelationshipKind, LegacyLinkRow[]>;
  const existing = {} as Record<RelationshipKind, RevisionLinkRow[]>;
  const detached = {} as Record<RelationshipKind, DetachEvidenceRow[]>;
  for (const kind of RELATIONSHIP_KINDS) {
    const t = TABLES[kind];
    legacy[kind] = (
      await db.query<LegacyLinkRow>(`select id as "rowId", "entityId" as "recordingId", "${t.legacyTargetColumn}" as "targetId" from ${t.legacyTable} where "entityType" = 'RECORDING' order by id`)
    ).rows;
    existing[kind] = (await db.query<RevisionLinkRow>(`select "revisionId", "${t.revisionTargetColumn}" as "targetId" from ${t.revisionTable}`)).rows;
    const detachRows = (
      await db.query<{ revisionId: string; recordingId: string | null; revisionNumber: number | null; revisionStatus: string | null; beforeSnapshot: Record<string, unknown> | null }>(
        `select a."entityId" as "revisionId", r."recordingId" as "recordingId", r."revisionNumber" as "revisionNumber", r."revisionStatus"::text as "revisionStatus", a."beforeSnapshot" as "beforeSnapshot"
           from audit_log_entries a left join recording_revisions r on r.id = a."entityId"
          where a."entityType" = 'RecordingRevision' and a.action = $1`,
        [t.detachAction]
      )
    ).rows;
    detached[kind] = detachRows.flatMap((row) => {
      const targetId = row.beforeSnapshot?.[t.detachSnapshotKey];
      return typeof targetId === "string" ? [{ revisionId: row.revisionId, targetId, recordingId: row.recordingId, revisionNumber: row.revisionNumber, revisionStatus: row.revisionStatus }] : [];
    });
  }

  const unapprovedSourceIds = (await db.query<{ id: string }>(`select id from sources where "approvalState"::text <> 'APPROVED'`)).rows.map((r) => r.id);
  const archivedOccasionIds = (await db.query<{ id: string }>('select id from occasions where "archivedAt" is not null')).rows.map((r) => r.id);

  return { recordings, revisions, legacy, existing, detached, unapprovedSourceIds, archivedOccasionIds };
}

async function insertPlanned(db: Queryable, kind: RelationshipKind, inserts: readonly PlannedInsert[]): Promise<number> {
  const t = TABLES[kind];
  const rows = inserts.filter((insert) => insert.kind === kind);
  let inserted = 0;
  for (let offset = 0; offset < rows.length; offset += BATCH) {
    const chunk = rows.slice(offset, offset + BATCH);
    const result = await db.query(
      `insert into ${t.revisionTable} ("revisionId", "${t.revisionTargetColumn}") select * from unnest($1::text[], $2::text[]) on conflict do nothing`,
      [chunk.map((r) => r.revisionId), chunk.map((r) => r.targetId)]
    );
    inserted += result.rowCount ?? 0;
  }
  return inserted;
}

export interface BackfillRunResult {
  mode: "DRY RUN" | "EXECUTE";
  report: BackfillReport;
  /** EXECUTE only: rows actually inserted per kind, and the planned inserts that remained after the writes (must be 0). */
  inserted?: Record<RelationshipKind, number>;
  remainingAfterExecute?: number;
}

export async function runRevisionRelationshipBackfill(db: Queryable, options: { execute: boolean }): Promise<BackfillRunResult> {
  if (!options.execute) {
    await db.query("BEGIN READ ONLY");
    try {
      const plan = planRevisionRelationshipBackfill(await loadBackfillInput(db));
      return { mode: "DRY RUN", report: plan.report };
    } finally {
      await db.query("ROLLBACK").catch(() => undefined);
    }
  }

  await db.query("BEGIN");
  try {
    await db.query(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`);
    await db.query("select pg_advisory_xact_lock(hashtext($1))", [BACKFILL_LOCK_KEY]);
    await db.query("select id from recordings order by id for share");

    const plan: BackfillPlan = planRevisionRelationshipBackfill(await loadBackfillInput(db));
    const blocking = plan.report.anomalies.filter((a) => EXECUTE_BLOCKING_ANOMALIES.includes(a.code));
    if (blocking.length > 0) {
      throw new Error(
        `Refusing to execute: ${blocking.map((a) => `${a.code} x${a.count}`).join(", ")}. An editor detached a link from an older PUBLISHED revision and the same link is planned for a newer one; ` +
          "the script cannot tell whether the detach should carry forward. Review the dry-run report and have a person decide (docs/recording-publication-safety.md, section 12); nothing was written."
      );
    }
    const inserted = {} as Record<RelationshipKind, number>;
    for (const kind of RELATIONSHIP_KINDS) inserted[kind] = await insertPlanned(db, kind, plan.inserts);

    const after = planRevisionRelationshipBackfill(await loadBackfillInput(db));
    if (after.inserts.length !== 0) {
      throw new Error(`Post-check failed: ${after.inserts.length} planned insert(s) remain after the writes; rolling back.`);
    }
    await db.query("COMMIT");
    return { mode: "EXECUTE", report: plan.report, inserted, remainingAfterExecute: after.inserts.length };
  } catch (error) {
    await db.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}
