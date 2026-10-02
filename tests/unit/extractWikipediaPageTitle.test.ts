import { describe, expect, it } from "vitest";
import { extractWikipediaPageTitle, isWikipediaSourceUrl } from "../../modules/ai/retrieval/wikipedia/extractWikipediaPageTitle";

// Phase 6H-9 — deterministic, DB-free tests proving Wikipedia page identity
// is derived strictly from an already-registered Source.url, never guessed,
// searched for, or supplied dynamically.

describe("extractWikipediaPageTitle", () => {
  it("extracts and decodes the page title from a well-formed en.wikipedia.org URL", () => {
    expect(extractWikipediaPageTitle("https://en.wikipedia.org/wiki/George_Frideric_Handel")).toBe("George_Frideric_Handel");
  });

  it("percent-decodes a title containing encoded characters", () => {
    expect(extractWikipediaPageTitle("https://en.wikipedia.org/wiki/Caf%C3%A9")).toBe("Café");
  });

  it("returns null for a non-Wikipedia URL", () => {
    expect(extractWikipediaPageTitle("https://example.org/wiki/George_Frideric_Handel")).toBeNull();
  });

  it("returns null for a different-language Wikipedia subdomain", () => {
    expect(extractWikipediaPageTitle("https://fr.wikipedia.org/wiki/George_Frideric_Handel")).toBeNull();
  });

  it("returns null for a Wikipedia URL that is not a /wiki/ page path", () => {
    expect(extractWikipediaPageTitle("https://en.wikipedia.org/w/index.php?title=George_Frideric_Handel")).toBeNull();
  });

  it("returns null for a URL with a query string or fragment appended", () => {
    expect(extractWikipediaPageTitle("https://en.wikipedia.org/wiki/George_Frideric_Handel?action=history")).toBeNull();
    expect(extractWikipediaPageTitle("https://en.wikipedia.org/wiki/George_Frideric_Handel#Life")).toBeNull();
  });

  it("returns null for a bare Wikipedia homepage URL with no page title", () => {
    expect(extractWikipediaPageTitle("https://en.wikipedia.org/wiki/")).toBeNull();
  });

  it("returns null for null input", () => {
    expect(extractWikipediaPageTitle(null)).toBeNull();
  });

  it("never throws on a malformed percent-encoding", () => {
    expect(() => extractWikipediaPageTitle("https://en.wikipedia.org/wiki/%E0%A4%A")).not.toThrow();
  });
});

describe("isWikipediaSourceUrl", () => {
  it("is true for a recognized Wikipedia page URL and false otherwise", () => {
    expect(isWikipediaSourceUrl("https://en.wikipedia.org/wiki/Johann_Sebastian_Bach")).toBe(true);
    expect(isWikipediaSourceUrl("https://example.org/bach")).toBe(false);
    expect(isWikipediaSourceUrl(null)).toBe(false);
  });
});
