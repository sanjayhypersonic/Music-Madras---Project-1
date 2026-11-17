import { describe, expect, it } from "vitest";
import { canonicalSlugBase, canonicalSlugCandidates, hasNonLatinScript, resolveCanonicalSlug, truncateSlug } from "../../modules/mmke/slug/canonicalSlug";
import { slugify } from "../../modules/mmke/slug/slugify";

// The slug rule for NEW records (R-31): canonical title, transliteration for a non-Latin title, at most 60 characters, never empty, then the year
// and a number when taken. Latin titles get exactly what slugify always gave them.

describe("canonical slug rule", () => {
  it("builds the slugs of the editor's examples", () => {
    expect(canonicalSlugBase({ title: "பாலன் பிறந்த ராவில்", transliteration: "Paalan Pirandha Raavil", fallback: "recording" })).toBe("paalan-pirandha-raavil");
    expect(canonicalSlugBase({ title: "Dingiri Dingalae", fallback: "recording" })).toBe("dingiri-dingalae");
    expect(canonicalSlugBase({ title: "Christmas Carol Medley", fallback: "recording" })).toBe("christmas-carol-medley");
    expect(canonicalSlugBase({ title: "Come Now, Child of Promise", fallback: "recording" })).toBe("come-now-child-of-promise");
  });

  it("leaves Latin titles as slugify made them, and is never empty", () => {
    for (const t of ["Antonín Dvořák", "St. Andrew's Cathedral", "Blagoslovi Dushe Moya Gospoda"]) expect(canonicalSlugBase({ title: t, fallback: "x" })).toBe(slugify(t));
    expect(canonicalSlugBase({ title: "பாலன் பிறந்த ராவில்", fallback: "recording" })).toBe("recording");
    expect(canonicalSlugBase({ title: "   ", fallback: "" })).toBe("record");
    expect(hasNonLatinScript("Dvořák")).toBe(false);
    expect(hasNonLatinScript("பாலன்")).toBe(true);
  });

  it("cuts a long title at a word boundary within 60 characters", () => {
    const long = "Come Now Child of Promise Bishop Heber Chapel Choir Madras Christian College Carols 2025";
    const slug = canonicalSlugBase({ title: long, fallback: "x" });
    expect(slug.length).toBeLessThanOrEqual(60);
    expect(slug).toBe("come-now-child-of-promise-bishop-heber-chapel-choir-madras");
    expect(truncateSlug("a".repeat(70))).toBe("a".repeat(60));
  });

  it("appends the performance year when taken, then a number; without a year, a number", async () => {
    expect(canonicalSlugCandidates({ title: "Christmas Carol Medley", year: 2025, fallback: "r" }, 4)).toEqual(["christmas-carol-medley", "christmas-carol-medley-2025", "christmas-carol-medley-2025-2", "christmas-carol-medley-2025-3"]);
    expect(canonicalSlugCandidates({ title: "Dingiri Dingalae", fallback: "r" }, 3)).toEqual(["dingiri-dingalae", "dingiri-dingalae-2", "dingiri-dingalae-3"]);
    const taken = new Set(["christmas-carol-medley", "christmas-carol-medley-2025"]);
    await expect(resolveCanonicalSlug({ title: "Christmas Carol Medley", year: "2025", fallback: "r" }, async (s) => taken.has(s))).resolves.toBe("christmas-carol-medley-2025-2");
    await expect(resolveCanonicalSlug({ title: "x", fallback: "r" }, async () => true)).rejects.toThrow(/No free slug/);
  });
});
