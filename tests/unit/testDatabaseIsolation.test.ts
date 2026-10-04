import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import {
  TEST_DATABASE_MARKER,
  buildIntegrationWorkerEnv,
  describeIntegrationTarget,
  parseDatabaseUrl,
  resolveIntegrationDatabase,
  type IntegrationDatabaseTarget,
} from "../integration/setup/testDatabaseRules";
import { findConfiguredRealDatabaseUrls, resolveIntegrationDatabaseFromDisk } from "../integration/setup/loadIntegrationEnvironment";
import {
  LOCAL_TEST_DATABASE_NAME,
  embeddedPostgresPlatform,
  localTestDatabasePort,
  localTestDatabaseUrl,
  parseTestDatabaseCommand,
  postgresBinaryName,
} from "../integration/setup/localTestDatabase";

// Phase 6J-2 — the integration suite must never be able to run against the real
// Music Madras database. Everything below uses SYNTHETIC production-like
// fixtures; no real host or credential appears anywhere.

const root = path.resolve(__dirname, "../..");
const read = (relative: string) => readFileSync(path.join(root, relative), "utf8");

const SECRET = "synthetic-password-must-never-appear";
// A production-like Neon deployment: a pooled app URL and a direct URL of one database.
const PROD_POOLED = `postgresql://app_user:${SECRET}@ep-prod-123456-pooler.eu-west-2.aws.neon.tech/neondb?sslmode=require`;
const PROD_DIRECT = `postgresql://app_user:${SECRET}@ep-prod-123456.eu-west-2.aws.neon.tech/neondb?sslmode=require`;
const PRODUCTION = [PROD_POOLED, PROD_DIRECT];

const LOCAL_TEST = "postgresql://postgres@127.0.0.1:54329/music_madras_test";
const NEON_TEST_BRANCH = `postgresql://tester:${SECRET}@ep-test-branch-987654.eu-west-2.aws.neon.tech/music_madras_test?sslmode=require`;

const resolve = (env: Record<string, string | undefined>, productionUrls: readonly string[] = PRODUCTION) => resolveIntegrationDatabase({ env, productionUrls });

describe("fail closed", () => {
  it("refuses to start without TEST_DATABASE_URL, and says so", () => {
    const verdict = resolve({});
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toMatch(/Integration tests require TEST_DATABASE_URL/);
  });

  it("never falls back to DATABASE_URL / DIRECT_URL — they are not even read", () => {
    // Even a perfectly good test-looking DATABASE_URL does not satisfy the requirement.
    const verdict = resolve({ DATABASE_URL: LOCAL_TEST, DIRECT_URL: LOCAL_TEST } as Record<string, string>);
    expect(verdict.ok).toBe(false);
    expect(resolve({ TEST_DATABASE_URL: "   " }).ok).toBe(false);
  });

  it("refuses in a production environment even with a valid test database", () => {
    expect(resolve({ TEST_DATABASE_URL: LOCAL_TEST, NODE_ENV: "production" }).ok).toBe(false);
    expect(resolve({ TEST_DATABASE_URL: LOCAL_TEST, VERCEL_ENV: "production" }).ok).toBe(false);
  });

  it.each(["not a url", "mysql://u:p@127.0.0.1/music_madras_test", "postgresql://127.0.0.1", "postgresql://127.0.0.1/"])("refuses an unusable URL: %s", (url) => {
    expect(resolve({ TEST_DATABASE_URL: url }).ok).toBe(false);
  });
});

