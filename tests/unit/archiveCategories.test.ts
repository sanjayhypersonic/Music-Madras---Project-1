import { describe, expect, it } from "vitest";
import { ARCHIVE_CATEGORIES, CONTINUE_EXPLORING_LINKS } from "../../modules/mmke/homepage/archiveCategories";
import { ARCHIVE_TYPE_LABELS } from "../../modules/mmke/archiveSearch/archiveUrlState";

// Phase 6G-3: the homepage's "Explore the Archive" section must never link
// to a public route that doesn't exist yet.
//
// Phase 6G-11: every category and "Continue Exploring" pathway now has a
// real destination — either a canonical /archive?type= filter (using the
// exact ArchiveEntityType values from archiveSearchContract.ts, the same
// source of truth /archive itself reads) or the dedicated /collections
// index. This test asserts against that same source of truth rather than
// a hardcoded string list, so a future renamed/removed archive type would
// fail this test instead of silently producing a dead link.
const KNOWN_ARCHIVE_TYPES = new Set(Object.keys(ARCHIVE_TYPE_LABELS));

function isKnownRoute(href: string): boolean {
  if (href === "/" || href === "/collections") return true;
  const match = href.match(/^\/archive\?type=([a-z]+)$/);
  return match !== null && KNOWN_ARCHIVE_TYPES.has(match[1]);
}

describe("ARCHIVE_CATEGORIES", () => {
  it("never links to a route that has not actually shipped", () => {
    for (const category of ARCHIVE_CATEGORIES) {
      expect(isKnownRoute(category.href), `${category.key} links to unshipped route "${category.href}"`).toBe(true);
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

  it("gives every category a real, non-empty href — no category is left unclickable", () => {
    for (const category of ARCHIVE_CATEGORIES) {
      expect(category.href.length).toBeGreaterThan(0);
    }
  });

  it("still has exactly the same nine categories — this phase never adds or removes one", () => {
    expect(ARCHIVE_CATEGORIES.map((c) => c.key).sort()).toEqual(
      ["choirs", "collections", "composers", "conductors", "performances", "performers", "recordings", "venues", "works"].sort()
    );
  });

  it("routes the Collections category to the dedicated /collections index, not /archive", () => {
    const collections = ARCHIVE_CATEGORIES.find((c) => c.key === "collections");
    expect(collections?.href).toBe("/collections");
  });
});

describe("CONTINUE_EXPLORING_LINKS", () => {
  it("never links to a route that has not actually shipped", () => {
    for (const link of CONTINUE_EXPLORING_LINKS) {
      expect(isKnownRoute(link.href), `"${link.label}" links to unshipped route "${link.href}"`).toBe(true);
    }
  });

  it("has a unique, non-empty label and href for every pathway", () => {
    const labels = CONTINUE_EXPLORING_LINKS.map((l) => l.label);
    expect(new Set(labels).size).toBe(labels.length);
    for (const link of CONTINUE_EXPLORING_LINKS) {
      expect(link.label.length).toBeGreaterThan(0);
      expect(link.href.length).toBeGreaterThan(0);
    }
  });
});
