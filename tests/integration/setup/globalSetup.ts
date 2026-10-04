import path from "path";
import { listMigrationNames, resolveIntegrationDatabaseFromDisk } from "./loadIntegrationEnvironment";
import { describeIntegrationTarget } from "./testDatabaseRules";
import { verifyTestDatabase } from "./verifyTestDatabase";

// Phase 6J-2 — runs ONCE, in the main vitest process, before any worker starts.
// It re-resolves the target, proves the database is a marked, fully migrated test
// database, and prints which database the run will use (host and name only).
// Any problem throws, so a refused run never starts a single test.

export default async function globalSetup() {
  const root = path.resolve(__dirname, "../../..");
  const target = resolveIntegrationDatabaseFromDisk(root);
  if (!target.ok) throw new Error(`Integration database guard: ${target.reason}`);

  const verification = await verifyTestDatabase(target.databaseUrl, listMigrationNames(root));
  if (!verification.ok) throw new Error(`Integration database guard: ${verification.problems.join(" ")}`);

  console.log(describeIntegrationTarget(target).join("\n"));
}