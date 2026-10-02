// Phase 6H-9 — isolates the one piece of Wikipedia-specific HTTP code in
// the codebase, mirroring how modules/ai/providers/anthropic/anthropicProvider.ts
// is the only file that imports the Anthropic SDK. Nothing outside this
// file and wikipediaSourceRetrievalAdapter.ts knows the Wikimedia REST API
// shape. No Prisma import here (ADR §3 boundary rule) — this is pure
// network I/O.
//
// Uses the OFFICIAL Wikimedia REST Summary API only
// (https://en.wikipedia.org/api/rest_v1/page/summary/{title}) — a single,
// documented, deterministic GET per already-known page title. This is not
// a search client: it has no method that accepts a query string, and it
// never follows a redirect to a different title than the one requested.

export interface WikipediaSummary {
  title: string;
  description: string | null;
  extract: string | null;
  /** The canonical desktop page URL Wikipedia itself reports, where present — not reconstructed. */
  canonicalUrl: string | null;
}

export type WikipediaFetchErrorType = "EXTERNAL_PAGE_NOT_FOUND" | "MALFORMED_RESPONSE" | "TIMEOUT" | "UNAVAILABLE" | "UNKNOWN";

export type WikipediaFetchResult =
  | { ok: true; summary: WikipediaSummary }
  | { ok: false; error: { type: WikipediaFetchErrorType; message: string } };

export interface WikipediaRestClient {
  /** `pageTitle` must already be the exact, decoded Wikipedia title (e.g. from extractWikipediaPageTitle) — this method performs no search or discovery. */
  fetchSummary(pageTitle: string): Promise<WikipediaFetchResult>;
}

const WIKIPEDIA_SUMMARY_ENDPOINT = "https://en.wikipedia.org/api/rest_v1/page/summary/";
const REQUEST_TIMEOUT_MS = 10_000;

function isWikipediaSummaryShape(value: unknown): value is { title: unknown; description?: unknown; extract?: unknown; content_urls?: { desktop?: { page?: unknown } } } {
  return typeof value === "object" && value !== null && "title" in value;
}

export class RealWikipediaRestClient implements WikipediaRestClient {
  async fetchSummary(pageTitle: string): Promise<WikipediaFetchResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(`${WIKIPEDIA_SUMMARY_ENDPOINT}${encodeURIComponent(pageTitle)}`, {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return { ok: false, error: { type: "TIMEOUT", message: `Wikipedia REST request for "${pageTitle}" timed out after ${REQUEST_TIMEOUT_MS}ms.` } };
      }
      return { ok: false, error: { type: "UNAVAILABLE", message: error instanceof Error ? error.message : "Unknown network error contacting Wikipedia." } };
    } finally {
      clearTimeout(timeout);
    }

    if (response.status === 404) {
      return { ok: false, error: { type: "EXTERNAL_PAGE_NOT_FOUND", message: `Wikipedia has no page titled "${pageTitle}".` } };
    }
    if (!response.ok) {
      return { ok: false, error: { type: "UNAVAILABLE", message: `Wikipedia REST API returned HTTP ${response.status} for "${pageTitle}".` } };
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return { ok: false, error: { type: "MALFORMED_RESPONSE", message: "Wikipedia REST API response was not valid JSON." } };
    }

    if (!isWikipediaSummaryShape(body) || typeof body.title !== "string") {
      return { ok: false, error: { type: "MALFORMED_RESPONSE", message: "Wikipedia REST API response did not contain the expected 'title' field." } };
    }

    return {
      ok: true,
      summary: {
        title: body.title,
        description: typeof body.description === "string" ? body.description : null,
        extract: typeof body.extract === "string" ? body.extract : null,
        canonicalUrl: typeof body.content_urls?.desktop?.page === "string" ? body.content_urls.desktop.page : null,
      },
    };
  }
}
