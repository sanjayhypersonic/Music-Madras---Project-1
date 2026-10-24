import { compareMigrations, type AppliedMigrationRow } from "./migrationPlan";

// READINESS (launch readiness; ADR deployment gate §3 and §4). /api/health is liveness only; this answers the question a host's readiness probe and a rollout actually
// need: "can this deployment serve real traffic?", meaning the database answers AND it has every migration this release was built for. PURE decision; the route
// supplies the facts. Reasons are CODES (logged, never returned to the public caller, never containing a value).

export type NotReadyCode = "DATABASE_UNREACHABLE" | "MIGRATIONS_UNREADABLE" | "MIGRATION_FAILED" | "MIGRATIONS_PENDING";

export type ReadinessResult = { ready: true } | { ready: false; code: NotReadyCode; detail: string[] };

export type ReadinessFacts =
  | { databaseReachable: false }
  | { databaseReachable: true; migrationRows: readonly AppliedMigrationRow[] | null };

/**
 * A database that is AHEAD of this release (it has migrations the code does not list) is READY: that is the normal state after a rollback to the previous
 * release, which the deployment procedure only allows when the newer migrations are backward-compatible (scripts/migrate.ts rollback-check).
 */
export function assessReadiness(expected: readonly string[], facts: ReadinessFacts): ReadinessResult {
  if (!facts.databaseReachable) return { ready: false, code: "DATABASE_UNREACHABLE", detail: [] };
  if (facts.migrationRows === null) return { ready: false, code: "MIGRATIONS_UNREADABLE", detail: [] };
  const status = compareMigrations(expected, facts.migrationRows);
  if (status.failed.length > 0) return { ready: false, code: "MIGRATION_FAILED", detail: status.failed };
  if (status.pending.length > 0) return { ready: false, code: "MIGRATIONS_PENDING", detail: status.pending };
  return { ready: true };
}

/** The structured log line a log drain or alert rule can match. Codes and migration names only. */
export function readinessLogLine(result: ReadinessResult): string {
  return JSON.stringify({ level: result.ready ? "info" : "error", event: "readiness", ready: result.ready, ...(result.ready ? {} : { code: result.code, detail: result.detail.slice(0, 10) }) });
}
