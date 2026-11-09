import { describe, expect, it } from "vitest";
import { buildStagingConnectionString, describeStagingTarget, resolveStagingTarget } from "../../modules/seed/stagingTarget";

// Which database the staging content loader may write to. Synthetic hosts and credentials only: no real database is ever named here.

const PASSWORD = "S3cretPassw0rd-DO-NOT-LEAK";
const STAGING = `postgresql://app_user:${PASSWORD}@ep-quiet-wave-123456.us-east-2.aws.neon.tech:5432/music_madras_staging`;
const CONFIRM = "ep-quiet-wave-123456.us-east-2.aws.neon.tech:5432/music_madras_staging";
const base = { env: { STAGING_DATABASE_URL: STAGING } as Record<string, string | undefined>, confirmHost: CONFIRM, realUrls: [] as string[] };
const resolve = (over: Partial<typeof base> & { url?: string; nodeEnv?: string } = {}) =>
  resolveStagingTarget({ env: { STAGING_DATABASE_URL: over.url ?? STAGING, NODE_ENV: over.nodeEnv }, confirmHost: "confirmHost" in over ? over.confirmHost : CONFIRM, realUrls: over.realUrls ?? [] });
const reason = (r: ReturnType<typeof resolve>) => (r.ok ? "" : r.reason);

describe("an acceptable target", () => {
  it("is a direct Neon host with 'staging' in the database name, confirmed exactly", () => {
    const r = resolveStagingTarget(base);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(describeStagingTarget(r)).toBe(CONFIRM);
      expect(r.clientConfig).toMatchObject({ host: "ep-quiet-wave-123456.us-east-2.aws.neon.tech", port: 5432, database: "music_madras_staging", user: "app_user", password: PASSWORD });
    }
  });

  it("accepts the confirmation in any letter case and with surrounding spaces", () => {
    expect(resolve({ confirmHost: `  ${CONFIRM.toUpperCase()} ` }).ok).toBe(true);
  });
});

