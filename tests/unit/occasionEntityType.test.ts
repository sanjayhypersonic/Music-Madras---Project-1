import { describe, expect, it } from "vitest";
import {
  isSupportedOccasionEntityType,
  OCCASION_ENTITY_TYPES,
  UnsupportedOccasionEntityTypeError,
} from "../../modules/mmke/occasion/occasionEntityType";

// Phase 6G-12 — the V1-supported Occasion entity-type set is exactly
// PROGRAMME/PERFORMANCE/RECORDING/COLLECTION, and never WORK or VIDEO
// (see occasionEntityType.ts's own comment for why).

describe("OCCASION_ENTITY_TYPES", () => {
  it("is exactly the four V1-supported types", () => {
    expect([...OCCASION_ENTITY_TYPES].sort()).toEqual(["COLLECTION", "PERFORMANCE", "PROGRAMME", "RECORDING"]);
  });

  it("never includes WORK or VIDEO", () => {
    expect(OCCASION_ENTITY_TYPES).not.toContain("WORK");
    expect(OCCASION_ENTITY_TYPES).not.toContain("VIDEO");
  });
});

describe("isSupportedOccasionEntityType", () => {
  it("accepts every V1-supported type", () => {
    for (const type of OCCASION_ENTITY_TYPES) {
      expect(isSupportedOccasionEntityType(type)).toBe(true);
    }
  });

  it("rejects unsupported types, including WORK and VIDEO", () => {
    expect(isSupportedOccasionEntityType("WORK")).toBe(false);
    expect(isSupportedOccasionEntityType("VIDEO")).toBe(false);
    expect(isSupportedOccasionEntityType("COMPOSER")).toBe(false);
    expect(isSupportedOccasionEntityType("")).toBe(false);
    expect(isSupportedOccasionEntityType("programme")).toBe(false); // case-sensitive — never a loose match
  });
});

describe("UnsupportedOccasionEntityTypeError", () => {
  it("names the rejected type and lists the supported ones", () => {
    const err = new UnsupportedOccasionEntityTypeError("WORK");
    expect(err.message).toContain("WORK");
    expect(err.message).toContain("PROGRAMME");
    expect(err.message).toContain("COLLECTION");
  });
});