describe("TEST_DATABASE_URL = the production database → the suite refuses to start", () => {
  it("refuses the exact production URLs (pooled and direct)", () => {
    expect(resolve({ TEST_DATABASE_URL: PROD_POOLED }).ok).toBe(false);
    expect(resolve({ TEST_DATABASE_URL: PROD_DIRECT }).ok).toBe(false);
  });

  it("refuses a production database even if its name were disguised as a test name (same server)", () => {
    const disguised = `postgresql://app_user:${SECRET}@ep-prod-123456.eu-west-2.aws.neon.tech/neondb_test?sslmode=require`;
    const verdict = resolve({ TEST_DATABASE_URL: disguised });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toMatch(/same server/);
  });

  it("the pooled and direct endpoints of the production database are the same server", () => {
    const pooledDisguise = `postgresql://u:${SECRET}@ep-prod-123456-pooler.eu-west-2.aws.neon.tech/music_madras_test`;
    expect(resolve({ TEST_DATABASE_URL: pooledDisguise }).ok).toBe(false);
  });

  it("refuses by NAME alone when the real database is unknown (no .env at all)", () => {
    const verdict = resolve({ TEST_DATABASE_URL: PROD_DIRECT }, []);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toMatch(/does not look like a test database/);
  });

  it.each(["neondb", "music_madras", "production", "latest", "contest", "testing", "mmtest"])("a database named %s is not a test database", (name) => {
    expect(resolve({ TEST_DATABASE_URL: `postgresql://u@db.example.test:5432/${name}` }, []).ok).toBe(false);
  });

  it.each(["music_madras_test", "Music_Madras_TEST", "mm-test", "test", "test_db", "ci.test.1"])("a database named %s is accepted as a test name", (name) => {
    expect(resolve({ TEST_DATABASE_URL: `postgresql://u@db.example.test:5432/${name}` }, []).ok).toBe(true);
  });

  it("a local production database is refused when the test URL is the same database, allowed when it is another", () => {
    const localProd = ["postgresql://postgres@127.0.0.1:5432/music_madras_test"];
    expect(resolve({ TEST_DATABASE_URL: "postgresql://postgres@127.0.0.1:5432/music_madras_test" }, localProd).ok).toBe(false);
    expect(resolve({ TEST_DATABASE_URL: "postgresql://postgres@127.0.0.1:5432/other_test" }, localProd).ok).toBe(true);
  });
});

describe("TEST_DATABASE_URL = a dedicated test database → the suite can start", () => {
  it("accepts a local test database", () => {
    const verdict = resolve({ TEST_DATABASE_URL: LOCAL_TEST });
    expect(verdict).toMatchObject({ ok: true, host: "127.0.0.1", port: "54329", database: "music_madras_test", local: true, databaseUrl: LOCAL_TEST, directUrl: LOCAL_TEST });
  });

  it("accepts a separate hosted test database (a different Neon branch/endpoint)", () => {
    expect(resolve({ TEST_DATABASE_URL: NEON_TEST_BRANCH })).toMatchObject({ ok: true, local: false, host: "ep-test-branch-987654.eu-west-2.aws.neon.tech" });
  });

  it("TEST_DIRECT_URL must be the SAME database; a pooled TEST_DATABASE_URL may pair with its direct URL", () => {
    const pooled = NEON_TEST_BRANCH.replace("ep-test-branch-987654", "ep-test-branch-987654-pooler");
    const direct = NEON_TEST_BRANCH;
    expect(resolve({ TEST_DATABASE_URL: pooled, TEST_DIRECT_URL: direct })).toMatchObject({ ok: true, directUrl: direct });
    expect(resolve({ TEST_DATABASE_URL: pooled, TEST_DIRECT_URL: LOCAL_TEST }).ok).toBe(false);
    expect(resolve({ TEST_DATABASE_URL: LOCAL_TEST, TEST_DIRECT_URL: "postgresql://postgres@127.0.0.1:54329/another_test" }).ok).toBe(false);
  });

  it("normalises pooled hosts and ports", () => {
    expect(parseDatabaseUrl("postgresql://u@ep-x-pooler.a.b/Db")).toEqual({ host: "ep-x.a.b", port: "5432", database: "db" });
  });
});

