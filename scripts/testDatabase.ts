// Manages the DEDICATED integration-test database (Phase 6J-2).
//
//   npm run test:integration:db:start   start a local PostgreSQL for tests (optional; see below)
//   npm run test:integration:db:stop    stop it
//   npm run test:integration:setup      mark the TEST_DATABASE_URL database as a test database and apply the migrations
//   npm run test:integration:reset      wipe the test database and re-apply the migrations
//
// None of this can touch the real Music Madras database: `setup` and `reset`
// only act on TEST_DATABASE_URL after the same safety rules the test run uses
// (a "test" database name, not the configured real server, not production), and
// `reset` additionally requires the integration-test marker. This script never
// reads DATABASE_URL, and the Prisma CLI it launches is given the TEST database
// as its only database and cannot see the repository's .env.
//
// The local server is the PostgreSQL shipped by the `embedded-postgres` dev
// dependency; it is just one way to get a TEST_DATABASE_URL. A CI service
// container or a separate Neon branch works equally well — set TEST_DATABASE_URL
// to it and run `setup`.

import { spawnSync } from "child_process";
import { existsSync, mkdirSync } from "fs";
import os from "os";
import path from "path";
import { Client } from "pg";
import { listMigrationNames, resolveIntegrationDatabaseFromDisk } from "../tests/integration/setup/loadIntegrationEnvironment";
import { TEST_DATABASE_MARKER, describeIntegrationTarget, type IntegrationDatabaseTarget } from "../tests/integration/setup/testDatabaseRules";
import {
  LOCAL_TEST_DATABASE_NAME,
  embeddedPostgresPlatform,
  localTestDataDirectory,
  localTestDatabasePort,
  localTestDatabaseUrl,
  parseTestDatabaseCommand,
  postgresBinaryName,
} from "../tests/integration/setup/localTestDatabase";

const root = path.resolve(__dirname, "..");

function binary(name: "initdb" | "pg_ctl"): string {
  const file = path.join(root, "node_modules", "@embedded-postgres", embeddedPostgresPlatform(), "native", "bin", postgresBinaryName(name));
  if (!existsSync(file)) throw new Error(`The embedded PostgreSQL binary ${file} was not found. Run npm install (devDependency embedded-postgres), or provide your own TEST_DATABASE_URL.`);
  return file;
}

/** stdio is ignored on purpose: a server that inherits our pipes keeps the calling shell waiting forever. */
function run(file: string, args: string[]): number {
  return spawnSync(file, args, { stdio: "ignore" }).status ?? 1;
}

function isRunning(dataDir: string): boolean {
  return run(binary("pg_ctl"), ["status", "-D", dataDir]) === 0;
}

async function ensureLocalDatabaseExists(port: number): Promise<void> {
  const admin = new Client({ connectionString: `postgresql://postgres@127.0.0.1:${port}/postgres` });
  await admin.connect();
  try {
    const exists = await admin.query("select 1 from pg_database where datname = $1", [LOCAL_TEST_DATABASE_NAME]);
    if (exists.rowCount === 0) await admin.query(`create database ${admin.escapeIdentifier(LOCAL_TEST_DATABASE_NAME)}`);
  } finally {
    await admin.end();
  }
}

async function start(): Promise<number> {
  const dataDir = localTestDataDirectory();
  const port = localTestDatabasePort();
  if (!existsSync(path.join(dataDir, "PG_VERSION"))) {
    mkdirSync(path.dirname(dataDir), { recursive: true });
    const base = ["-D", dataDir, "-U", "postgres", "--auth=trust", "-E", "UTF8"];
    // ICU gives the same English ordering a hosted Postgres uses; fall back if this build lacks it.
    if (run(binary("initdb"), [...base, "--locale-provider=icu", "--icu-locale=en-US"]) !== 0 && run(binary("initdb"), base) !== 0) {
      console.error(`initdb failed for ${dataDir}.`);
      return 1;
    }
  }
  if (!isRunning(dataDir)) {
    const started = run(binary("pg_ctl"), ["start", "-w", "-D", dataDir, "-l", path.join(dataDir, "server.log"), "-o", `-p ${port} -c listen_addresses=127.0.0.1`]);
    if (started !== 0) {
      console.error(`The test PostgreSQL did not start (see ${path.join(dataDir, "server.log")}).`);
      return 1;
    }
  }
  await ensureLocalDatabaseExists(port);
  console.log(`Local test PostgreSQL is running on 127.0.0.1:${port} (data: ${dataDir}).`);
  console.log("Put this in .env.test (it is gitignored), or export it in your shell:");
  console.log(`  TEST_DATABASE_URL=${localTestDatabaseUrl(port)}`);
  console.log("Then: npm run test:integration:setup");
  return 0;
}

