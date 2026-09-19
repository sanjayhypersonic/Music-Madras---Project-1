import { describe, expect, it } from "vitest";
import { slugify } from "../../modules/mmke/slug/slugify";

describe("slugify", () => {
  it("lowercases and hyphenates spaces", () => {
    expect(slugify("Johann Sebastian Bach")).toBe("johann-sebastian-bach");
  });

  it("strips diacritics", () => {
    expect(slugify("Antonín Dvořák")).toBe("antonin-dvorak");
  });

  it("collapses punctuation into single hyphens and trims edges", () => {
    expect(slugify("  St. Andrew's Cathedral!!  ")).toBe("st-andrew-s-cathedral");
  });
});
