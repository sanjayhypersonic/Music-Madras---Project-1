// Operator script (launch readiness): the guarded way to see, apply and roll-back-check database migrations for a deployment.
//
//   npm run migrate -- status                          READ-ONLY. Which migrations this code ships, which the database has, which are pending / failed / ahead,
//                                                      and for each pending one whether it is ADDITIVE (rollback = redeploy the previous code) or BLOCKING.
//   npm run migrate -- rollback-check --previous-ref <git-ref>
//                                                      READ-ONLY. If traffic returned to the previous release (a git tag or commit), would it work on THIS database?
//   npm run migrate -- apply --confirm-host <host:port/database> --restore-point "<label>" [--acknowledge-blocking]
//                                                      THE ONE IRREVERSIBLE STEP. Runs `prisma migrate deploy` against the target. Refuses unless every guard passes.
//   add --json to status / rollback-check for a machine-readable report.
//
// Target: MIGRATE_DATABASE_URL, the DIRECT (non-pooled) connection string of the database to inspect or change. It is never inferred from DATABASE_URL, never read from a
// .env file, and never printed (only host:port/database is). The prisma CLI it runs cannot read the repository's .env either.
//
// `apply` refuses (exit 4, nothing changed) unless: --confirm-host equals the target actually in use; --restore-point names the verified restore point; no earlier
// migration is failed/half-applied; the database is not ahead of this code; and no pending migration is BLOCKING unless --acknowledge-blocking is given.
// Nothing calls this script except an operator. Exit codes: 0 done / compatible, 2 failed or incompatible, 4 refused / configuration.
// Procedure: docs/runbooks/production-launch.md.

import { execFileSync, spawnSync } from "child_process";
import { existsSync, readFileSync, readdirSync } from "fs";
import os from "os";
import path from "path";
import { Client } from "pg";
import { assessPending, assessRollback, compareMigrations, decideApply, describeDatabaseTarget, type AppliedMigrationRow, type MigrationStatus } from "../modules/ops/migrationPlan";
import { summariseFindings } from "../modules/ops/migrationSafety";

const EXIT = { OK: 0, FAILED: 2, REFUSED: 4 } as const;
const ROOT = path.resolve(__dirname, "..");
const MIGRATIONS = path.join(ROOT, "prisma", "migrations");

function refuse(reason: string): never {
  console.error(`REFUSED: ${reason}`);
  process.exit(EXIT.REFUSED);
}

const shipped = (): string[] => readdirSync(MIGRATIONS).filter((n) => /^\d{14}_/.test(n) && existsSync(path.join(MIGRATIONS, n, "migration.sql"))).sort();
const sqlOf = (name: string): string | undefined => {
  const file = path.join(MIGRATIONS, name, "migration.sql");
  return existsSync(file) ? readFileSync(file, "utf8") : undefined;
};

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

async function readRows(url: string): Promise<AppliedMigrationRow[]> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("BEGIN READ ONLY"); // this script's reads cannot write
    const exists = await client.query("select to_regclass('public._prisma_migrations') as t");
    if (!exists.rows[0]?.t) return [];
    const result = await client.query<{ migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }>("select migration_name, finished_at, rolled_back_at from _prisma_migrations");
    await client.query("ROLLBACK");
    return result.rows.map((r) => ({ name: r.migration_name, finishedAt: r.finished_at, rolledBackAt: r.rolled_back_at }));
  } finally {
    await client.end();
  }
}

function sqlMap(names: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const n of names) {
    const sql = sqlOf(n);
    if (sql !== undefined) out[n] = sql;
  }
  return out;
}

function printStatus(target: string, status: MigrationStatus, json: boolean): ReturnType<typeof assessPending> {
  const assessments = assessPending(status.pending, sqlMap(status.pending));
  if (json) {
    console.log(JSON.stringify({ target, applied: status.applied.length, pending: assessments.map((a) => ({ name: a.name, additiveOnly: a.additiveOnly, ...summariseFindings(a.findings) })), failed: status.failed, ahead: status.unknownApplied }, null, 2));
    return assessments;
  }
  console.log(`Target: ${target}`);
  console.log(`Shipped by this code: ${shipped().length}   applied: ${status.applied.length}   pending: ${status.pending.length}   failed: ${status.failed.length}   database ahead of this code: ${status.unknownApplied.length}`);
  if (status.failed.length) console.log(`FAILED / half-applied: ${status.failed.join(", ")}  -> resolve by hand before anything else`);
  if (status.unknownApplied.length) console.log(`Database ahead of this code: ${status.unknownApplied.join(", ")}  -> wrong code for this database, or a newer release ran`);
  for (const a of assessments) {
    const s = summariseFindings(a.findings);
    console.log(`  pending ${a.name}: ${a.additiveOnly ? "ADDITIVE (backward-compatible)" : "BLOCKING (cannot be undone by redeploying the previous code)"}${s.review ? `, ${s.review} to review` : ""}`);
    for (const f of a.findings) console.log(`      ${f.severity.padEnd(8)} ${f.reason} :: ${f.statement}`);
  }
  return assessments;
}