function stop(): number {
  const dataDir = localTestDataDirectory();
  if (!existsSync(path.join(dataDir, "PG_VERSION")) || !isRunning(dataDir)) {
    console.log("The local test PostgreSQL is not running.");
    return 0;
  }
  const code = run(binary("pg_ctl"), ["stop", "-m", "fast", "-w", "-D", dataDir]);
  console.log(code === 0 ? "Local test PostgreSQL stopped." : "Could not stop the local test PostgreSQL.");
  return code;
}

function status(): number {
  const dataDir = localTestDataDirectory();
  const running = existsSync(path.join(dataDir, "PG_VERSION")) && isRunning(dataDir);
  console.log(`Local test PostgreSQL: ${running ? `running on 127.0.0.1:${localTestDatabasePort()}` : "not running"} (data: ${dataDir}).`);
  return 0;
}

function target(): IntegrationDatabaseTarget {
  const resolved = resolveIntegrationDatabaseFromDisk(root);
  if (!resolved.ok) throw new Error(resolved.reason);
  console.log(describeIntegrationTarget(resolved).join("\n"));
  return resolved;
}

/** Applies the repository's EXISTING migrations — never creates one — to the test database only. */
function migrateDeploy(t: IntegrationDatabaseTarget): number {
  const prismaCli = path.join(root, "node_modules", "prisma", "build", "index.js");
  const emptyDotenv = path.join(os.tmpdir(), "music-madras-no-dotenv", ".env");
  const result = spawnSync(process.execPath, [prismaCli, "migrate", "deploy"], {
    cwd: root,
    stdio: "inherit",
    // The CLI's only database is the test database, and it cannot read the repository's .env.
    env: { ...process.env, DIRECT_URL: t.directUrl, DATABASE_URL: t.databaseUrl, DOTENV_CONFIG_PATH: emptyDotenv, DOTENV_CONFIG_QUIET: "true" },
  });
  return result.status ?? 1;
}

async function withClient<T>(t: IntegrationDatabaseTarget, work: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: t.databaseUrl });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

async function readMarker(client: Client): Promise<string | null> {
  const result = await client.query<{ comment: string | null }>("select shobj_description(d.oid, 'pg_database') as comment from pg_database d where d.datname = current_database()");
  return result.rows[0]?.comment ?? null;
}

async function setup(): Promise<number> {
  const t = target();
  await withClient(t, async (client) => {
    if ((await readMarker(client)) === TEST_DATABASE_MARKER) return;
    // Only an EMPTY database may be marked: marking is how a database is declared disposable.
    const tables = await client.query("select count(*)::int as n from information_schema.tables where table_schema = 'public'");
    if (tables.rows[0].n > 0) {
      throw new Error("This database is not marked as a test database and it already contains tables, so it will not be marked. Use an empty database.");
    }
    await client.query(`comment on database ${client.escapeIdentifier(t.database)} is ${client.escapeLiteral(TEST_DATABASE_MARKER)}`);
    console.log("Marked the database as an integration-test database.");
  });
  const code = migrateDeploy(t);
  if (code === 0) console.log(`Test database ready (${listMigrationNames(root).length} migrations).`);
  return code;
}

async function reset(): Promise<number> {
  const t = target();
  await withClient(t, async (client) => {
    if ((await readMarker(client)) !== TEST_DATABASE_MARKER) {
      throw new Error("Refusing to reset: this database is not marked as an integration-test database (run test:integration:setup on an EMPTY database first).");
    }
    await client.query("drop schema public cascade");
    await client.query("create schema public");
    console.log("Test database wiped.");
  });
  return migrateDeploy(t);
}

async function main(): Promise<number> {
  const command = parseTestDatabaseCommand(process.argv.slice(2));
  if (!command) {
    console.error("Usage: tsx scripts/testDatabase.ts <start|stop|status|setup|reset>");
    return 2;
  }
  switch (command) {
    case "start":
      return start();
    case "stop":
      return stop();
    case "status":
      return status();
    case "setup":
      return setup();
    case "reset":
      return reset();
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });