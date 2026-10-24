import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { EXPECTED_MIGRATIONS } from "../../modules/config/expectedMigrations";
import { ROLLBACK_DATA_RISKS, assessPending, assessRollback, assessRollbackDataRisks, compareMigrations, decideApply, describeDatabaseTarget, type ApplyRequest, type AppliedMigrationRow } from "../../modules/ops/migrationPlan";
import { renderManifest } from "../../modules/ops/migrationManifest";
import { readdirSync } from "fs";

// Migration planning for a deployment: what is pending, whether it may be applied, and whether the previous release can run on the resulting schema.

const done = (name: string): AppliedMigrationRow => ({ name, finishedAt: new Date(), rolledBackAt: null });
const SQL = { additive: `ALTER TABLE "t" ADD COLUMN "a" TEXT;`, blocking: `ALTER TABLE "t" DROP COLUMN "a";`, review: `CREATE UNIQUE INDEX "i" ON "t"("a");` };

describe("compareMigrations", () => {
  const shipped = ["001_a", "002_b", "003_c"];
  it("separates applied, pending, failed (half-applied) and ahead-of-this-code", () => {
    const status = compareMigrations(shipped, [done("001_a"), { name: "002_b", finishedAt: null, rolledBackAt: null }, done("999_future")]);
    expect(status).toEqual({ applied: ["001_a"], pending: ["003_c"], failed: ["002_b"], unknownApplied: ["999_future"] });
  });
  it("a rolled-back migration counts as not applied", () => {
    expect(compareMigrations(shipped, [done("001_a"), { name: "002_b", finishedAt: new Date(), rolledBackAt: new Date() }]).pending).toEqual(["002_b", "003_c"]);
  });
  it("an empty database has everything pending", () => {
    expect(compareMigrations(shipped, []).pending).toEqual(shipped);
  });
});

