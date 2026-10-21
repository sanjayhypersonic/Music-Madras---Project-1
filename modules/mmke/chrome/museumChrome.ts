import { resolveEditorialBlocks } from "../../db/repositories/editorialContentRepository";
import { hasPublishedPlaylistPage } from "../../db/repositories/playlistPageRepository";

// Phase 6K fix (F8) — what the Museum's page frame (header, footer) needs from the database: the footer tagline, and which optional destinations
// currently exist (the About anchor, the Playlists index). It runs on every public page view, including a request for a page that turns out not to
// exist, so it must be CHEAP and must not be a way for anonymous traffic to make the database work:
//   - at most two small queries, run together;
//   - remembered in this server instance for a short time (CHROME_TTL_MS), so a burst of requests — including a scan of random URLs that all
//     answer 404 — costs one refresh, not one per request; concurrent callers share the one refresh in flight;
//   - a failed read is never remembered and never breaks the page: the optional pieces are simply omitted;
//   - the site-wide 404 for URLs that match no route at all uses the STATIC frame and touches no database.
// This cache holds only navigation chrome. It never holds, and never decides, whether any video or page is public: those are read per request.

export interface MuseumChrome {
  tagline: string | null;
  /** Content keys that exist now: published block slugs ("museum-home-story", …) and "playlists". */
  availableContent: ReadonlySet<string>;
}

export const STATIC_CHROME: MuseumChrome = { tagline: null, availableContent: new Set() };

/** A technical bound on how stale optional navigation chrome may be (a tagline or a nav link can lag by this long, nothing else can). */
export const CHROME_TTL_MS = 30_000;

let cached: { at: number; value: MuseumChrome } | null = null;
let inflight: Promise<MuseumChrome> | null = null;

async function load(): Promise<MuseumChrome> {
  const [blocks, hasPlaylists] = await Promise.all([resolveEditorialBlocks(["museum-footer-tagline", "museum-home-story"]), hasPublishedPlaylistPage()]);
  const available = new Set<string>(blocks.keys());
  if (hasPlaylists) available.add("playlists");
  return { tagline: blocks.get("museum-footer-tagline")?.title ?? null, availableContent: available };
}

export async function getMuseumChrome(nowMs: number = Date.now()): Promise<MuseumChrome> {
  if (cached && nowMs - cached.at < CHROME_TTL_MS) return cached.value;
  if (!inflight) {
    inflight = load()
      .then((value) => {
        cached = { at: nowMs, value };
        return value;
      })
      .catch(() => STATIC_CHROME) // not remembered: the next request tries again
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

/** Test-only: forget what is remembered. */
export function resetMuseumChromeForTests(): void {
  cached = null;
  inflight = null;
}