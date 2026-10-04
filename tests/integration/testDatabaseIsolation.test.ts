import { describe, expect, it } from "vitest";
import path from "path";
import { prisma } from "../../modules/db/client";
import { findConfiguredRealDatabaseUrls, listMigrationNames } from "./setup/loadIntegrationEnvironment";
import { TEST_DATABASE_MARKER, parseDatabaseUrl } from "./setup/testDatabaseRules";

// Phase 6J-2 — proof, from INSIDE the running harness, that this process is
// talking to the dedicated test database and to nothing real: the connected
// database is the marked test one, the real .env is unreadable, and no external
// service credential is present.

const root = path.resolve(__dirname, "../..");

describe("the integration harness is isolated from the real Music Madras database", () => {
  it("is connected to the marked test database the config prepared", async () => {
    const [{ name, marker }] = await prisma.$queryRaw<{ name: string; marker: string | null }[]>`
      select current_database() as name, shobj_description(d.oid, 'pg_database') as marker
      from pg_database d where d.datname = current_database()`;
    const target = parseDatabaseUrl(process.env.DATABASE_URL as string)!;
    expect(name.toLowerCase()).toBe(target.database);
    expect(`${target.host}:${target.port}/${target.database}`).toBe(process.env.MM_INTEGRATION_DATABASE);
    expect(name).toMatch(/test/i);
    expect(marker).toBe(TEST_DATABASE_MARKER);
  });

  it("does not point at any database the checkout's .env files configure as real", () => {
    const target = parseDatabaseUrl(process.env.DATABASE_URL as string)!;
    for (const url of findConfiguredRealDatabaseUrls(root)) {
      const real = parseDatabaseUrl(url);
      if (!real) continue;
      expect(`${real.host}:${real.port}`, "the test database must not be on a real server").not.toBe(`${target.host}:${target.port}`);
    }
    expect(process.env.DIRECT_URL).toBe(process.env.DATABASE_URL);
  });

  it("has the repository's migrations applied and nothing else", async () => {
    const rows = await prisma.$queryRaw<{ migration_name: string }[]>`select migration_name from _prisma_migrations where finished_at is not null and rolled_back_at is null`;
    expect(rows.map((r) => r.migration_name).sort()).toEqual(listMigrationNames(root));
  });

  it("cannot read the real .env: its secrets are absent and external services are switched off", () => {
    expect(process.env.AUTH_SECRET).toBe("integration-test-secret-not-a-real-secret");
    for (const key of ["YOUTUBE_API_KEY", "YOUTUBE_CHANNEL_ID", "ANTHROPIC_API_KEY", "SMTP_URL", "GA4_API_SECRET", "GOOGLE_CLIENT_SECRET", "FOUNDER_EMAIL", "FOUNDER_NAME"]) {
      expect(process.env[key], key).toBe("");
    }
  });

  it("does not hold a copy of the real synced catalogue (tests build their own fixtures)", async () => {
    expect(await prisma.youTubeVideo.count()).toBeLessThan(100);
  });
});
