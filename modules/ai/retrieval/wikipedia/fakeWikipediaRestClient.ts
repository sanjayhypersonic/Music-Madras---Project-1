import type { WikipediaFetchErrorType, WikipediaFetchResult, WikipediaRestClient, WikipediaSummary } from "./wikipediaRestClient";

// Phase 6H-9 — deterministic fake for the Wikimedia REST Summary HTTP
// boundary, mirroring FakeAIProvider/FakeSourceRetrievalAdapter's
// config-driven shape. Faking at this boundary (rather than faking the
// whole WikipediaSourceRetrievalAdapter) means tests exercise the adapter's
// REAL logic — approval gating, URL parsing, fingerprinting, citation
// upsert, audit — with zero real network dependency (brief: "No real
// network dependency exists in automated tests").

export type FakeWikipediaRestClientMode = "SUCCESS" | WikipediaFetchErrorType;

export interface FakeWikipediaRestClientConfig {
  mode?: FakeWikipediaRestClientMode;
  summary?: Partial<WikipediaSummary>;
}

const DEFAULT_SUMMARY: WikipediaSummary = {
  title: "Fake Page",
  description: null,
  extract: "Fake extract text.",
  canonicalUrl: null,
};

export class FakeWikipediaRestClient implements WikipediaRestClient {
  constructor(private readonly config: FakeWikipediaRestClientConfig = {}) {}

  async fetchSummary(pageTitle: string): Promise<WikipediaFetchResult> {
    const mode = this.config.mode ?? "SUCCESS";
    if (mode === "SUCCESS") {
      return { ok: true, summary: { ...DEFAULT_SUMMARY, title: pageTitle, ...this.config.summary } };
    }
    return { ok: false, error: { type: mode, message: `fake Wikipedia fetch failure: ${mode}` } };
  }
}
