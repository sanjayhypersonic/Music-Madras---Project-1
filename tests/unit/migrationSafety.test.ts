import { readdirSync, readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { classifyMigrationSql, isAdditiveOnly, splitSqlStatements, summariseFindings } from "../../modules/ops/migrationSafety";

// Migration safety: whether a migration can be rolled back by redeploying the previous code (expand-then-contract), and a ratchet so a new destructive migration cannot
// reach a release without someone naming it here.

const severities = (sql: string) => classifyMigrationSql(sql).map((f) => f.severity);

describe("splitSqlStatements", () => {
  it("splits on top-level semicolons and ignores comments, quotes and dollar-quoted bodies", () => {
    const sql = `-- a comment; with a semicolon
CREATE TABLE "a" ("x" TEXT); /* block; comment */
INSERT INTO "a" VALUES ('semi;colon');
CREATE FUNCTION f() RETURNS int AS $$ BEGIN RETURN 1; END; $$ LANGUAGE plpgsql;`;
    const statements = splitSqlStatements(sql);
    expect(statements).toHaveLength(3);
    expect(statements[1]).toContain("semi;colon");
    expect(statements[2]).toContain("RETURN 1; END;");
  });
});

describe("classifyMigrationSql", () => {
  it("additive changes are silent: new tables, indexes and foreign keys on them, nullable or defaulted columns, enum values, foreign keys", () => {
    const sql = `
CREATE TYPE "K" AS ENUM ('A');
CREATE TABLE "t" ("id" TEXT NOT NULL, "n" INTEGER NOT NULL DEFAULT 0, CONSTRAINT "t_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "t_n_key" ON "t"("n");
CREATE INDEX "t_idx" ON "t"("id");
ALTER TABLE "existing" ADD COLUMN "a" TEXT, ADD COLUMN "b" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "existing" ADD CONSTRAINT "fk" FOREIGN KEY ("a") REFERENCES "t"("id") ON DELETE SET NULL;
ALTER TYPE "K" ADD VALUE 'B';
ALTER TABLE "existing" ALTER COLUMN "a" DROP NOT NULL;`;
    expect(classifyMigrationSql(sql)).toEqual([]);
    expect(isAdditiveOnly(classifyMigrationSql(sql))).toBe(true);
  });

  it("data loss or breaking the previous release is BLOCKING", () => {
    for (const sql of [
      `DROP TABLE "t"`,
      `ALTER TABLE "t" DROP COLUMN "c"`,
      `ALTER TABLE "t" DROP "c"`,
      `TRUNCATE "t"`,
      `DELETE FROM "t" WHERE true`,
      `ALTER TABLE "t" RENAME COLUMN "a" TO "b"`,
      `ALTER TABLE "t" ALTER COLUMN "a" TYPE INTEGER`,
      `ALTER TABLE "t" ALTER COLUMN "a" SET NOT NULL`,
      `ALTER TABLE "t" ADD COLUMN "a" TEXT NOT NULL`,
      `DROP TYPE "K"`,
      `ALTER TYPE "K" RENAME VALUE 'A' TO 'B'`,
    ]) {
      expect(severities(sql), sql).toContain("BLOCKING");
      expect(isAdditiveOnly(classifyMigrationSql(sql)), sql).toBe(false);
    }
  });

  it("things that can reject the previous release's writes, or rewrite data, are REVIEW, not blocking", () => {
    for (const sql of [
      `UPDATE "t" SET "a" = 1`,
      `DROP INDEX "i"`,
      `CREATE UNIQUE INDEX "t_a_key" ON "t"("a")`, // t is not created in this migration
      `ALTER TABLE "t" ADD CONSTRAINT "c" CHECK ("a" > 0)`,
      `ALTER TABLE "t" ADD CONSTRAINT "u" UNIQUE ("a")`,
      `ALTER TABLE "t" ALTER COLUMN "a" DROP DEFAULT`,
    ]) {
      expect(severities(sql), sql).toEqual(["REVIEW"]);
    }
  });

  it("a constraint or unique index on a table CREATED in the same migration is not flagged (nothing wrote to it yet)", () => {
    const sql = `CREATE TABLE "n" ("id" TEXT NOT NULL, "k" TEXT NOT NULL); CREATE UNIQUE INDEX "n_k_key" ON "n"("k"); ALTER TABLE "n" ADD CONSTRAINT "c" CHECK ("k" <> '');`;
    expect(classifyMigrationSql(sql)).toEqual([]);
  });

  it("reports counts, and a statement is shortened to one line", () => {
    const findings = classifyMigrationSql(`DROP TABLE "a";\nUPDATE "b"\n  SET "x" = 1;`);
    expect(summariseFindings(findings)).toEqual({ blocking: 1, review: 1 });
    expect(findings.every((f) => !f.statement.includes("\n"))).toBe(true);
  });
});

describe("the repository's own migrations (a ratchet)", () => {
  const dir = path.resolve(__dirname, "../../prisma/migrations");
  const names = readdirSync(dir).filter((n) => /^\d{14}_/.test(n)).sort();

  // Migrations that were NOT additive and have long since been applied (the September slug back-fills: add a nullable slug, fill it, then make it NOT NULL).
  // A new migration with a BLOCKING statement must be added here WITH a reason, which is the moment someone decides that its release cannot be rolled back by
  // redeploying the previous code and that a restore point is the rollback instead.
  const ACKNOWLEDGED_BLOCKING: Record<string, string> = {
    "20260925003307_phase6g8_add_performance_slug": "back-fill then SET NOT NULL (applied before launch planning)",
    "20260925011306_phase6g9_add_participant_slugs": "back-fill then SET NOT NULL (applied before launch planning)",
    "20260927120000_phase6g14_add_organisation_slug": "back-fill then SET NOT NULL (applied before launch planning)",
  };

  it("every migration with a BLOCKING statement is acknowledged by name, and every acknowledgement still applies", () => {
    const blocking = names.filter((n) => classifyMigrationSql(readFileSync(path.join(dir, n, "migration.sql"), "utf8")).some((f) => f.severity === "BLOCKING"));
    expect(blocking).toEqual(Object.keys(ACKNOWLEDGED_BLOCKING).sort());
  });

  it("the migrations added since the launch-readiness work began are all additive (the previous release can run on them)", () => {
    for (const n of names.filter((name) => name >= "20261021000000")) {
      expect(isAdditiveOnly(classifyMigrationSql(readFileSync(path.join(dir, n, "migration.sql"), "utf8"))), n).toBe(true);
    }
  });
});
