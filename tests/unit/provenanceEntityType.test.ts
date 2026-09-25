import { describe, expect, it } from "vitest";
import {
  isSupportedProvenanceEntityType,
  PROVENANCE_ENTITY_TYPES,
  UnsupportedProvenanceEntityTypeError,
} from "../../modules/mmke/provenance/provenanceEntityType";

// Phase 6G-13 — the V1-supported provenance entity-type set is exactly
// COMPOSER/WORK/RECORDING, and never any other canonical entity.

describe("PROVENANCE_ENTITY_TYPES", () => {
  it("is exactly the three V1-supported types", () => {
    expect([...PROVENANCE_ENTITY_TYPES].sort()).toEqual(["COMPOSER", "RECORDING", "WORK"]);
  });

  it("never includes any other canonical entity", () => {
    for (const excluded of ["PROGRAMME", "PERFORMANCE", "COLLECTION", "OCCASION", "VIDEO", "VENUE", "ARTIST", "CHOIR", "CONDUCTOR", "ORGANISATION"]) {
      expect(PROVENANCE_ENTITY_TYPES).not.toContain(excluded);
    }
  });
});

describe("isSupportedProvenanceEntityType", () => {
  it("accepts every V1-supported type", () => {
    for (const type of PROVENANCE_ENTITY_TYPES) {
      expect(isSupportedProvenanceEntityType(type)).toBe(true);
    }
  });

  it("rejects unsupported types", () => {
    expect(isSupportedProvenanceEntityType("PROGRAMME")).toBe(false);
    expect(isSupportedProvenanceEntityType("VIDEO")).toBe(false);
    expect(isSupportedProvenanceEntityType("")).toBe(false);
    expect(isSupportedProvenanceEntityType("composer")).toBe(false); // case-sensitive
  });
});

describe("UnsupportedProvenanceEntityTypeError", () => {
  it("names the rejected type and lists the supported ones", () => {
    const err = new UnsupportedProvenanceEntityTypeError("PROGRAMME");
    expect(err.message).toContain("PROGRAMME");
    expect(err.message).toContain("COMPOSER");
    expect(err.message).toContain("WORK");
    expect(err.message).toContain("RECORDING");
  });
});
