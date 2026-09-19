import { describe, expect, it } from "vitest";
import { dedupeById, formatComposerCredit } from "../../modules/mmke/relationships/formatComposerCredit";

describe("dedupeById", () => {
  it("removes duplicate entries by id, keeping one", () => {
    const result = dedupeById([
      { id: "1", name: "Bach" },
      { id: "2", name: "Mozart" },
      { id: "1", name: "Bach" },
    ]);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.id).sort()).toEqual(["1", "2"]);
  });
});

describe("formatComposerCredit", () => {
  it("returns an empty string for no names", () => {
    expect(formatComposerCredit([])).toBe("");
  });

  it("returns the single name unchanged", () => {
    expect(formatComposerCredit(["J.S. Bach"])).toBe("J.S. Bach");
  });

  it("joins two names with 'and'", () => {
    expect(formatComposerCredit(["J.S. Bach", "G.F. Handel"])).toBe("J.S. Bach and G.F. Handel");
  });

  it("joins three or more names with commas and a final 'and'", () => {
    expect(formatComposerCredit(["Bach", "Handel", "Mozart"])).toBe("Bach, Handel, and Mozart");
  });

  it("deduplicates repeated names while preserving first-seen order", () => {
    expect(formatComposerCredit(["Bach", "Handel", "Bach"])).toBe("Bach and Handel");
  });
});
