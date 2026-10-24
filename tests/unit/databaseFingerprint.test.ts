import { describe, expect, it } from "vitest";
import { INTEGRITY_CHECKS, compareFingerprints, integrityProblems, isCheckApplicable, isFingerprint, type DatabaseFingerprint } from "../../modules/ops/databaseFingerprint";

// The fingerprint's job in the release procedure: taken BEFORE a migration (so it must be able to pass on a database that does not have the newest schema), compared
// AFTER the migration (more migrations and new tables are expected, lost or changed rows are not), and compared after a restore (everything must match).

const HOLDS = "20261024100000_recording_level_holds";
const fp = (over: Partial<DatabaseFingerprint> = {}): DatabaseFingerprint => ({
  takenAt: "2026-10-25T10:00:00.000Z",
  target: "db.example:5432/app",
  migrations: { applied: 26, latest: "20261022150000_phase6k_hardening_partial_steps", failed: [] },
  counts: { recordings: 12, recording_revisions: 20 },
  integrity: { publishedWithoutRevision: 0, holdWithoutTime: null },
  ...over,
});
const after = (over: Partial<DatabaseFingerprint> = {}) =>
  fp({ migrations: { applied: 29, latest: "20261024120000_incident_kind_unhandled_server_error", failed: [] }, counts: { recordings: 12, recording_revisions: 20, operational_incidents: 0 }, integrity: { publishedWithoutRevision: 0, holdWithoutTime: 0 }, ...over });

describe("integrity checks that depend on a migration", () => {
  it("the hold check names the migration that adds holds", () => {
    expect(INTEGRITY_CHECKS.find((c) => c.name === "holdWithoutTime")?.introducedBy).toBe(HOLDS);
  });
  it("is applicable only once that migration is finished", () => {
    const check = INTEGRITY_CHECKS.find((c) => c.name === "holdWithoutTime")!;
    expect(isCheckApplicable(check, new Set())).toBe(false);
    expect(isCheckApplicable(check, new Set([HOLDS]))).toBe(true);
    expect(isCheckApplicable({}, new Set())).toBe(true);
  });
});

describe("a pre-change fingerprint", () => {
  it("passes on its own when the only check that could not apply is waiting for a pending migration", () => {
    expect(integrityProblems(fp())).toEqual([]);
  });
  it("still fails for a real violation, and for a check that should have run but could not (-1)", () => {
    expect(integrityProblems(fp({ integrity: { publishedWithoutRevision: 2, holdWithoutTime: null } })).map((d) => d.kind)).toEqual(["INTEGRITY"]);
    expect(integrityProblems(fp({ integrity: { publishedWithoutRevision: 0, holdWithoutTime: -1 } }))[0].message).toMatch(/could not run/);
  });
  it("is still a fingerprint when it holds nulls (and an old saved one with numbers only is too)", () => {
    expect(isFingerprint(fp())).toBe(true);
    expect(isFingerprint(fp({ integrity: { holdWithoutTime: 0 } }))).toBe(true);
  });
});

describe("comparison after a controlled migration (--after-migration)", () => {
  it("accepts more migrations and the tables they add when every earlier count is unchanged and integrity is clean", () => {
    expect(compareFingerprints(fp(), after(), { afterMigration: true })).toEqual([]);
  });
  it("without the option the same two fingerprints differ (the strict comparison used for a restore)", () => {
    const kinds = compareFingerprints(fp(), after()).map((d) => d.kind);
    expect(kinds).toContain("MIGRATIONS");
    expect(kinds).toContain("MISSING_TABLE");
  });
  it("catches a lost or changed row count across the migration", () => {
    const result = compareFingerprints(fp(), after({ counts: { recordings: 11, recording_revisions: 20, operational_incidents: 0 } }), { afterMigration: true });
    expect(result).toEqual([{ kind: "COUNT", message: "recordings: expected 12 rows, found 11" }]);
  });
  it("catches a table that disappeared, fewer migrations than before, a half-applied migration, and an integrity violation", () => {
    expect(compareFingerprints(fp(), after({ counts: { recordings: 12, operational_incidents: 0 } }), { afterMigration: true }).map((d) => d.kind)).toEqual(["MISSING_TABLE"]);
    expect(compareFingerprints(fp(), fp({ migrations: { applied: 25, latest: "20261022140000_x", failed: [] } }), { afterMigration: true }).map((d) => d.message).join("|")).toMatch(/fewer migrations/);
    expect(compareFingerprints(fp(), after({ migrations: { applied: 29, latest: "x", failed: ["20261024100000_recording_level_holds"] } }), { afterMigration: true }).map((d) => d.kind)).toContain("MIGRATIONS");
    expect(compareFingerprints(fp(), after({ integrity: { publishedWithoutRevision: 1, holdWithoutTime: 0 } }), { afterMigration: true }).map((d) => d.kind)).toEqual(["INTEGRITY"]);
  });
});

describe("comparison after a restore (strict)", () => {
  it("identical fingerprints verify; any difference in migrations or counts is reported", () => {
    expect(compareFingerprints(fp(), fp())).toEqual([]);
    expect(compareFingerprints(fp(), fp({ counts: { recordings: 12, recording_revisions: 19 } })).map((d) => d.kind)).toEqual(["COUNT"]);
    expect(compareFingerprints(fp(), fp({ migrations: { applied: 27, latest: "z", failed: [] } })).map((d) => d.kind)).toEqual(["MIGRATIONS"]);
  });
});