async function main(): Promise<number> {
  const [command, ...args] = process.argv.slice(2);
  if (!command || !["status", "apply", "rollback-check"].includes(command)) refuse("usage: migrate <status | apply | rollback-check> (see the header of scripts/migrate.ts)");

  const url = process.env.MIGRATE_DATABASE_URL?.trim();
  if (!url) refuse("MIGRATE_DATABASE_URL is not set. It must hold the DIRECT (non-pooled) connection string of the database to inspect or change.");
  const target = describeDatabaseTarget(url);
  if (!target) refuse("MIGRATE_DATABASE_URL is not a valid postgresql:// connection string.");
  const json = args.includes("--json");

  const rows = await readRows(url);
  const status = compareMigrations(shipped(), rows);

  if (command === "status") {
    printStatus(target, status, json);
    return status.failed.length > 0 || status.unknownApplied.length > 0 ? EXIT.FAILED : EXIT.OK;
  }

  if (command === "rollback-check") {
    const ref = flag(args, "--previous-ref");
    if (!ref) refuse("rollback-check needs --previous-ref <git tag or commit> naming the release traffic would return to.");
    let previous: string[];
    try {
      previous = execFileSync("git", ["ls-tree", "-r", "--name-only", ref, "--", "prisma/migrations"], { cwd: ROOT, encoding: "utf8" })
        .split("\n")
        .map((l) => /^prisma\/migrations\/(\d{14}_[^/]+)\/migration\.sql$/.exec(l.trim())?.[1])
        .filter((n): n is string => Boolean(n));
    } catch {
      refuse(`git could not read ${ref}. Check the tag or commit exists in this clone.`);
    }
    const finished = rows.filter((r) => r.finishedAt !== null && r.rolledBackAt === null).map((r) => r.name);
    const report = assessRollback({ previousShipped: previous, databaseFinished: finished, sqlByName: sqlMap(finished) });
    if (json) console.log(JSON.stringify({ target, previousRef: ref, compatible: report.compatible, extraForPrevious: report.extraForPrevious.map((a) => ({ name: a.name, additiveOnly: a.additiveOnly })), missingForPrevious: report.missingForPrevious, reasons: report.reasons }, null, 2));
    else {
      console.log(`Target: ${target}   previous release: ${ref} (${previous.length} migrations)`);
      console.log(`Migrations the previous release does not know: ${report.extraForPrevious.length}`);
      for (const a of report.extraForPrevious) console.log(`  ${a.name}: ${a.additiveOnly ? "additive, the previous release can run on it" : "NOT backward-compatible"}`);
      console.log(report.compatible ? "RESULT: returning traffic to the previous release is safe for the schema." : `RESULT: NOT safe.\n  - ${report.reasons.join("\n  - ")}`);
    }
    return report.compatible ? EXIT.OK : EXIT.FAILED;
  }

  // apply
  const assessments = printStatus(target, status, false);
  const decision = decideApply({
    status,
    assessments,
    actualTarget: target,
    confirmedTarget: flag(args, "--confirm-host"),
    restorePoint: flag(args, "--restore-point"),
    acknowledgeBlocking: args.includes("--acknowledge-blocking"),
  });
  for (const note of decision.notes) console.log(`NOTE: ${note}`);
  if (!decision.allowed) refuse(decision.refusals.join("\n         "));
  if (status.pending.length === 0) return EXIT.OK;

  console.log(`Applying ${status.pending.length} migration(s) to ${target} (restore point: ${flag(args, "--restore-point")}) ...`);
  const prismaCli = path.join(ROOT, "node_modules", "prisma", "build", "index.js");
  const emptyDotenv = path.join(os.tmpdir(), "music-madras-no-dotenv", ".env");
  const result = spawnSync(process.execPath, [prismaCli, "migrate", "deploy"], {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url, DOTENV_CONFIG_PATH: emptyDotenv, DOTENV_CONFIG_QUIET: "true" },
  });
  const after = compareMigrations(shipped(), await readRows(url));
  console.log(`After: applied ${after.applied.length}, pending ${after.pending.length}, failed ${after.failed.length}.`);
  if ((result.status ?? 1) !== 0 || after.pending.length > 0 || after.failed.length > 0) {
    console.error("FAILED: the database is not fully migrated. Do not cut traffic over. Restore from the restore point if the state cannot be repaired.");
    return EXIT.FAILED;
  }
  console.log("Done. Next: verify readiness (GET /api/ready on the new deployment) before it receives traffic.");
  return EXIT.OK;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(`FAILED: ${err instanceof Error ? err.name : "unknown error"}`); // never the message: it could carry a host or credential
    process.exit(EXIT.FAILED);
  }
);
