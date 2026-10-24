import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { isPlausibleSlug, SLUG_MAX_LENGTH } from "../../modules/mmke/slug/isPlausibleSlug";
import { likeNeedle, normaliseSearchText } from "../../modules/mmke/search/searchText";

// Visitor-controlled input must never become an unhandled error. Found on a production build (2026-10-24): /recordings/%00x and /archive?q=%00 answered HTTP 500 because
// PostgreSQL rejects a NUL byte in text, so one request could fail any public page. A string that could never be a slug is "not found"; control characters in search text are spaces.

const read = (relative: string) => readFileSync(path.resolve(__dirname, "../..", relative), "utf8");
const code = (relative: string) => read(relative).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("isPlausibleSlug", () => {
  it("accepts what a slug can be", () => {
    for (const ok of ["a", "bach-brandenburg-concerto-no-3", "performance-programme-1-venue-2-0d7aadcc", "X".repeat(SLUG_MAX_LENGTH), "café", "கலை"]) expect(isPlausibleSlug(ok), ok).toBe(true);
  });
  it("refuses what could never be one: empty, absurdly long, any control character (NUL, newline, tab, DEL), and anything that is not a string", () => {
    for (const bad of ["", "X".repeat(SLUG_MAX_LENGTH + 1), "a\u0000b", "\u0000", "a\nb", "a\tb", "a\u007fb", "a\u001fb"]) expect(isPlausibleSlug(bad), JSON.stringify(bad)).toBe(false);
    for (const bad of [undefined, null, 5, {}, ["a"]]) expect(isPlausibleSlug(bad), String(bad)).toBe(false);
  });
});

describe("search text", () => {
  it("control characters become spaces, so a NUL byte can never reach the database, and an all-control query is simply empty", () => {
    expect(normaliseSearchText("bach\u0000concerto")).toBe("bach concerto");
    expect(normaliseSearchText("\u0000\u0001\u007f")).toBeUndefined();
    expect(likeNeedle("a\u0000%b")).toBe("a \\%b");
    expect(likeNeedle("\u0000")).toBe("");
    expect(normaliseSearchText("  plain   query ")).toBe("plain query"); // unchanged behaviour for ordinary text
  });
});

describe("every public reader that takes a slug from a URL refuses an impossible slug first (a ratchet)", () => {
  const PUBLIC_READERS: Record<string, string[]> = {
    "modules/db/repositories/entityRelationshipsRepository.ts": [
      "getComposerEntityPageData",
      "getVenueEntityPageData",
      "getPublicWorkPageData",
      "getArtistEntityPageData",
      "getChoirEntityPageData",
      "getConductorEntityPageData",
      "getPublicProgrammePageData",
      "getPublicPerformancePageData",
      "getPublicRecordingPageData",
      "getPublicCollectionPageData",
      "getPublicOrganisationPageData",
      "getPublicLearningGuidePageData",
    ],
    "modules/db/repositories/occasionPageRepository.ts": ["getPublicOccasionPageData"],
    "modules/db/repositories/recordingRepository.ts": ["getPublishedRecordingContextBySlug", "findPublishedRecordingBySlug"],
    "modules/db/repositories/youtubeVideoPageRepository.ts": ["findPublishedBySlug"],
    "modules/db/repositories/playlistPageRepository.ts": ["findPublishedPlaylistBySlug"],
  };

  it("the guard is the first statement of each", () => {
    for (const [file, names] of Object.entries(PUBLIC_READERS)) {
      const src = code(file);
      expect(src, file).toContain('import { isPlausibleSlug } from "../../mmke/slug/isPlausibleSlug"');
      for (const name of names) {
        const at = src.search(new RegExp(`export (async )?function ${name}\\(`));
        expect(at, `${file}: ${name}`).toBeGreaterThan(-1);
        const guardAt = src.indexOf("if (!isPlausibleSlug(slug)) return null;", at);
        expect(guardAt, `${file}: ${name}`).toBeGreaterThan(at);
        // the guard comes before anything touches the database or awaits: only the signature lies between the declaration and it
        const beforeGuard = src.slice(at, guardAt);
        expect(beforeGuard.length, `${file}: ${name}`).toBeLessThan(400);
        expect(beforeGuard, `${file}: ${name}`).not.toMatch(/\bprisma\b|\bawait\b/);
      }
    }
  });

  it("every public Museum route that reads a slug goes through one of these readers (no route queries by slug itself)", () => {
    const routes = [
      "app/(museum)/recordings/[slug]/page.tsx",
      "app/(museum)/works/[slug]/page.tsx",
      "app/(museum)/performances/[slug]/page.tsx",
      "app/(museum)/programmes/[slug]/page.tsx",
      "app/(museum)/venues/[slug]/page.tsx",
      "app/(museum)/composers/[slug]/page.tsx",
      "app/(museum)/occasions/[slug]/page.tsx",
      "app/(museum)/collections/[slug]/page.tsx",
      "app/(museum)/learning/[slug]/page.tsx",
      "app/(museum)/organisations/[slug]/page.tsx",
      "app/(museum)/artists/[slug]/page.tsx",
      "app/(museum)/choirs/[slug]/page.tsx",
      "app/(museum)/conductors/[slug]/page.tsx",
      "app/(museum)/videos/[slug]/page.tsx",
      "app/(museum)/playlists/[slug]/page.tsx",
    ];
    for (const route of routes) {
      const src = code(route);
      expect(src, route).not.toMatch(/prisma\./);
      expect(src, route).toMatch(/(getPublic\w+PageData|get(Composer|Venue|Artist|Choir|Conductor)EntityPageData|findPublishedBySlug|findPublishedPlaylistBySlug)\(/);
    }
  });
});
