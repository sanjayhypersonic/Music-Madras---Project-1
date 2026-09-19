import { describe, expect, it } from "vitest";
import { ObservabilityState, RevisionStatus, RecordingAggregateStatus } from "@prisma/client";

// This test does NOT touch a database — it only imports the generated
// Prisma Client's runtime enum objects. Its purpose is to protect the
// architecture (ADR §15, §5) against silent schema drift: if someone
// removes or renames a state these ADR sections depend on, this test
// fails at `npm test` time rather than being discovered later in a
// running app. (Exception to the "only modules/db imports Prisma" rule:
// tests are allowed to import generated types directly for verification.)

describe("ObservabilityState enum (ADR §15)", () => {
  it("has exactly the seven states the availability model specifies", () => {
    expect(Object.values(ObservabilityState).sort()).toEqual(
      [
        "OBSERVED",
        "NOT_OBSERVED",
        "PRIVATE",
        "UNLISTED",
        "UNAVAILABLE",
        "DELETED",
        "SYNC_ERROR",
      ].sort()
    );
  });
});

describe("RevisionStatus enum (ADR §5)", () => {
  it("has exactly DRAFT, PUBLISHED, SUPERSEDED", () => {
    expect(Object.values(RevisionStatus).sort()).toEqual(["DRAFT", "PUBLISHED", "SUPERSEDED"].sort());
  });
});

describe("RecordingAggregateStatus enum (ADR §5.1)", () => {
  it("has exactly DRAFT, IN_REVIEW, PUBLISHED, ARCHIVED", () => {
    expect(Object.values(RecordingAggregateStatus).sort()).toEqual(
      ["DRAFT", "IN_REVIEW", "PUBLISHED", "ARCHIVED"].sort()
    );
  });
});