describe("refusals", () => {
  it("there is no fallback: without STAGING_DATABASE_URL nothing else is read, even when DATABASE_URL and DIRECT_URL are set", () => {
    const r = resolveStagingTarget({ env: { DATABASE_URL: STAGING, DIRECT_URL: STAGING } as Record<string, string | undefined>, confirmHost: CONFIRM, realUrls: [] });
    expect(r.ok).toBe(false);
    expect(reason(r)).toMatch(/STAGING_DATABASE_URL is not set.*never falls back/);
  });

  it("refuses a production environment", () => {
    expect(reason(resolve({ nodeEnv: "production" }))).toMatch(/NODE_ENV is production/);
  });

  it.each([
    ["a query string", `${STAGING}?sslmode=require`],
    ["a fragment", `${STAGING}#x`],
    ["a missing port", `postgresql://u:p@ep-a.us-east-2.aws.neon.tech/music_madras_staging`],
    ["no user", `postgresql://ep-a.us-east-2.aws.neon.tech:5432/music_madras_staging`],
    ["not a URL", "not a url"],
    ["a different scheme", `mysql://u:p@ep-a.us-east-2.aws.neon.tech:5432/music_madras_staging`],
  ])("refuses %s, and says STAGING_DATABASE_URL (not another variable)", (_label, url) => {
    const r = resolve({ url });
    expect(r.ok).toBe(false);
    expect(reason(r)).not.toMatch(/BACKFILL/);
  });

  it.each([
    ["localhost", "postgresql://u:p@localhost:5432/music_madras_staging"],
    ["a loopback address", "postgresql://u:p@127.0.0.1:5432/music_madras_staging"],
    ["a private address", "postgresql://u:p@10.0.0.5:5432/music_madras_staging"],
    ["a non-Neon hostname", "postgresql://u:p@db.example.com:5432/music_madras_staging"],
    ["a lookalike Neon domain", "postgresql://u:p@ep-a.neon.tech.evil.example:5432/music_madras_staging"],
  ])("refuses %s as unrecognised", (_label, url) => {
    expect(reason(resolve({ url, confirmHost: undefined }))).toMatch(/not a Neon host/);
  });

  it("refuses a pooled endpoint", () => {
    const url = `postgresql://u:p@ep-quiet-wave-123456-pooler.us-east-2.aws.neon.tech:5432/music_madras_staging`;
    expect(reason(resolve({ url }))).toMatch(/pooled endpoint.*DIRECT/);
  });

  it.each(["music_madras_test", "music_madras_prod", "music_madras_production", "prod", "neondb", "music_madras", "music_madras_staging_test"])("refuses the database name %s", (name) => {
    const r = resolve({ url: `postgresql://u:p@ep-a.us-east-2.aws.neon.tech:5432/${name}`, confirmHost: `ep-a.us-east-2.aws.neon.tech:5432/${name}` });
    expect(r.ok).toBe(false);
  });

  it("requires --confirm-host, and it must equal host:port/database", () => {
    expect(reason(resolve({ confirmHost: undefined }))).toMatch(/--confirm-host is required.*--confirm-host ep-quiet-wave/);
    expect(reason(resolve({ confirmHost: "" }))).toMatch(/--confirm-host is required/);
    expect(reason(resolve({ confirmHost: "ep-quiet-wave-123456.us-east-2.aws.neon.tech:5432/music_madras_production" }))).toMatch(/does not match/);
    expect(reason(resolve({ confirmHost: "ep-other.us-east-2.aws.neon.tech:5432/music_madras_staging" }))).toMatch(/does not match/);
  });

  it("refuses a database that is also a configured real database, even through its pooled hostname or with options", () => {
    const sameButPooled = `postgresql://u:p@ep-quiet-wave-123456-pooler.us-east-2.aws.neon.tech/music_madras_staging?sslmode=require`;
    expect(reason(resolve({ realUrls: [sameButPooled] }))).toMatch(/same database as a configured DATABASE_URL \/ DIRECT_URL/);
    expect(resolve({ realUrls: ["postgresql://u:p@ep-other.us-east-2.aws.neon.tech/neondb"] }).ok).toBe(true);
  });

  it("never puts the password, the user or the full connection string in any message", () => {
    const messages = [
      reason(resolve({ confirmHost: undefined })),
      reason(resolve({ confirmHost: "x" })),
      reason(resolve({ realUrls: [STAGING] })),
      reason(resolve({ url: `postgresql://app_user:${PASSWORD}@ep-quiet-wave-123456-pooler.us-east-2.aws.neon.tech:5432/music_madras_staging`, confirmHost: undefined })),
      reason(resolve({ url: `postgresql://app_user:${PASSWORD}@db.example.com:5432/music_madras_staging` })),
      reason(resolve({ url: `postgresql://app_user:${PASSWORD}@ep-a.us-east-2.aws.neon.tech:5432/music_madras_test` })),
      reason(resolve({ url: `${STAGING}?sslmode=require` })),
    ];
    for (const m of messages) {
      expect(m.length).toBeGreaterThan(0);
      expect(m).not.toContain(PASSWORD);
      expect(m).not.toContain("app_user");
      expect(m).not.toContain(STAGING);
    }
  });
});

describe("the connection string handed to the application's client", () => {
  it("is built from the validated fields, requires TLS, and encodes special characters", () => {
    const text = buildStagingConnectionString({ host: "ep-a.us-east-2.aws.neon.tech", port: 5432, database: "music_madras_staging", user: "app user", password: "p@ss/w:rd" });
    expect(text).toBe("postgresql://app%20user:p%40ss%2Fw%3Ard@ep-a.us-east-2.aws.neon.tech:5432/music_madras_staging?sslmode=require");
    expect(new URL(text).hostname).toBe("ep-a.us-east-2.aws.neon.tech");
  });
});
