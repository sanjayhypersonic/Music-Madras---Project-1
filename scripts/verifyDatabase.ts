// Operator script (launch readiness): fingerprint a database for backup and recovery verification.
//
//   npm run ops:verify-database -- --out restore-point.json       measure the database and SAVE the fingerprint (do this when you create a restore point)
//   npm run ops:verify-database -- --compare restore-point.json   measure the database and COMPARE it with a saved fingerprint (do this on the restore-point branch or
//                                                                 clone, and again after any real restore). Differences are listed; exit 2 if any.
//   npm run ops:verify-database -- --compare restore-point.json --after-migration
//                                                                 the same comparison for a database that has just been MIGRATED: it may have more migrations (and the tables
//                                                                 they add) than the pre-change fingerprint, never fewer, and every table the old fingerprint counted must hold
//                                                                 the same number of rows; integrity must be clean.
//   npm run ops:verify-database                                   measure and judge the database on its own (migrations finished, lifecycle integrity clean)
//   add --json to print the fingerprint.
//
// READ-ONLY: one READ ONLY transaction of SELECT count(*) queries and nothing else. A fingerprint holds counts and migration names, never row data, so it is safe to file.
// Target: VERIFY_DATABASE_URL (any URL you can read from: the source, a restore-point branch, a restored database). It is not inferred from DATABASE_URL, never read from a
// .env file, and never printed; only host:port/database is.
// Exit codes: 0 verified, 2 differences or integrity problems, 4 refused / bad usage.
import { readFileSync, writeFileSync } from "fs";
import { Client } from "pg";
import { describeDatabaseTarget } from "../modules/ops/migrationPlan";
import { compareFingerprints, FINGERPRINT_TABLES, INTEGRITY_CHECKS, integrityProblems, isCheckApplicable, isFingerprint, type DatabaseFingerprint } from "../modules/ops/databaseFingerprint";

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function measure(url: string, target: string): Promise<DatabaseFingerprint> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("BEGIN READ ONLY");
    const migrationsTable = (await client.query("select to_regclass('public._prisma_migrations') as t")).rows[0]?.t;
    let applied = 0;
    const finishedNames = new Set<string>();
    let latest: string | null = null;
    let failed: string[] = [];
    if (migrationsTable) {
      const rows = (await client.query<{ migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }>("select migration_name, finished_at, rolled_back_at from _prisma_migrations order by migration_name")).rows;
      const finished = rows.filter((r) => r.finished_at !== null && r.rolled_back_at === null);
      applied = finished.length;
      for (const row of finished) finishedNames.add(row.migration_name);
      latest = finished.length ? finished[finished.length - 1].migration_name : null;
      failed = rows.filter((r) => r.finished_at === null && r.rolled_back_at === null).map((r) => r.migration_name);
    }
    const present = new Set((await client.query<{ table_name: string }>("select table_name from information_schema.tables where table_schema = 'public'")).rows.map((r) => r.table_name));
    const counts: Record<string, number> = {};
    for (const table of FINGERPRINT_TABLES) {
      if (!present.has(table)) continue; // a table the database does not have is reported as MISSING when compared, not guessed at
      counts[table] = Number((await client.query<{ n: string }>(`select count(*)::text as n from "${table}"`)).rows[0].n); // the name comes from the fixed list above
    }
    const integrity: Record<string, number | null> = {};
    for (const check of INTEGRITY_CHECKS) {
      if (!isCheckApplicable(check, finishedNames)) {
        integrity[check.name] = null; // the migration that introduces what this check reads has not been applied yet: not applicable, not a failure
        continue;
      }
      try {
        integrity[check.name] = Number((await client.query<{ n: number }>(check.sql)).rows[0].n);
      } catch {
        integrity[check.name] = -1; // the check could not run (a column or table missing): shown as a violation so it cannot pass silently
      }
    }
    await client.query("ROLLBACK");
    return { takenAt: new Date().toISOString(), target, migrations: { applied, latest, failed }, counts, integrity };
  } finally {
    await client.end();
  }
}

async function main(): Promise<number> {
  const url = process.env.VERIFY_DATABASE_URL?.trim();
  if (!url) {
    console.error("REFUSED: VERIFY_DATABASE_URL is not set (the database to fingerprint: the source, a restore-point branch, or a restored database).");
    return 4;
  }
  const target = describeDatabaseTarget(url);
  if (!target) {
    console.error("REFUSED: VERIFY_DATABASE_URL is not a valid postgresql:// connection string.");
    return 4;
  }
  const fingerprint = await measure(url, target);

  const out = flag("--out");
  if (out) {
    writeFileSync(out, JSON.stringify(fingerprint, null, 2), "utf8");
    console.log(`Fingerprint of ${target} saved to ${out} (${Object.keys(fingerprint.counts).length} tables, ${fingerprint.migrations.applied} migrations, latest ${fingerprint.migrations.latest ?? "none"}).`);
  }
  if (process.argv.includes("--json")) console.log(JSON.stringify(fingerprint, null, 2));

  const compare = flag("--compare");
  const differences = compare
    ? (() => {
        let saved: unknown;
        try {
          saved = JSON.parse(readFileSync(compare, "utf8"));
        } catch {
          throw new Error("UnreadableFingerprint");
        }
        if (!isFingerprint(saved)) throw new Error("NotAFingerprint");
        return compareFingerprints(saved, fingerprint, { afterMigration: process.argv.includes("--after-migration") });
      })()
    : integrityProblems(fingerprint);

  console.log(`Checked ${target}${compare ? ` against ${compare}` : ""}.`);
  for (const d of differences) console.log(`  ${d.kind.padEnd(13)} ${d.message}`);
  console.log(differences.length === 0 ? "RESULT: verified." : `RESULT: ${differences.length} difference(s) / problem(s). Do not treat this database as the expected state.`);
  return differences.length === 0 ? 0 : 2;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(`FAILED: ${err instanceof Error ? err.name : "unknown error"}`);
    process.exit(2);
  }
);