describe("decideApply: the one irreversible step is guarded", () => {
  const target = "db.example:5432/music_madras";
  const request = (over: Partial<ApplyRequest> = {}): ApplyRequest => ({
    status: { applied: [], pending: ["003_c"], failed: [], unknownApplied: [] },
    assessments: assessPending(["003_c"], { "003_c": SQL.additive }),
    actualTarget: target,
    confirmedTarget: target,
    restorePoint: "neon-branch-2026-10-30-release-7",
    acknowledgeBlocking: false,
    ...over,
  });

  it("allows an additive release when the host is confirmed and a restore point is named", () => {
    expect(decideApply(request())).toMatchObject({ allowed: true, refusals: [] });
  });
  it("refuses without --confirm-host, and with a different one (the operator must type the real target)", () => {
    expect(decideApply(request({ confirmedTarget: undefined })).refusals.join(" ")).toContain(`--confirm-host ${target}`);
    expect(decideApply(request({ confirmedTarget: "other:5432/x" })).refusals.join(" ")).toMatch(/does not match/);
  });
  it("refuses without a restore point (migrations are forward-only; that is the rollback)", () => {
    for (const restorePoint of [undefined, "", "  ", "a"]) expect(decideApply(request({ restorePoint })).refusals.join(" "), String(restorePoint)).toMatch(/restore point/);
  });
  it("refuses while a migration is failed or half-applied, and when the database is ahead of this code", () => {
    expect(decideApply(request({ status: { applied: [], pending: ["003_c"], failed: ["002_b"], unknownApplied: [] } })).allowed).toBe(false);
    expect(decideApply(request({ status: { applied: [], pending: ["003_c"], failed: [], unknownApplied: ["999_future"] } })).refusals.join(" ")).toMatch(/ahead of this release/);
  });
  it("refuses a BLOCKING migration unless it is acknowledged, and then says the rollback is the restore point", () => {
    const blocking = assessPending(["004_d"], { "004_d": SQL.blocking });
    expect(decideApply(request({ assessments: blocking })).allowed).toBe(false);
    const acknowledged = decideApply(request({ assessments: blocking, acknowledgeBlocking: true }));
    expect(acknowledged.allowed).toBe(true);
    expect(acknowledged.notes.join(" ")).toMatch(/restore point, not the previous deployment/);
  });
  it("a REVIEW migration is allowed but flagged for rehearsal on real data", () => {
    const d = decideApply(request({ assessments: assessPending(["005_e"], { "005_e": SQL.review }) }));
    expect(d.allowed).toBe(true);
    expect(d.notes.join(" ")).toMatch(/rehearse/);
  });
  it("a migration whose SQL cannot be read is treated as blocking, never as additive", () => {
    expect(assessPending(["006_f"], {})[0]).toMatchObject({ additiveOnly: false });
  });
  it("every refusal is something the operator can act on, and none contains a connection string", () => {
    const refusals = decideApply(request({ confirmedTarget: "x", restorePoint: undefined })).refusals.join("\n");
    expect(refusals).not.toMatch(/postgres(ql)?:\/\//);
  });
});

describe("assessRollback: can traffic return to the previous release?", () => {
  it("is safe when everything the previous release does not know is additive", () => {
    const r = assessRollback({ previousShipped: ["001_a"], databaseFinished: ["001_a", "002_b"], sqlByName: { "002_b": SQL.additive } });
    expect(r).toMatchObject({ compatible: true, reasons: [], missingForPrevious: [] });
  });
  it("is NOT safe when a newer migration is blocking, or when the database lacks something the previous release needs", () => {
    expect(assessRollback({ previousShipped: ["001_a"], databaseFinished: ["001_a", "002_b"], sqlByName: { "002_b": SQL.blocking } }).compatible).toBe(false);
    const behind = assessRollback({ previousShipped: ["001_a", "002_b"], databaseFinished: ["001_a"], sqlByName: {} });
    expect(behind.compatible).toBe(false);
    expect(behind.missingForPrevious).toEqual(["002_b"]);
  });
  it("a migration unknown to this checkout cannot be vouched for", () => {
    expect(assessRollback({ previousShipped: ["001_a"], databaseFinished: ["001_a", "999_future"], sqlByName: {} }).compatible).toBe(false);
  });
});

describe("describeDatabaseTarget never exposes credentials", () => {
  it("returns host:port/database only", () => {
    expect(describeDatabaseTarget("postgresql://user:s3cret@ep-x-pooler.eu.example.net/music_madras?sslmode=require")).toBe("ep-x-pooler.eu.example.net:5432/music_madras");
    expect(describeDatabaseTarget("postgres://u:p@127.0.0.1:54329/db_test")).toBe("127.0.0.1:54329/db_test");
    expect(describeDatabaseTarget("postgresql://user:s3cret@host/music_madras")).not.toContain("s3cret");
    expect(describeDatabaseTarget("not a url")).toBeNull();
    expect(describeDatabaseTarget("postgresql://host")).toBeNull();
  });
});

describe("the migration manifest compiled into the code", () => {
  const dir = path.resolve(__dirname, "../../prisma/migrations");
  const onDisk = readdirSync(dir).filter((n) => /^\d{14}_/.test(n));

  it("lists exactly the migrations on disk (regenerate with `npm run migrations:manifest`; this fails when the committed file is stale)", () => {
    expect([...EXPECTED_MIGRATIONS]).toEqual([...onDisk].sort());
    const committed = readFileSync(path.resolve(__dirname, "../../modules/config/expectedMigrations.ts"), "utf8").replace(/\r\n/g, "\n");
    expect(committed).toBe(renderManifest(onDisk));
  });
  it("renders sorted, one name per line, with no duplicates", () => {
    const text = renderManifest(["b", "a", "c"]);
    expect(text.indexOf('"a"')).toBeLessThan(text.indexOf('"b"'));
    expect(new Set(EXPECTED_MIGRATIONS).size).toBe(EXPECTED_MIGRATIONS.length);
  });
});

describe("the operator scripts' safety properties (source level)", () => {
  const read = (file: string) => readFileSync(path.resolve(__dirname, "../..", file), "utf8");
  const code = (file: string) => read(file).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("migrate.ts and verifyDatabase.ts never read DATABASE_URL or DIRECT_URL as their target, never load a .env, and never print a connection string", () => {
    for (const file of ["scripts/migrate.ts", "scripts/verifyDatabase.ts"]) {
      const src = code(file);
      expect(src, file).not.toMatch(/process\.env\.(DATABASE_URL|DIRECT_URL)\b/);
      expect(src, file).not.toMatch(/dotenv\/config|config\(\)\s*;/);
      expect(src, file).not.toMatch(/console\.(log|error)\([^)]*\b(url|connectionString)\b/);
    }
  });
  it("every database read in these scripts is inside a READ ONLY transaction, and verifyDatabase has no write statement at all", () => {
    expect(code("scripts/migrate.ts")).toMatch(/BEGIN READ ONLY/);
    expect(code("scripts/verifyDatabase.ts")).toMatch(/BEGIN READ ONLY/);
    expect(code("scripts/verifyDatabase.ts")).not.toMatch(/\b(insert|update|delete|drop|alter|truncate|create)\s/i);
    expect(code("modules/ops/databaseFingerprint.ts").replace(/`[^`]*`/g, "")).not.toMatch(/\b(insert|update|delete|drop|alter|truncate)\s/i);
  });
  it("only the guarded apply command runs the migration CLI, and the CLI is given the target explicitly and cannot read the repository's .env", () => {
    const src = code("scripts/migrate.ts");
    expect((src.match(/spawnSync\(/g) ?? []).length).toBe(1);
    expect(src).toMatch(/DOTENV_CONFIG_PATH:\s*emptyDotenv/);
    expect(src.indexOf("decideApply(")).toBeLessThan(src.indexOf("spawnSync("));
    expect(src.indexOf("if (!decision.allowed) refuse(")).toBeLessThan(src.indexOf("spawnSync("));
  });
});

describe("assessRollbackDataRisks: a schema-compatible rollback can still stop protecting data", () => {
  const HOLDS = "20261024100000_recording_level_holds";
  const VIDEO = "20261021110000_phase6k2_video_exposure_approvals_and_review";
  const REL = "20261020120000_phase6j11b_recording_revision_relationships";
  const all = [REL, VIDEO, HOLDS];
  const counts = (over: Record<string, number | null> = {}) => ({ "recording-holds": 0, "video-exposure-holds": 0, "revision-scoped-relationships": 0, ...over });

  it("names a Recording hold as BLOCKING when the previous release has no holds, and says what would happen", () => {
    const findings = assessRollbackDataRisks([], all, counts({ "recording-holds": 2 }));
    expect(findings.blocking).toHaveLength(1);
    expect(findings.blocking[0]).toMatch(/2 Recording\(s\) are on hold.*show them/);
  });

  it("no rows, no finding; a risk for data the previous release understands (or the database never had) is skipped", () => {
    expect(assessRollbackDataRisks([], all, counts())).toEqual({ blocking: [], warnings: [] });
    expect(assessRollbackDataRisks([HOLDS], all, counts({ "recording-holds": 5 }))).toEqual({ blocking: [], warnings: [] });
    expect(assessRollbackDataRisks([], [REL], counts({ "recording-holds": 5 }))).toEqual({ blocking: [], warnings: [] });
  });

  it("video holds block; revision-scoped relationships only warn", () => {
    const findings = assessRollbackDataRisks([], all, counts({ "video-exposure-holds": 1, "revision-scoped-relationships": 9 }));
    expect(findings.blocking).toHaveLength(1);
    expect(findings.warnings).toHaveLength(1);
    expect(findings.warnings[0]).toMatch(/9 revision-scoped/);
  });

  it("a count that could not be taken is BLOCKING: unknown is not safe", () => {
    expect(assessRollbackDataRisks([], all, counts({ "recording-holds": null })).blocking[0]).toMatch(/could not run/);
  });

  it("every risk names a migration this code actually ships, and a read-only query", () => {
    const shipped = new Set(readdirSync(path.resolve(__dirname, "../../prisma/migrations")));
    for (const risk of ROLLBACK_DATA_RISKS) {
      expect(shipped.has(risk.introducedBy), risk.id).toBe(true);
      expect(risk.sql.trim().toLowerCase().startsWith("select"), risk.id).toBe(true);
      expect(risk.sql).not.toMatch(/\b(insert|update|delete|drop|alter|truncate)\b/i);
    }
  });
});
