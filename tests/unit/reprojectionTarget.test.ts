import { readFileSync } from "fs";
import path from "path";
import { Client } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import { describeClientDestination, describeTarget, resolveLoopbackTestTarget, type BackfillTargetResolution } from "../../modules/backfill/revisionRelationships/backfillTarget";

// Phase 6J-12B — the re-projection tool's target rules. The tool shares the backfill's rules (same function) under its OWN variable names.
// Synthetic URLs only; the fake password proves nothing leaks.

const NAMES = { url: "REPROJECT_DATABASE_URL", confirm: "REPROJECT_TARGET_CONFIRM", noun: "re-projection" } as const;
const LOCAL = "postgresql://postgres:s3cretpw@127.0.0.1:54329/music_madras_test";
const CONFIRM = "127.0.0.1:54329/music_madras_test";

const resolve = (env: Record<string, string | undefined>, realUrls: string[] = ["postgresql://owner:realpw@ep-real-db-pooler.eu.example.com/neondb?sslmode=require"]) =>
  resolveLoopbackTestTarget(NAMES, { env, realUrls });
const good = { REPROJECT_DATABASE_URL: LOCAL, REPROJECT_TARGET_CONFIRM: CONFIRM };
const reasonOf = (r: BackfillTargetResolution) => (r.ok ? "" : r.reason);

afterEach(() => vi.unstubAllEnvs());

describe("re-projection target: same rules as the backfill, its own variables", () => {
  it("accepts exactly the explicitly configured, acknowledged, loopback test database, and builds the client from validated fields", () => {
    const result = resolve(good);
    expect(result).toMatchObject({ ok: true, host: "127.0.0.1", port: "54329", database: "music_madras_test", clientConfig: { host: "127.0.0.1", port: 54329, database: "music_madras_test", user: "postgres" } });
    expect(result).not.toHaveProperty("connectionString");
  });

  it("never borrows another tool's or the application's variables: BACKFILL_*, DATABASE_URL, DIRECT_URL, TEST_DATABASE_URL do not make it run", () => {
    for (const key of ["BACKFILL_DATABASE_URL", "DATABASE_URL", "DIRECT_URL", "TEST_DATABASE_URL"]) {
      const result = resolve({ [key]: LOCAL, BACKFILL_TARGET_CONFIRM: CONFIRM, REPROJECT_TARGET_CONFIRM: CONFIRM });
      expect(result.ok, key).toBe(false);
      expect(reasonOf(result)).toMatch(/REPROJECT_DATABASE_URL is not set/);
    }
    // and the acknowledgement is its own too
    expect(reasonOf(resolve({ REPROJECT_DATABASE_URL: LOCAL, BACKFILL_TARGET_CONFIRM: CONFIRM }))).toMatch(/REPROJECT_TARGET_CONFIRM must be set/);
  });

  it("refuses every remote host and every host that is not a loopback IP literal, with a matching acknowledgement", () => {
    for (const host of ["ep-anything.eu.example.com", "10.0.0.5", "staging.example.com", "localhost", "127.1", "0.0.0.0"]) {
      const url = `postgresql://u:p@${host}:5432/music_madras_test`;
      const result = resolve({ REPROJECT_DATABASE_URL: url, REPROJECT_TARGET_CONFIRM: `${host}:5432/music_madras_test` });
      expect(result.ok, host).toBe(false);
      expect(reasonOf(result)).toMatch(/not a loopback IP address/);
    }
  });

  it("URL query overrides cannot redirect it: ?host= / ?port= / ?hostaddr= / anything after ? or # is refused before a connection exists", () => {
    for (const suffix of ["?host=ep-real.eu.example.com", "?port=5432", "?hostaddr=10.0.0.5", "?sslmode=require", "?", "#frag"]) {
      const result = resolve({ REPROJECT_DATABASE_URL: `${LOCAL}${suffix}`, REPROJECT_TARGET_CONFIRM: CONFIRM });
      expect(result.ok, suffix).toBe(false);
      expect(reasonOf(result), suffix).toMatch(/REPROJECT_DATABASE_URL must be a plain/);
      expect(result).not.toHaveProperty("clientConfig");
    }
  });

  it("a missing port is refused — it cannot inherit PGPORT", () => {
    for (const pgPort of [undefined, "5432", "54329", "6543"]) {
      vi.unstubAllEnvs();
      if (pgPort) vi.stubEnv("PGPORT", pgPort);
      const result = resolve({ REPROJECT_DATABASE_URL: "postgresql://postgres@127.0.0.1/music_madras_test", REPROJECT_TARGET_CONFIRM: CONFIRM, PGPORT: pgPort });
      expect(result.ok, String(pgPort)).toBe(false);
      expect(reasonOf(result)).toMatch(/port explicitly/);
    }
  });

  it("ambiguous or unsupported URL forms are refused", () => {
    const urls = [
      "postgresql://127.0.0.1:54329/music_madras_test",
      "postgresql://u@127.0.0.1:54329,10.0.0.5:5432/music_madras_test",
      "postgresql://127.0.0.1:54329@remote.example.com:5432/music_madras_test",
      "postgresql://u@127.0.0.1:54329/music_madras_test/other",
      "postgresql://u@127.0.0.1:54329/music_madras_test%3Fhost%3Dremote.example.com",
      "postgresql://u@127.0.0.1:54329/",
      "postgresql://u@127.0.0.1:0/music_madras_test",
      "mysql://u@127.0.0.1:54329/music_madras_test",
    ];
    for (const url of urls) expect(resolve({ REPROJECT_DATABASE_URL: url, REPROJECT_TARGET_CONFIRM: CONFIRM }).ok, url).toBe(false);
  });

  it("requires a test-named database, the acknowledgement, a non-production environment, and refuses a configured real database", () => {
    expect(resolve({ REPROJECT_DATABASE_URL: "postgresql://u@127.0.0.1:54329/music_madras", REPROJECT_TARGET_CONFIRM: "127.0.0.1:54329/music_madras" }).ok).toBe(false);
    expect(resolve({ REPROJECT_DATABASE_URL: LOCAL }).ok).toBe(false);
    expect(resolve({ ...good, REPROJECT_TARGET_CONFIRM: "127.0.0.1:5432/music_madras_test" }).ok).toBe(false);
    expect(resolve({ ...good, NODE_ENV: "production" }).ok).toBe(false);
    expect(resolve({ ...good, VERCEL_ENV: "production" }).ok).toBe(false);
    expect(resolve(good, [LOCAL]).ok).toBe(false);
    expect(resolve(good, ["postgresql://other@127.0.0.1:54329/music_madras_test"]).ok).toBe(false);
  });

  it("refusal messages name the re-projection variables, never the backfill's, and never contain a credential or a connection string", () => {
    const attempts = [
      resolve({}),
      resolve({ REPROJECT_DATABASE_URL: LOCAL }),
      resolve({ REPROJECT_DATABASE_URL: `${LOCAL}?host=remote.example.com`, REPROJECT_TARGET_CONFIRM: CONFIRM }),
      resolve({ REPROJECT_DATABASE_URL: "postgresql://u:s3cretpw@remote.example.com:5432/music_madras_test", REPROJECT_TARGET_CONFIRM: "x" }),
      resolve({ REPROJECT_DATABASE_URL: "postgresql://u:s3cretpw@127.0.0.1/music_madras_test", REPROJECT_TARGET_CONFIRM: CONFIRM }),
    ];
    for (const attempt of attempts) {
      const reason = reasonOf(attempt);
      expect(attempt.ok).toBe(false);
      expect(reason).not.toMatch(/BACKFILL_|s3cretpw|realpw|postgres(ql)?:\/\/(?!user@host:port\/database)/i); // the host of a REFUSED remote target may be named; a URL parameter value never is
      if (attempt === attempts[2]) expect(reason).not.toContain("remote.example.com");
    }
  });
});

