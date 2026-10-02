// Phase 6H-9 — deterministically identifies the Wikipedia page a registered
// Source refers to, from its already-stored `url` column. No schema change
// was needed for this (brief: "If the existing Source model needs a clean
// way to represent the external provider/page identity, inspect the
// existing schema first" — `url` already does, so none was added).
//
// Deliberately strict: only `https://en.wikipedia.org/wiki/<title>` is
// recognized (no other language subdomain, no query string, no fragment,
// no `/w/index.php?title=`-style URL, no redirect-following). This is the
// one real external provider this phase builds, not a generalized
// "resolve anything that looks like a Wikipedia link" parser — a Source
// whose url does not match exactly is correctly classified
// UNSUPPORTED_PROVIDER rather than guessed at.

const WIKIPEDIA_PAGE_URL_PATTERN = /^https:\/\/en\.wikipedia\.org\/wiki\/([^/?#]+)$/;

/** Returns the page title (percent-decoded) or null if `url` is not a recognized en.wikipedia.org page URL. Never throws. */
export function extractWikipediaPageTitle(url: string | null): string | null {
  if (!url) return null;
  const match = WIKIPEDIA_PAGE_URL_PATTERN.exec(url);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

export function isWikipediaSourceUrl(url: string | null): boolean {
  return extractWikipediaPageTitle(url) !== null;
}
