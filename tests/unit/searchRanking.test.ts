import { describe, expect, it } from "vitest";
import { RELEVANCE_TIERS, normaliseForRanking, rankCandidates, relevanceTier } from "../../modules/mmke/search/searchRanking";

// Archive search ranking: deterministic and explainable (exact title, prefix, word prefix, contains, other field; then alphabetical, then id).

describe("normaliseForRanking", () => {
  it("ignores case, surrounding and repeated whitespace, and accents on Latin letters", () => {
    expect(normaliseForRanking("  Bach   ")).toBe("bach");
    expect(normaliseForRanking("JOHANN\t Sebastian\n Bach")).toBe("johann sebastian bach");
    expect(normaliseForRanking("Dvořák")).toBe("dvorak");
    expect(normaliseForRanking("Saint-Saëns")).toBe("saint-saens");
  });

  it("keeps the marks of other scripts, where they change the letter (it never strips Tamil or Devanagari vowel signs)", () => {
    expect(normaliseForRanking("சென்னை")).toBe("சென்னை");
    expect(normaliseForRanking("संगीत")).toBe("संगीत");
  });
});

describe("relevanceTier", () => {
  it("orders exact, prefix, word prefix, contains, other field", () => {
    expect(relevanceTier("messiah", "Messiah")).toBe(RELEVANCE_TIERS.EXACT);
    expect(relevanceTier("messiah", "  MESSIAH ")).toBe(RELEVANCE_TIERS.EXACT);
    expect(relevanceTier("mess", "Messiah")).toBe(RELEVANCE_TIERS.PREFIX);
    expect(relevanceTier("mass", "Bach Mass in B minor")).toBe(RELEVANCE_TIERS.WORD_PREFIX);
    expect(relevanceTier("ssia", "Messiah")).toBe(RELEVANCE_TIERS.CONTAINS);
    expect(relevanceTier("handel", "Messiah")).toBe(RELEVANCE_TIERS.OTHER_FIELD); // matched on some other field
    expect(relevanceTier("", "Messiah")).toBe(RELEVANCE_TIERS.OTHER_FIELD);
  });

  it("is accent- and case-insensitive on Latin text", () => {
    expect(relevanceTier("dvorak", "Dvořák")).toBe(RELEVANCE_TIERS.EXACT);
    expect(relevanceTier("DVOR", "Dvořák")).toBe(RELEVANCE_TIERS.PREFIX);
  });
});

describe("rankCandidates", () => {
  it("puts the exact title first, then prefix, word prefix, contains, other-field matches, alphabetical inside a tier", () => {
    const ids = rankCandidates("bach", [
      { id: "6", label: "Suite for Cello (matched on description)" },
      { id: "4", label: "The Bach Choir" },
      { id: "3", label: "Bach Collegium" },
      { id: "5", label: "Abachus Hall" },
      { id: "1", label: "Bach" },
      { id: "2", label: "Bach Cantatas" },
    ]);
    expect(ids).toEqual(["1", "2", "3", "4", "5", "6"]);
  });

  it("returns each record once even when it is reached through several query paths", () => {
    expect(rankCandidates("bach", [{ id: "a", label: "Bach" }, { id: "b", label: "Bach Choir" }, { id: "a", label: "Bach" }, { id: "b", label: "Bach Choir" }])).toEqual(["a", "b"]);
  });

  it("is deterministic: identical labels order by id, and the input order never matters", () => {
    const input = [{ id: "z", label: "Messiah" }, { id: "a", label: "Messiah" }, { id: "m", label: "Messiah" }];
    expect(rankCandidates("messiah", input)).toEqual(["a", "m", "z"]);
    expect(rankCandidates("messiah", [...input].reverse())).toEqual(["a", "m", "z"]);
  });

  it("handles no candidates and a query that normalises to nothing", () => {
    expect(rankCandidates("bach", [])).toEqual([]);
    expect(rankCandidates("   ", [{ id: "b", label: "Beta" }, { id: "a", label: "Alpha" }])).toEqual(["a", "b"]);
  });
});
