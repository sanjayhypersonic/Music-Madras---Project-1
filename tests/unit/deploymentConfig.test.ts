import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { assessDeploymentConfig } from "../../modules/config/deploymentConfig";
import { compareFingerprints, FINGERPRINT_TABLES, INTEGRITY_CHECKS, integrityProblems, isFingerprint, type DatabaseFingerprint } from "../../modules/ops/databaseFingerprint";

// Deployment-time configuration preflight and the backup/recovery fingerprint.

const GOOD = {
  DATABASE_URL: "postgresql://app:pw@ep-pooler.example.net:5432/music_madras",
  DIRECT_URL: "postgresql://app:pw@ep.example.net:5432/music_madras",
  PUBLIC_SITE_URL: "https://museum.example",
  AUTH_URL: "https://museum.example",
  AUTH_SECRET: "0123456789abcdef0123456789abcdef0123456789",
  EMAIL_PROVIDER: "smtp",
  SMTP_URL: "smtps://user:pw@smtp.example.net:465",
  EMAIL_FROM: "studio@museum.example",
  CRON_SECRET: "fedcba9876543210fedcba9876543210fedcba",
};
const problemsOf = (over: Record<string, string | undefined>) => assessDeploymentConfig({ ...GOOD, ...over }).problems.map((p) => p.variable);
const warningsOf = (over: Record<string, string | undefined>) => assessDeploymentConfig({ ...GOOD, ...over }).warnings.map((w) => w.variable);

