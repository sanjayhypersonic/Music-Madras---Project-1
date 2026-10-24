import { classifyMigrationSql, isAdditiveOnly, summariseFindings, type MigrationFinding } from "./migrationSafety";

// Migration planning for a deployment (launch readiness; ADR deployment gate §1, §4, §5). PURE: it compares what the code ships with what a database has applied,
// and decides what an operator may do. The script (scripts/migrate.ts) supplies the facts and performs the one irreversible step; every decision lives here so it
// is tested without a database.

export interface AppliedMigrationRow {
  name: string;
  finishedAt: Date | null;
  rolledBackAt: Date | null;
}

export interface MigrationStatus {
  /** Applied and finished, and shipped by this code. */
  applied: string[];
  /** Shipped by this code but not applied (never run, or rolled back). */
  pending: string[];
  /** Started but neither finished nor rolled back: a failed or interrupted migration. Nothing may be applied until a person resolves it. */
  failed: string[];
  /** Applied to the database but NOT shipped by this code: the database is AHEAD of this release (a newer release ran, or this is the wrong code). */
  unknownApplied: string[];
}

export function compareMigrations(shipped: readonly string[], rows: readonly AppliedMigrationRow[]): MigrationStatus {
  const finished = new Set(rows.filter((r) => r.finishedAt !== null && r.rolledBackAt === null).map((r) => r.name));
  const failed = rows.filter((r) => r.finishedAt === null && r.rolledBackAt === null).map((r) => r.name);
  const shippedSet = new Set(shipped);
  return {
    applied: shipped.filter((n) => finished.has(n)),
    pending: shipped.filter((n) => !finished.has(n) && !failed.includes(n)),
    failed: [...new Set(failed)].sort(),
    unknownApplied: [...finished].filter((n) => !shippedSet.has(n)).sort(),
  };
}

export interface PendingAssessment {
  name: string;
  findings: MigrationFinding[];
  additiveOnly: boolean;
}

export function assessPending(pending: readonly string[], sqlByName: Readonly<Record<string, string>>): PendingAssessment[] {
  return pending.map((name) => {
    const sql = sqlByName[name];
    // A migration whose SQL we cannot read cannot be vouched for: it is treated as blocking, never as additive by default.
    const findings: MigrationFinding[] = sql === undefined ? [{ severity: "BLOCKING", reason: "its SQL is not available in this checkout, so it cannot be assessed", statement: name }] : classifyMigrationSql(sql);
    return { name, findings, additiveOnly: isAdditiveOnly(findings) };
  });
}

export interface ApplyRequest {
  status: MigrationStatus;
  assessments: readonly PendingAssessment[];
  /** `host:port/database` of the connection actually in use (derived from the URL, never typed). */
  actualTarget: string;
  /** What the operator typed after --confirm-host. */
  confirmedTarget: string | undefined;
  /** The label of the restore point the operator made and verified. */
  restorePoint: string | undefined;
  /** The operator accepts migrations that cannot be rolled back by redeploying the old code. */
  acknowledgeBlocking: boolean;
}

export interface ApplyDecision {
  allowed: boolean;
  /** Why not (empty when allowed). Each is something the operator can fix. */
  refusals: string[];
  /** What the operator should be told before the irreversible step. */
  notes: string[];
}

export function decideApply(request: ApplyRequest): ApplyDecision {
  const refusals: string[] = [];
  const notes: string[] = [];
  const { status } = request;

  if (!request.confirmedTarget) refusals.push(`Pass --confirm-host ${request.actualTarget} to confirm this is the database you mean to change.`);
  else if (request.confirmedTarget !== request.actualTarget) refusals.push("--confirm-host does not match the database in MIGRATE_DATABASE_URL. Nothing was changed.");

  if (!request.restorePoint || request.restorePoint.trim().length < 3) {
    refusals.push('Pass --restore-point "<label>" naming the restore point you created and verified before this change (deployment-readiness-gate.md §1). Migrations are forward-only: the rollback for a bad one is that restore point.');
  }

  if (status.failed.length > 0) refusals.push(`A previous migration did not finish (${status.failed.join(", ")}). Resolve it by hand (prisma migrate resolve) before applying anything.`);
  if (status.unknownApplied.length > 0) refusals.push(`The database has migrations this code does not ship (${status.unknownApplied.join(", ")}): it is ahead of this release, or this is the wrong code. Nothing was changed.`);

  const blocking = request.assessments.filter((a) => !a.additiveOnly);
  if (blocking.length > 0 && !request.acknowledgeBlocking) {
    refusals.push(
      `These pending migrations cannot be undone by redeploying the previous code (${blocking.map((b) => `${b.name}: ${summariseFindings(b.findings).blocking} blocking`).join("; ")}). Re-run with --acknowledge-blocking only if the owner has accepted a restore-point rollback.`
    );
  }
  if (blocking.length > 0 && request.acknowledgeBlocking) notes.push("Blocking migrations acknowledged: the rollback for this release is the restore point, not the previous deployment.");

  for (const a of request.assessments) {
    const { review } = summariseFindings(a.findings);
    if (review > 0) notes.push(`${a.name}: ${review} statement(s) to rehearse against a clone of the real data (they can fail or reject writes on existing rows).`);
  }
  if (status.pending.length === 0 && refusals.length === 0) notes.push("Nothing is pending: the database already has every migration this release ships.");

  return { allowed: refusals.length === 0, refusals, notes };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Rollback compatibility: "if I return traffic to the PREVIOUS release, will it work on this database?"
// ---------------------------------------------------------------------------------------------------------------------------------

export interface RollbackReport {
  /** True when the previous release can run on the database as it is now. */
  compatible: boolean;
  /** Applied to the database but unknown to the previous release: what it would have to tolerate. */
  extraForPrevious: PendingAssessment[];
  /** Shipped by the previous release but missing from the database (it was restored from older state): the previous release would need them. */
  missingForPrevious: string[];
  reasons: string[];
}

export function assessRollback(input: { previousShipped: readonly string[]; databaseFinished: readonly string[]; sqlByName: Readonly<Record<string, string>> }): RollbackReport {
  const previous = new Set(input.previousShipped);
  const db = new Set(input.databaseFinished);
  const extra = input.databaseFinished.filter((n) => !previous.has(n)).sort();
  const missing = input.previousShipped.filter((n) => !db.has(n));
  const extraForPrevious = assessPending(extra, input.sqlByName);
  const reasons: string[] = [];
  for (const a of extraForPrevious) if (!a.additiveOnly) reasons.push(`${a.name} is not backward-compatible (${summariseFindings(a.findings).blocking} blocking statement(s)): the previous release cannot be trusted on this schema; restore from the restore point instead.`);
  if (missing.length > 0) reasons.push(`The previous release expects migrations the database does not have (${missing.join(", ")}).`);
  return { compatible: reasons.length === 0, extraForPrevious, missingForPrevious: missing, reasons };
}

/** `host:port/database`, never credentials. */
export function describeDatabaseTarget(connectionString: string): string | null {
  try {
    const u = new URL(connectionString);
    const database = decodeURIComponent(u.pathname.replace(/^\//, ""));
    if (!u.hostname || !database) return null;
    return `${u.hostname}:${u.port || "5432"}/${database}`;
  } catch {
    return null;
  }
}