describe("what the suite prints and reports never contains a credential", () => {
  it("every refusal reason and the start-up diagnostics are free of passwords and connection strings", () => {
    const reasons = [
      resolve({}),
      resolve({ TEST_DATABASE_URL: PROD_POOLED }),
      resolve({ TEST_DATABASE_URL: `postgresql://u:${SECRET}@ep-prod-123456.eu-west-2.aws.neon.tech/neondb_test` }),
      resolve({ TEST_DATABASE_URL: NEON_TEST_BRANCH, TEST_DIRECT_URL: PROD_DIRECT }),
      resolve({ TEST_DATABASE_URL: `postgresql://u:${SECRET}@db.example.test/prod` }, []),
    ].map((verdict) => (verdict.ok ? "" : verdict.reason));
    for (const reason of reasons) {
      expect(reason).not.toContain(SECRET);
      expect(reason).not.toMatch(/postgres(ql)?:\/\//);
    }

    const ok = resolve({ TEST_DATABASE_URL: NEON_TEST_BRANCH });
    if (!ok.ok) throw new Error("fixture should resolve");
    const lines = describeIntegrationTarget(ok).join("\n");
    expect(lines).toBe("Integration database:\n  ep-test-branch-987654.eu-west-2.aws.neon.tech:5432\n  database: music_madras_test");
    expect(lines).not.toContain(SECRET);
  });
});

describe("the worker environment replaces the real database and switches every external service off", () => {
  const target = resolve({ TEST_DATABASE_URL: LOCAL_TEST }) as IntegrationDatabaseTarget & { ok: true };
  const env = buildIntegrationWorkerEnv(target, "/nowhere/.env");

  it("DATABASE_URL and DIRECT_URL are the test database, never a real one", () => {
    expect(env.DATABASE_URL).toBe(LOCAL_TEST);
    expect(env.DIRECT_URL).toBe(LOCAL_TEST);
    expect(env.MM_INTEGRATION_DATABASE).toBe("127.0.0.1:54329/music_madras_test");
    expect(JSON.stringify(env)).not.toContain("neon.tech");
  });

  it("the repository's real .env cannot be loaded inside a test", () => {
    expect(env.DOTENV_CONFIG_PATH).toBe("/nowhere/.env");
  });

  it.each(["YOUTUBE_API_KEY", "ANTHROPIC_API_KEY", "SMTP_URL", "GA4_API_SECRET", "GOOGLE_CLIENT_SECRET", "FOUNDER_EMAIL"])("%s is blank, so no real service or account can be reached", (key) => {
    expect(env[key]).toBe("");
  });
});

describe("reading the developer's env files", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), "mm-isolation-"));
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  const write = (name: string, body: string) => writeFileSync(path.join(dir, name), body);

  it("learns the real databases from .env* files, but never from .env.test or .env.example", () => {
    write(".env", `DATABASE_URL=${PROD_POOLED}\nDIRECT_URL=${PROD_DIRECT}\n`);
    write(".env.local", "DATABASE_URL=postgresql://u@local.example/other\n");
    write(".env.test", `DATABASE_URL=${LOCAL_TEST}\n`);
    write(".env.example", "DATABASE_URL=postgresql://USER:PASSWORD@HOST/DATABASE\n");
    expect(findConfiguredRealDatabaseUrls(dir).sort()).toEqual([PROD_DIRECT, PROD_POOLED, "postgresql://u@local.example/other"].sort());
  });

  it("takes the test target from .env.test; a shell variable wins over the file", () => {
    write(".env", `DATABASE_URL=${PROD_POOLED}\n`);
    write(".env.test", `TEST_DATABASE_URL=${LOCAL_TEST}\n`);
    expect(resolveIntegrationDatabaseFromDisk(dir, {})).toMatchObject({ ok: true, database: "music_madras_test" });
    expect(resolveIntegrationDatabaseFromDisk(dir, { TEST_DATABASE_URL: "postgresql://u@127.0.0.1:5999/other_test" })).toMatchObject({ ok: true, database: "other_test", port: "5999" });
  });

  it("does not read TEST_DATABASE_URL out of the real .env, and does not fall back to its DATABASE_URL", () => {
    write(".env", `DATABASE_URL=${PROD_POOLED}\nDIRECT_URL=${PROD_DIRECT}\nTEST_DATABASE_URL=${LOCAL_TEST}\n`);
    expect(resolveIntegrationDatabaseFromDisk(dir, {}).ok).toBe(false);
  });

  it("refuses a .env.test that points at the same server as the real .env", () => {
    write(".env", `DATABASE_URL=${PROD_POOLED}\n`);
    write(".env.test", `TEST_DATABASE_URL=${PROD_DIRECT}\n`);
    expect(resolveIntegrationDatabaseFromDisk(dir, {}).ok).toBe(false);
  });

  it("survives missing files", () => {
    expect(resolveIntegrationDatabaseFromDisk(dir, {}).ok).toBe(false);
    expect(findConfiguredRealDatabaseUrls(dir)).toEqual([]);
  });
});

