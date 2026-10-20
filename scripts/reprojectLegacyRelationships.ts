// Operator script (Phase 6J-12B): ROLL BACK the relationship cutover by re-projecting the revision-scoped Source / Rights / Occasion
// relationships into the legacy Recording-level tables (entity_sources / entity_rights / entity_occasions). It is the reverse direction
// of backfill:revision-relationships and is NOT its inverse: it deletes a legacy link only when the audit trail proves an editor removed
// it from published history, and otherwise reports a conflict and refuses to run. The contract is in
// modules/backfill/legacyReprojection/reprojectionPlan.ts and docs/recording-publication-safety.md (section 14).
//
//   npm run reproject:legacy-relationships                              DRY RUN: reads, plans, reports with a plan fingerprint. Writes NOTHING
//                                                                       (a READ ONLY transaction, so it cannot).
//   npm run reproject:legacy-relationships -- --execute --plan-fingerprint=<64 hex>
//                                                                       applies exactly the plan with that fingerprint, in ONE transaction.
//   add --json for a machine-readable report (the full plan is included).
//
// Preparing this capability is not approving a cutover or a rollback. It is NOT wired into deployment, startup, the YouTube sync or any
// Studio workflow. Its target is REPROJECT_DATABASE_URL acknowledged by REPROJECT_TARGET_CONFIRM=host:port/database, under the same
// rules as the backfill: in this phase only the local, marked, isolated integration-test database is accepted; anything else is refused
// (exit 4). The driver is given validated fields, never the raw URL. Exit codes: 0 done, 2 failed (rolled back), 4 refused / configuration.

import { readdirSync, readFileSync } from "fs";
import path from "path";
import { parse } from "dotenv";
import { Client } from "pg";
import { formatReprojectionReport } from "../modules/backfill/legacyReprojection/reprojectionPlan";
import { runLegacyReprojection } from "../modules/backfill/legacyReprojection/reprojectionDatabase";
import { readConfiguredRealDatabaseUrls } from "../modules/backfill/revisionRelationships/backfillRealDatabases";
import {
  describeClientDestination,
  describeTarget,
  resolveLoopbackTestTarget,
  verifyBackfillTargetDatabase,
} from "../modules/backfill/revisionRelationships/backfillTarget";

const EXIT = { OK: 0, FAILED: 2, REFUSED: 4 } as const;
const REPO_ROOT = path.resolve(__dirname, "..");
const NAMES = { url: "REPROJECT_DATABASE_URL", confirm: "REPROJECT_TARGET_CONFIRM", noun: "re-projection" } as const;

function refuse(reason: string): never {
  console.error(`REFUSED: ${reason}`);
  process.exit(EXIT.REFUSED);
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const fingerprintArgs = args.filter((arg) => arg.startsWith("--plan-fingerprint="));
  const flags = args.filter((arg) => !arg.startsWith("--plan-fingerprint="));
  const known = new Set(["--execute", "--json", "--help"]);
  const unknown = flags.filter((arg) => !known.has(arg));
  if (unknown.length > 0) refuse(`unknown argument(s): ${unknown.join(" ")}. Use --execute --plan-fingerprint=<hex>, --json or --help.`);
  if (args.includes("--help")) {
    console.log(
      "Usage: reproject:legacy-relationships [--execute --plan-fingerprint=<64 hex>] [--json]\n" +
        "Dry run by default. Needs REPROJECT_DATABASE_URL and REPROJECT_TARGET_CONFIRM; see docs/recording-publication-safety.md (section 14)."
    );
    return EXIT.OK;
  }
  const execute = flags.includes("--execute");
  const json = flags.includes("--json");
  if (fingerprintArgs.length > 1) refuse("--plan-fingerprint was given more than once.");
  const fingerprint = fingerprintArgs[0]?.slice("--plan-fingerprint=".length);
  if (execute && !(fingerprint && /^[0-9a-f]{64}$/.test(fingerprint))) {
    refuse("--execute needs --plan-fingerprint=<64 hex characters> copied from a dry run you have reviewed (it ties the run to exactly that plan).");
  }
  if (!execute && fingerprint !== undefined) refuse("--plan-fingerprint only applies together with --execute.");

  const real = readConfiguredRealDatabaseUrls(
    REPO_ROOT,
    process.env,
    { readdir: (directory) => readdirSync(directory), readFile: (file) => readFileSync(file, "utf8") },
    parse,
    path.join
  );
  if (!real.ok) refuse(real.reason);

  const target = resolveLoopbackTestTarget(NAMES, { env: process.env, realUrls: real.urls });
  if (!target.ok) refuse(target.reason);
  const targetName = describeTarget(target);

  // The driver gets the validated fields only, and the destination it will use must equal the acknowledged one.
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

    const result = await runLegacyReprojection(client, execute ? { execute: true, expectedFingerprint: fingerprint as string } : { execute: false });
    if (json) console.log(JSON.stringify({ target: targetName, mode: result.mode, runId: result.runId, inserted: result.inserted, deleted: result.deleted, fingerprint: result.plan.fingerprint, report: result.plan.report, inserts: result.plan.inserts, removals: result.plan.removals }, null, 2));
    else {
      console.log(formatReprojectionReport(result.plan, result.mode));
      if (result.mode === "DRY RUN") {
        console.log(
          result.plan.blocking.length > 0
            ? "\nDry run only: nothing was written. BLOCKED: resolve the conflicts above before any execution."
            : "\nDry run only: nothing was written. To apply exactly this plan: --execute --plan-fingerprint=<the fingerprint above>."
        );
      } else console.log(`\nExecuted in one transaction (run ${result.runId}); the audit entry lists every removed and inserted legacy row.`);
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