import { describe, expect, it } from "vitest";
import { ARCHIVE_CATEGORIES } from "../../modules/mmke/homepage/archiveCategories";

// Phase 6G-3: the homepage's "Explore the Archive" section must never link
// to a public route that doesn't exist yet. Every public entity route this
// project has actually shipped goes here as it ships.
const KNOWN_PUBLIC_ROUTE_PREFIXES = ["/videos/"];

function isKnownRoute(href: string): boolean {
  return href === "/" || KNOWN_PUBLIC_ROUTE_PREFIXES.some((prefix) => href.startsWith(prefix));
}

describe("ARCHIVE_CATEGORIES", () => {
  it("never links to a route that has not actually shipped", () => {
    for (const category of ARCHIVE_CATEGORIES) {
      if (category.href !== null) {
        expect(isKnownRoute(category.href), `${category.key} links to unshipped route "${category.href}"`).toBe(true);
      }
    }
  });

  it("has a unique, non-empty key and label for every category", () => {
    const keys = ARCHIVE_CATEGORIES.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const category of ARCHIVE_CATEGORIES) {
      expect(category.key.length).toBeGreaterThan(0);
      expect(category.label.length).toBeGreaterThan(0);
      expect(category.description.length).toBeGreaterThan(0);
    }
  });

  it("currently has no implemented entity routes, so every category is non-clickable", () => {
    // This test is expected to start failing, one category at a time, as
    // real entity routes (composers/works/artists/...) ship — that's the
    // point: it forces a conscious update here rather than a silent drift.
    expect(ARCHIVE_CATEGORIES.every((c) => c.href === null)).toBe(true);
  });
});