describe("the per-file worker guard (setupFiles)", () => {
  const guard = async (env: Record<string, string | undefined>, productionUrls: string[] = PRODUCTION) => {
    vi.resetModules();
    vi.doMock("../integration/setup/loadIntegrationEnvironment", () => ({ findConfiguredRealDatabaseUrls: () => productionUrls }));
    const saved = { ...process.env };
    for (const key of ["DATABASE_URL", "DIRECT_URL", "MM_INTEGRATION_DATABASE", "NODE_ENV", "VERCEL_ENV"]) delete process.env[key];
    Object.assign(process.env, env);
    try {
      await import("../integration/setup/guardDatabase");
    } finally {
      process.env = saved;
      vi.doUnmock("../integration/setup/loadIntegrationEnvironment");
    }
  };

  it("lets a worker prepared with the test database through", async () => {
    await expect(guard({ DATABASE_URL: LOCAL_TEST, MM_INTEGRATION_DATABASE: "127.0.0.1:54329/music_madras_test" })).resolves.toBeUndefined();
  });

  it("stops a worker whose DATABASE_URL is the real database", async () => {
    await expect(guard({ DATABASE_URL: PROD_POOLED, MM_INTEGRATION_DATABASE: "ep-prod-123456.eu-west-2.aws.neon.tech:5432/neondb" })).rejects.toThrow(/Integration database guard/);
  });

  it("stops a process that the integration config did not prepare", async () => {
    await expect(guard({ DATABASE_URL: LOCAL_TEST })).rejects.toThrow(/not prepared by vitest.integration.config/);
    await expect(guard({ DATABASE_URL: LOCAL_TEST, MM_INTEGRATION_DATABASE: "somewhere-else:1/other_test" })).rejects.toThrow(/not prepared/);
  });

  it("stops a worker with no DATABASE_URL at all", async () => {
    await expect(guard({})).rejects.toThrow(/require TEST_DATABASE_URL/);
  });
});

