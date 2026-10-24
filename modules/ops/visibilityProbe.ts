// VISIBILITY PROBE (launch readiness; project register R-22). The application caches nothing on the public Museum, so a Recording's publication, unpublication,
// archive, restore and hold change what visitors see on the very next request: verified locally on a production build. What no repository check can show is whether the
// REAL host, its edge or a CDN honours that. This is the repeatable procedure for the real host: an operator makes the change in Studio, and this probe polls the three
// public surfaces that could go stale (the Recording's own page, archive search, the sitemap) until they agree with the expected state, reporting how long that took and
// which cache headers the host answered with. PURE decisions here; scripts/visibilityProbe.ts does the HTTP.
//
// It only issues GET requests to public URLs and never sends credentials.

export type ExpectedState = "PRESENT" | "ABSENT";
export type Surface = "page" | "search" | "sitemap";

export interface Observation {
  surface: Surface;
  /** Whether the surface shows the Recording: the page answered 200, the search result links it, the sitemap lists it. */
  shown: boolean;
  /** Set when the request itself failed, or the answer was a server error: such an observation proves nothing either way. */
  inconclusive: boolean;
  status: number | null;
  /** Selected cache-related response headers (names lower-case). */
  cache: Record<string, string>;
}

export interface Evaluation {
  consistent: boolean;
  /** Surfaces that disagree with the expected state (or could not be judged). */
  wrong: Surface[];
}

export function evaluateObservations(expected: ExpectedState, observations: readonly Observation[]): Evaluation {
  const wrong = observations.filter((o) => o.inconclusive || o.shown !== (expected === "PRESENT")).map((o) => o.surface);
  return { consistent: wrong.length === 0 && observations.length === 3, wrong };
}

const CACHE_HEADERS = ["cache-control", "age", "x-vercel-cache", "x-cache", "cf-cache-status", "x-nextjs-cache", "cdn-cache-control", "surrogate-control"] as const;

/** The cache-related headers present on a response, for the report. Values are short header values, never cookies or tokens. */
export function pickCacheHeaders(headers: { get(name: string): string | null }): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of CACHE_HEADERS) {
    const value = headers.get(name);
    if (value !== null) out[name] = value.slice(0, 120);
  }
  return out;
}

/** Cache findings worth a person's attention, from what the host answered. Advice only: it never decides pass or fail. */
export function cacheConcerns(observations: readonly Observation[]): string[] {
  const concerns: string[] = [];
  for (const o of observations) {
    const age = Number(o.cache["age"]);
    if (Number.isFinite(age) && age > 0) concerns.push(`${o.surface}: the answer carries Age: ${age} (a shared cache served it).`);
    const hit = (o.cache["x-vercel-cache"] ?? o.cache["x-cache"] ?? o.cache["cf-cache-status"] ?? "").toUpperCase();
    if (/\bHIT\b|\bSTALE\b/.test(hit)) concerns.push(`${o.surface}: the edge reports a cache ${hit}.`);
    const control = (o.cache["cache-control"] ?? "").toLowerCase();
    if (/s-maxage\s*=\s*[1-9]/.test(control) || (/\bpublic\b/.test(control) && /max-age\s*=\s*[1-9]/.test(control))) concerns.push(`${o.surface}: Cache-Control allows shared caching (${o.cache["cache-control"]}).`);
  }
  return concerns;
}

/** Whether a body links the Recording page (anchored on the path so a longer slug that merely starts the same does not count). */
export function linksRecording(body: string, slug: string): boolean {
  const escaped = slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`/recordings/${escaped}(?![A-Za-z0-9_-])`).test(body);
}
