import { describe, expect, it } from "vitest";
import { deriveLearningGuideExcerpt } from "../../modules/mmke/learningGuide/deriveLearningGuideExcerpt";

describe("deriveLearningGuideExcerpt", () => {
  it("returns null for null content", () => {
    expect(deriveLearningGuideExcerpt(null)).toBeNull();
  });

  it("returns null for whitespace-only content", () => {
    expect(deriveLearningGuideExcerpt("   \n\n  ")).toBeNull();
  });

  it("returns short content unchanged, stripped of markdown syntax", () => {
    expect(deriveLearningGuideExcerpt("# Introduction\n\nThis is a **short** guide.")).toBe("Introduction This is a short guide.");
  });

  it("strips links down to their text", () => {
    expect(deriveLearningGuideExcerpt("See [Handel](https://example.com) for more.")).toBe("See Handel for more.");
  });

  it("truncates long content at a word boundary and appends an ellipsis", () => {
    const long = "word ".repeat(100).trim();
    const result = deriveLearningGuideExcerpt(long, 50);
    expect(result).not.toBeNull();
    expect(result!.length).toBeLessThanOrEqual(51);
    expect(result!.endsWith("…")).toBe(true);
    expect(result!.includes(" ")).toBe(true);
  });

  it("respects a custom maxLength", () => {
    const result = deriveLearningGuideExcerpt("abcdefghij", 5);
    expect(result).toBe("abcde…");
  });
});
