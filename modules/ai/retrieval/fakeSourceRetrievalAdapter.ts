import type {
  SourceRetrievalAdapter,
  SourceRetrievalCitation,
  SourceRetrievalErrorType,
  SourceRetrievalRequest,
  SourceRetrievalResult,
} from "./sourceRetrievalAdapter";

// Phase 6H-8 — deterministic fake retrieval adapter for tests, mirroring
// modules/ai/providers/fake/fakeAIProvider.ts's config-driven shape: a mode
// selects the outcome, and `citations`/`contentFingerprint` let a test
// inject an exact payload rather than this fake guessing realistic-looking
// content. Default mode is SUCCESS with no citations — the same
// honest-default philosophy as FakeAIProvider (an empty result is not
// hidden behind a conveniently-populated fake).

export type FakeSourceRetrievalAdapterMode = "SUCCESS" | SourceRetrievalErrorType;

export interface FakeSourceRetrievalAdapterConfig {
  mode?: FakeSourceRetrievalAdapterMode;
  citations?: SourceRetrievalCitation[];
  contentFingerprint?: string | null;
}

export class FakeSourceRetrievalAdapter implements SourceRetrievalAdapter {
  constructor(private readonly config: FakeSourceRetrievalAdapterConfig = {}) {}

  async retrieve(request: SourceRetrievalRequest): Promise<SourceRetrievalResult> {
    const retrievedAt = new Date();
    const mode = this.config.mode ?? "SUCCESS";

    if (mode === "SUCCESS") {
      return {
        ok: true,
        sourceId: request.sourceId,
        citations: this.config.citations ?? [],
        contentFingerprint: this.config.contentFingerprint ?? null,
        retrievedAt,
      };
    }

    return {
      ok: false,
      sourceId: request.sourceId,
      error: { type: mode, message: `fake retrieval failure: ${mode}` },
      retrievedAt,
    };
  }
}
