import { describe, expect, it } from "vitest";
import {
  findExactNormalizedDuplicate,
  normalizeNameForComparison,
} from "../../modules/mmke/duplicate-detection/detectDuplicateName";

describe("normalizeNameForComparison", () => {
  it("trims, lowercases, and collapses internal whitespace", () => {
    expect(normalizeNameForComparison("  Johann   Sebastian Bach  ")).toBe("johann sebastian bach");
  });
});

describe("findExactNormalizedDuplicate", () => {
  const existing = ["Johann Sebastian Bach", "Wolfgang Amadeus Mozart"];

  it("finds a duplicate that differs only in case/whitespace", () => {
    expect(findExactNormalizedDuplicate("johann sebastian bach", existing)).toBe(
      "Johann Sebastian Bach"
    );
    expect(findExactNormalizedDuplicate("  Johann Sebastian   Bach", existing)).toBe(
      "Johann Sebastian Bach"
    );
  });

  it("does not flag a genuinely different name", () => {
    expect(findExactNormalizedDuplicate("George Frideric Handel", existing)).toBeNull();
  });

  it("deliberately does not catch near-duplicates like abbreviations (fuzzy matching is a later phase)", () => {
    expect(findExactNormalizedDuplicate("J.S. Bach", existing)).toBeNull();
  });
});