describe("the wiring that makes npm run test:integration safe by default", () => {
  const config = read("vitest.integration.config.ts");
  const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string>; devDependencies: Record<string, string> };

  it("the config resolves the test database at load time (so a refused run never starts) and installs every layer", () => {
    expect(config).toContain("resolveIntegrationDatabaseFromDisk(__dirname)");
    expect(config).toMatch(/if \(!target\.ok\) throw new Error/);
    expect(config).toContain("tests/integration/setup/globalSetup.ts");
    expect(config).toContain("tests/integration/setup/guardDatabase.ts");
    expect(config).toContain("buildIntegrationWorkerEnv(");
  });

  it("nothing in the integration harness reads DATABASE_URL as a source, or still offers the old host-acknowledgement override", () => {
    for (const file of ["vitest.integration.config.ts", "tests/integration/setup/loadIntegrationEnvironment.ts", "tests/integration/setup/testDatabaseRules.ts", "tests/integration/setup/globalSetup.ts", "scripts/testDatabase.ts"]) {
      expect(read(file), file).not.toMatch(/ALLOW_INTEGRATION_TESTS_ON_HOST/);
      expect(read(file).split("\n").filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*")).join("\n"), file).not.toMatch(/process\.env\.DATABASE_URL|env\.DATABASE_URL|shellEnv\.DATABASE_URL/);
    }
    expect(read(".env.example")).not.toContain("ALLOW_INTEGRATION_TESTS_ON_HOST");
  });

  it("the test-database script never imports the application's Prisma client or reads DATABASE_URL", () => {
    const script = read("scripts/testDatabase.ts");
    expect(script).not.toContain("modules/db/client");
    expect(script).not.toMatch(/process\.env\.DATABASE_URL/);
  });

  it("the npm scripts exist; the default `npm test` still cannot reach any database", () => {
    expect(pkg.scripts["test:integration"]).toBe("vitest run --config vitest.integration.config.ts");
    for (const name of ["db:start", "db:stop"]) expect(pkg.scripts[`test:integration:${name}`]).toMatch(/^tsx scripts\/testDatabase\.ts (start|stop)$/);
    expect(pkg.scripts["test:integration:setup"]).toBe("tsx scripts/testDatabase.ts setup");
    expect(pkg.scripts["test:integration:reset"]).toBe("tsx scripts/testDatabase.ts reset");
    expect(read("vitest.config.ts")).toContain('include: ["tests/unit/**/*.test.ts"]');
  });

  it("the embedded PostgreSQL is a pinned dev dependency only", () => {
    expect(pkg.devDependencies["embedded-postgres"]).toMatch(/^\d+\.\d+\.\d+-beta\.\d+$/);
  });

  it(".env.test (where TEST_DATABASE_URL may live) is ignored by git, so it can never be committed", () => {
    expect(read(".gitignore").split(/\r?\n/)).toContain(".env.*");
  });

  it("the marker is the one the setup command writes", () => {
    expect(read("scripts/testDatabase.ts")).toContain("TEST_DATABASE_MARKER");
    expect(TEST_DATABASE_MARKER).toBe("music-madras-integration-test");
  });
});

describe("local test database helpers", () => {
  it("builds a loopback, password-less URL whose database name is a test name", () => {
    const url = localTestDatabaseUrl(54329);
    expect(url).toBe(`postgresql://postgres@127.0.0.1:54329/${LOCAL_TEST_DATABASE_NAME}`);
    expect(resolve({ TEST_DATABASE_URL: url }).ok).toBe(true);
  });

  it("port override is validated", () => {
    expect(localTestDatabasePort({})).toBe(54329);
    expect(localTestDatabasePort({ MM_TEST_DB_PORT: "55000" })).toBe(55000);
    for (const bad of ["abc", "80", "99999", "5.5", ""]) expect(localTestDatabasePort({ MM_TEST_DB_PORT: bad })).toBe(54329);
  });

  it("maps platforms to the embedded-postgres packages and binary names", () => {
    expect(embeddedPostgresPlatform("win32", "x64")).toBe("windows-x64");
    expect(embeddedPostgresPlatform("linux", "x64")).toBe("linux-x64");
    expect(embeddedPostgresPlatform("darwin", "arm64")).toBe("darwin-arm64");
    expect(postgresBinaryName("pg_ctl", "win32")).toBe("pg_ctl.exe");
    expect(postgresBinaryName("initdb", "linux")).toBe("initdb");
  });

  it("only the five known commands parse", () => {
    for (const command of ["start", "stop", "status", "setup", "reset"]) expect(parseTestDatabaseCommand([command])).toBe(command);
    for (const bad of [[], ["wipe"], ["setup", "--force"], ["reset", "x"]]) expect(parseTestDatabaseCommand(bad)).toBeNull();
  });
});
