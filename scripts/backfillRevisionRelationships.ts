// Operator script (Phase 6J-11C): project the legacy Recording-level Source / Rights / Occasion links into the
// revision-scoped tables added in 6J-11B.
//
//   npm run backfill:revision-relationships                 DRY RUN: reads, plans, reports. Writes NOTHING (the database
//                                                           transaction is READ ONLY, so it cannot).
//   npm run backfill:revision-relationships -- --execute    performs the inserts in ONE transaction (all or nothing).
//   add --json for a machine-readable report.
//
// It is NOT wired into deployment, application startup, the YouTube sync or any Studio workflow; nothing calls it
// except an operator. It never reads DATABASE_URL / DIRECT_URL as a target and never loads a .env file into the
// environment: the target is BACKFILL_DATABASE_URL, acknowledged by BACKFILL_TARGET_CONFIRM=host:port/database, and in
// this phase it must be the local, marked, isolated integration-test database or the script refuses (exit 4).
// Exit codes: 0 done, 2 failed (rolled back), 4 refused / configuration. See docs/recording-publication-safety.md.

import { readdirSync, readFileSync } from "fs";
import path from "path";
import { parse } from "dotenv";
import { Client } from "pg";
import { runRevisionRelationshipBackfill } from "../modules/backfill/revisionRelationships/backfillDatabase";
import { formatBackfillReport } from "../modules/backfill/revisionRelationships/backfillPlan";
import { readConfiguredRealDatabaseUrls } from "../modules/backfill/revisionRelationships/backfillRealDatabases";
import {
  describeClientDestination,
  describeTarget,
  resolveBackfillTarget,
  verifyBackfillTargetDatabase,
} from "../modules/backfill/revisionRelationships/backfillTarget";

const EXIT = { OK: 0, FAILED: 2, REFUSED: 4 } as const;

// The repository root comes from this file's own location, not from the shell's working directory, so the comparison with
// the real database's env files does not depend on where the operator happened to run the command.
const REPO_ROOT = path.resolve(__dirname, "..");

function refuse(reason: string): never {
  console.error(`REFUSED: ${reason}`);
  process.exit(EXIT.REFUSED);
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const known = new Set(["--execute", "--json", "--help"]);
  const unknown = args.filter((arg) => !known.has(arg));
  if (unknown.length > 0) refuse(`unknown argument(s): ${unknown.join(" ")}. Use --execute, --json or --help.`);
  if (args.includes("--help")) {
    console.log("Usage: backfill:revision-relationships [--execute] [--json]\nDry run by default. Needs BACKFILL_DATABASE_URL and BACKFILL_TARGET_CONFIRM; see docs/recording-publication-safety.md.");
    return EXIT.OK;
  }
  const execute = args.includes("--execute");
  const json = args.includes("--json");

  const real = readConfiguredRealDatabaseUrls(
    REPO_ROOT,
    process.env,
    { readdir: (directory) => readdirSync(directory), readFile: (file) => readFileSync(file, "utf8") },
    parse,
    path.join
  );
  if (!real.ok) refuse(real.reason);

  const target = resolveBackfillTarget({ env: process.env, realUrls: real.urls });
  if (!target.ok) refuse(target.reason);
  const targetName = describeTarget(target);

  // The driver is given the validated fields — never the raw URL, so no query parameter or PG* variable can move it —
  // and the destination it will use must equal the one that was validated and acknowledged, or nothing connects.
  const clientDestination = describeClientDestination(target.clientConfig);
  if (clientDestination.toLowerCase() !== targetName) refuse(`internal check failed: the connection destination ${clientDestination} differs from the validated target ${targetName}.`);
  if (!json) console.log(`Target: ${targetName} (explicitly configured, loopback)`);

  const client = new Client(target.clientConfig);
  try {
    await client.connect();
  } catch (error) {
    refuse(`cannot connect to ${targetName} (${error instanceof Error ? error.message : "unknown error"}).`);
  }

  try {
    const verification = await verifyBackfillTargetDatabase(client);
    if (!verification.ok) {
      for (const problem of verification.problems) console.error(`PROBLEM: ${problem}`);
      refuse(`${targetName} cannot be positively identified as the isolated test database.`);
    }

    const result = await runRevisionRelationshipBackfill(client, { execute });
    if (json) console.log(JSON.stringify({ target: targetName, ...result }, null, 2));
    else {
      console.log(formatBackfillReport(result.report, result.mode, result.inserted));
      if (result.mode === "DRY RUN") console.log("\nDry run only: nothing was written. Re-run with --execute to apply.");
      else console.log(`\nExecuted in one transaction. Planned inserts remaining after the writes: ${result.remainingAfterExecute}.`);
    }
    return EXIT.OK;
  } catch (error) {
    console.error(`FAILED (the transaction was rolled back, nothing was written): ${error instanceof Error ? error.message : String(error)}`);
    return EXIT.FAILED;
  } finally {
    await client.end().catch(() => undefined);
  }
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(`FAILED: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(EXIT.FAILED);
  }
);
