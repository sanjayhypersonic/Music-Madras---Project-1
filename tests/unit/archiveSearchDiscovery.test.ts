import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { ARCHIVE_TYPE_LABELS, buildArchiveHref, normalizeArchiveType } from "../../modules/mmke/archiveSearch/archiveUrlState";
import { SEARCH_MAX_LENGTH } from "../../modules/mmke/search/searchText";

// Unified archive search — the pure pieces and the source-level wiring of the Museum shell. (The database behaviour is in
// tests/integration/archiveSearchDiscovery.test.ts; the ranking rules are in searchRanking.test.ts.)

const root = path.resolve(__dirname, "../..");
const read = (relative: string) => readFileSync(path.join(root, relative), "utf8");

describe("archive URL state for the types added with Occasion pages, Collections and Learning Guides", () => {
  it("labels them and accepts their singular, plural and common spellings, case-insensitively", () => {
    expect(ARCHIVE_TYPE_LABELS).toMatchObject({ collection: "Collections", guide: "Learning Guides", occasion: "Occasions" });
    for (const raw of ["collection", "Collections", "COLLECTION"]) expect(normalizeArchiveType(raw)).toEqual({ type: "collection", invalid: false });
    for (const raw of ["guide", "guides", "learning", "learning-guide", "Learning-Guides"]) expect(normalizeArchiveType(raw)).toEqual({ type: "guide", invalid: false });
    for (const raw of ["occasion", "occasions", " Occasions "]) expect(normalizeArchiveType(raw)).toEqual({ type: "occasion", invalid: false });
  });

  it("still flags an unknown type as invalid instead of guessing, and treats none as 'all'", () => {
    expect(normalizeArchiveType("festivals")).toEqual({ type: null, invalid: true });
    expect(normalizeArchiveType(undefined)).toEqual({ type: null, invalid: false });
    expect(normalizeArchiveType("  ")).toEqual({ type: null, invalid: false });
  });

  it("builds links that carry only what is set", () => {
    expect(buildArchiveHref({ q: "carols", type: "occasion" })).toBe("/archive?q=carols&type=occasion");
    expect(buildArchiveHref({ type: "guide", page: 3 })).toBe("/archive?type=guide&page=3");
    expect(buildArchiveHref({})).toBe("/archive");
  });
});

describe("the Museum-wide search entry", () => {
  const header = read("components/museum/MuseumHeader.tsx");

  it("is a labelled, bounded GET search form to /archive (works without client script, never queries per keystroke)", () => {
    expect(header).toMatch(/<form method="get" action="\/archive" role="search"/);
    expect(header).toMatch(/<label htmlFor="museum-header-search"/);
    expect(header).toMatch(/type="search"/);
    expect(header).toMatch(/name="q"/);
    expect(header).toContain("maxLength={SEARCH_MAX_LENGTH}");
    expect(header).not.toMatch(/onChange|useState|"use client"/); // no per-keystroke work
    expect(SEARCH_MAX_LENGTH).toBe(100);
  });

  it("uses the Museum's own classes and tokens: no colour literals were added to the stylesheet for it", () => {
    const css = read("app/(museum)/museum.css");
    const block = css.slice(css.indexOf(".museum-header__search {"));
    expect(block.length).toBeGreaterThan(100);
    expect(block).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
  });
});

describe("the archive page says what it searches and how it ranks", () => {
  const page = read("app/(museum)/archive/page.tsx");

  it("offers every searchable type as a filter and in the all-types view, and renders each result with its type and canonical page", () => {
    for (const label of ['"Collections"', '"Learning Guides"', '"Occasions"']) expect(page).toContain(label);
    expect(page).toContain("/collections/${result.slug}");
    expect(page).toContain("/learning/${result.slug}");
    expect(page).toContain("/occasions/${result.slug}");
    expect(page).toMatch(/Results are ranked by how\s+closely the title matches/);
  });

  it("has an error boundary for a failed search, and no route-level loading.tsx (it was tried and removed: its streamed reveal did not complete in the browser check)", () => {
    expect(read("app/(museum)/error.tsx").length).toBeGreaterThan(50);
    expect(() => readFileSync(path.join(root, "app/(museum)/archive/loading.tsx"), "utf8")).toThrow();
  });
});
