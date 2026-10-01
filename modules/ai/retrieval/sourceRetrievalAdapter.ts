// Phase 6H-8 — the Source Retrieval Adapter contract
// (docs/content-intelligence-architecture.md, Phase 6H-8 section):
// Source Registry -> Source Retrieval Adapter -> Retrieved Source Material
// -> Evidence Normalization -> Recording Context -> AI Gateway.
//
// This is deliberately source/provider-neutral, mirroring
// modules/ai/provider/aiProvider.ts's role for AI providers: the Recording
// Context Assembler (modules/db/repositories/recordingContextRepository.ts)
// depends only on this interface, never on how a given implementation
// actually obtains a Source's content. The ONLY implementation in this
// phase (citationBackedSourceRetrievalAdapter.ts) reads already-stored
// Citation rows — there is no live network retrieval, no web crawling, and
// no AI involvement anywhere in this module, by design.
//
// Pure types + interface only. No Prisma import here (ADR §3 boundary
// rule) — an implementation may read the database, but this contract
// itself must not.

export interface SourceRetrievalRequest {
  sourceId: string;
}

export interface SourceRetrievalCitation {
  id: string;
  text: string | null;
}

/**
 * Every failure is classified, never a generic throw — mirroring
 * AIProviderErrorType's role for AI providers. SOURCE_NOT_APPROVED and
 * SOURCE_NOT_FOUND are defensive cases (the Recording Context Assembler
 * only ever requests retrieval for Sources it already found APPROVED) that
 * guard against a race between listing and retrieval, not expected steady
 * -state outcomes. UNAVAILABLE/TIMEOUT exist for a future live-retrieval
 * implementation; the current adapter never produces them.
 */
export type SourceRetrievalErrorType = "SOURCE_NOT_FOUND" | "SOURCE_NOT_APPROVED" | "UNAVAILABLE" | "TIMEOUT" | "UNKNOWN";

export interface SourceRetrievalErrorInfo {
  type: SourceRetrievalErrorType;
  message: string;
}

export interface SourceRetrievalSuccess {
  ok: true;
  sourceId: string;
  citations: SourceRetrievalCitation[];
  /** Null when there is no citation content to fingerprint yet — not itself a failure. */
  contentFingerprint: string | null;
  retrievedAt: Date;
}

export interface SourceRetrievalFailure {
  ok: false;
  sourceId: string;
  error: SourceRetrievalErrorInfo;
  retrievedAt: Date;
}

export type SourceRetrievalResult = SourceRetrievalSuccess | SourceRetrievalFailure;

export interface SourceRetrievalAdapter {
  retrieve(request: SourceRetrievalRequest): Promise<SourceRetrievalResult>;
}
