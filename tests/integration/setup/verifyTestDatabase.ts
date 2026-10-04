import { Client } from "pg";
import { TEST_DATABASE_MARKER } from "./testDatabaseRules";

// Phase 6J-2 — the run-time check. The name and host rules prove what the URL
// LOOKS like; this proves what the database IS: it must carry the marker that
// only `npm run test:integration:setup` writes (and only onto an empty database),
// and it must have exactly this repository's migrations applied — so the suite
// never runs against a database that is stale, foreign, or someone's real data.

export interface TestDatabaseVerification {
  ok: boolean;
  problems: string[];
}

export async function verifyTestDatabase(connectionString: string, expectedMigrations: readonly string[]): Promise<TestDatabaseVerification> {
  const problems: string[] = [];
  const client = new Client({ connectionString });
  try {
    await client.connect();
  } catch (error) {
    return { ok: false, problems: [`Cannot connect to the test database (${error instanceof Error ? error.message : String(error)}). Is it running? (npm run test:integration:db:start)`] };
  }

  try {
    const marker = await client.query<{ comment: string | null }>(
      "select shobj_description(d.oid, 'pg_database') as comment from pg_database d where d.datname = current_database()"
    );
    if (marker.rows[0]?.comment !== TEST_DATABASE_MARKER) {
      problems.push("The database is not marked as an integration-test database. Run npm run test:integration:setup (it only marks an EMPTY database).");
    }

    const table = await client.query<{ exists: boolean }>("select to_regclass('public._prisma_migrations') is not null as exists");
    if (!table.rows[0]?.exists) {
      problems.push("The schema has not been applied. Run npm run test:integration:setup.");
    } else {
      const applied = await client.query<{ migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }>(
        "select migration_name, finished_at, rolled_back_at from _prisma_migrations"
      );
      const finished = new Set(applied.rows.filter((row) => row.finished_at && !row.rolled_back_at).map((row) => row.migration_name));
      const missing = expectedMigrations.filter((name) => !finished.has(name));
      const unknown = [...finished].filter((name) => !expectedMigrations.includes(name));
      if (missing.length > 0) problems.push(`Migrations not applied to the test database: ${missing.join(", ")}. Run npm run test:integration:setup.`);
      if (unknown.length > 0) problems.push(`The test database has migrations this repository does not know: ${unknown.join(", ")}. Run npm run test:integration:reset.`);
    }
  } finally {
    await client.end().catch(() => undefined);
  }
  return { ok: problems.length === 0, problems };
}