describe("the confirmed target is the actual client destination", () => {
  it("the printed/confirmed target equals the destination the driver will use", () => {
    const result = resolve(good);
    if (!result.ok) throw new Error(result.reason);
    expect(describeClientDestination(result.clientConfig)).toBe(CONFIRM);
    expect(describeClientDestination(result.clientConfig)).toBe(describeTarget(result));
    const v6 = resolve({ REPROJECT_DATABASE_URL: "postgresql://u@[::1]:54329/music_madras_test", REPROJECT_TARGET_CONFIRM: "[::1]:54329/music_madras_test" });
    if (!v6.ok) throw new Error(v6.reason);
    expect(describeClientDestination(v6.clientConfig)).toBe("[::1]:54329/music_madras_test");
  });

  it("the real driver built from it targets exactly that destination, whatever PG* variables say", () => {
    const result = resolve(good);
    if (!result.ok) throw new Error(result.reason);
    for (const [name, value] of Object.entries({ PGHOST: "remote.example.com", PGPORT: "6543", PGDATABASE: "neondb", PGUSER: "someone_else", PGHOSTADDR: "10.0.0.5" })) vi.stubEnv(name, value);
    const client = new Client(result.clientConfig);
    expect({ host: client.host, port: client.port, database: client.database, user: client.user }).toEqual({ host: "127.0.0.1", port: 54329, database: "music_madras_test", user: "postgres" });
  });

  it("the script hands the driver the validated configuration only, checks it against the acknowledgement, and never uses the working directory", () => {
    const script = readFileSync(path.join(process.cwd(), "scripts", "reprojectLegacyRelationships.ts"), "utf8");
    expect(script).toContain("new Client(target.clientConfig)");
    expect(script).toMatch(/describeClientDestination\(target\.clientConfig\)/);
    expect(script).not.toMatch(/connectionString/);
    expect(script).not.toMatch(/process\.cwd\(\)/);
    expect(script).not.toMatch(/process\.env\.(DATABASE_URL|DIRECT_URL|BACKFILL_)/);
    expect(script).toContain("readConfiguredRealDatabaseUrls");
  });
});