describe("assessDeploymentConfig", () => {
  it("a complete, correct environment has no problems and no warnings", () => {
    expect(assessDeploymentConfig(GOOD)).toEqual({ problems: [], warnings: [] });
  });

  it("includes every runtime start-up rule (a placeholder secret, a non-https origin, the fake AI provider, test-database variables)", () => {
    expect(problemsOf({ AUTH_SECRET: "replace-with-a-long-random-string" })).toContain("AUTH_SECRET");
    expect(problemsOf({ PUBLIC_SITE_URL: "http://museum.example" })).toContain("PUBLIC_SITE_URL");
    expect(problemsOf({ AI_PROVIDER: "fake" })).toContain("AI_PROVIDER");
    expect(problemsOf({ TEST_DATABASE_URL: "postgresql://x@127.0.0.1/x_test" })).toContain("TEST_DATABASE_URL");
  });

  it("a deployment needs the DIRECT connection string (migrations, build, sync lock), which the runtime alone does not", () => {
    expect(problemsOf({ DIRECT_URL: undefined })).toEqual(["DIRECT_URL"]);
    expect(problemsOf({ DIRECT_URL: "mysql://x/y" })).toContain("DIRECT_URL");
    expect(problemsOf({ DIRECT_URL: "nonsense" })).toContain("DIRECT_URL");
  });

  it("refuses a database that looks like a TEST database in either role, and two roles that name different databases", () => {
    expect(problemsOf({ DATABASE_URL: "postgresql://a:b@h.example.net/music_madras_test" })).toContain("DATABASE_URL");
    expect(problemsOf({ DIRECT_URL: "postgresql://a:b@h.example.net/music_madras_test" })).toContain("DIRECT_URL");
    expect(problemsOf({ DIRECT_URL: "postgresql://a:b@ep.example.net:5432/another_db" })).toContain("DIRECT_URL");
  });

  it("warns, rather than refuses, on things that are usually mistakes: localhost database, identical pooled and direct strings, differing origins, a missing scheduler secret", () => {
    expect(warningsOf({ DATABASE_URL: "postgresql://a:b@127.0.0.1:5432/music_madras" })).toContain("DATABASE_URL");
    expect(warningsOf({ DIRECT_URL: GOOD.DATABASE_URL })).toContain("DATABASE_URL");
    expect(warningsOf({ AUTH_URL: "https://studio.example" })).toContain("AUTH_URL");
    expect(warningsOf({ CRON_SECRET: undefined })).toContain("CRON_SECRET");
    expect(problemsOf({ DATABASE_URL: "postgresql://a:b@127.0.0.1:5432/music_madras" })).toEqual([]);
  });

  it("an SMTP URL that is not smtp:// or smtps:// is a problem; EMAIL_PROVIDER unset is a warning that says a launch needs it", () => {
    expect(problemsOf({ SMTP_URL: "https://mail.example" })).toContain("SMTP_URL");
    expect(problemsOf({ SMTP_URL: "not a url" })).toContain("SMTP_URL");
    const report = assessDeploymentConfig({ ...GOOD, EMAIL_PROVIDER: undefined, SMTP_URL: undefined, EMAIL_FROM: undefined });
    expect(report.problems).toEqual([]);
    expect(report.warnings.find((w) => w.variable === "EMAIL_PROVIDER")!.problem).toMatch(/A launch needs this/);
  });

  it("NEVER puts a value in a message: no secret, URL, host or password appears in any problem or warning", () => {
    const secrets = { ...GOOD, AUTH_SECRET: "short-SECRETVALUE", DATABASE_URL: "postgresql://dbuser:DBPASSWORD@10.9.8.7/leak_test", SMTP_URL: "https://smtpuser:SMTPPASSWORD@mail", PUBLIC_SITE_URL: "http://leakhost.internal", CRON_SECRET: "tiny" };
    const report = JSON.stringify(assessDeploymentConfig(secrets));
    for (const value of ["SECRETVALUE", "DBPASSWORD", "10.9.8.7", "SMTPPASSWORD", "leakhost", "dbuser", "smtpuser"]) expect(report).not.toContain(value);
  });

  it("the preflight script reads only the shell or a named file, parses without loading, opens nothing, and prints no value", () => {
    const src = readFileSync(path.resolve(__dirname, "../../scripts/checkProductionConfig.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    expect(src).toMatch(/parse\(readFileSync\(file\)\)/);
    expect(src).not.toMatch(/dotenv\/config|config\(\)|process\.env\[.*\]\s*=|new Client|fetch\(/);
    expect(src).toMatch(/\$\{p\.variable\}: \$\{p\.problem\}/);
  });
});

describe("database fingerprint (backup and recovery verification)", () => {
  const base: DatabaseFingerprint = {
    takenAt: "2026-10-30T00:00:00.000Z",
    target: "host:5432/db",
    migrations: { applied: 29, latest: "20261024120000_x", failed: [] },
    counts: { recordings: 10, composers: 4 },
    integrity: { publishedWithoutRevision: 0 },
  };

  it("identical fingerprints are verified", () => {
    expect(compareFingerprints(base, structuredClone(base))).toEqual([]);
  });
  it("a differing row count, a missing table, different migrations or any integrity violation is reported", () => {
    const actual = structuredClone(base);
    actual.counts.recordings = 9;
    delete actual.counts.composers;
    actual.migrations = { applied: 28, latest: "20261024100000_y", failed: [] };
    actual.integrity.publishedWithoutRevision = 2;
    const kinds = compareFingerprints(base, actual).map((d) => d.kind).sort();
    expect(kinds).toEqual(["COUNT", "INTEGRITY", "MIGRATIONS", "MISSING_TABLE"]);
  });
  it("a failed or half-applied migration is a problem even with matching counts; a check that could not run (-1) is a violation, never a pass", () => {
    const actual = structuredClone(base);
    actual.migrations.failed = ["20261024120000_x"];
    actual.integrity.holdWithoutTime = -1;
    expect(compareFingerprints(base, actual).map((d) => d.kind)).toEqual(expect.arrayContaining(["MIGRATIONS", "INTEGRITY"]));
    expect(integrityProblems(actual).length).toBe(2);
    expect(integrityProblems(base)).toEqual([]);
  });
  it("recognises its own file format and refuses anything else", () => {
    expect(isFingerprint(base)).toBe(true);
    for (const bad of [null, "x", {}, { takenAt: "x" }, { ...base, counts: null }]) expect(isFingerprint(bad)).toBe(false);
  });
  it("measures counts and migration names only: no check or table reads row content", () => {
    for (const check of INTEGRITY_CHECKS) {
      expect(check.sql, check.name).toMatch(/^select count\(\*\)::int as n from/);
      expect(check.sql, check.name).not.toMatch(/\b(insert|update|delete|drop|alter|truncate)\b/i);
    }
    expect(new Set(INTEGRITY_CHECKS.map((c) => c.name)).size).toBe(INTEGRITY_CHECKS.length);
  });
  it("every fingerprinted table is a real table in the schema (a renamed or removed table fails here, not silently on the day)", () => {
    const schema = readFileSync(path.resolve(__dirname, "../../prisma/schema.prisma"), "utf8");
    const mapped = new Set([...schema.matchAll(/@@map\("([^"]+)"\)/g)].map((m) => m[1]));
    for (const table of FINGERPRINT_TABLES) expect(mapped.has(table), table).toBe(true);
  });
});
