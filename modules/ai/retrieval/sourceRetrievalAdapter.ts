// Phase 6H-8 — the Source Retrieval Adapter contract
// (docs/content-intelligence-architecture.md, Phase 6H-8 section):
// Source Registry -> Source Retrieval Adapter -> Retrieved Source Material
// -> Evidence Normalization -> Recording Context -> AI Gateway.
//
// This is deliberately source/provider-neutral, mirroring
// modules/ai/provider/aiProvider.ts's role for AI providers: the Recording
// Context Assembler (modules/db/repositories/recordingContextRepository.ts)
// depends only on this interface, never on how a given implementation
// actually obtains a Source's content. The 6H-8 implementation
// (citationBackedSourceRetrievalAdapter.ts) reads already-stored Citation
// rows and remains the Context Assembler's only adapter — it is never
// swapped for WikipediaSourceRetrievalAdapter there.
//
// Phase 6H-9 adds the first REAL external adapter
// (modules/ai/retrieval/wikipedia/wikipediaSourceRetrievalAdapter.ts), which
// is intentionally NOT wired into getRecordingContext. It is a separate,
// explicitly-invoked service (modules/ai/retrieval/retrieveExternalSourceEvidence.ts)
// that fetches fresh content from the Wikimedia REST Summary API for one
// already-registered, already-APPROVED Source and persists it as a Citation
// — which the existing CitationBackedSourceRetrievalAdapter then picks up
// automatically on the next context assembly, with zero changes to the
// Context Assembler itself. There is still no live network call on the
// AI-generation read path, no web crawling, and no AI involvement anywhere
// in this module, by design.
//
// Pure types + interface only. No Prisma import here (ADR §3 boundary
// rule) — an implementation may read the database, but this contract
// itself must not.

export interface SourceRetrievalRequest {
  sourceId: string;
  /**
   * Phase 6H-9 — required by any adapter that performs a real write (e.g.
   * WikipediaSourceRetrievalAdapter persists a Citation and audits the
   * attempt, both of which need a real actor). Optional here because the
   * read-only CitationBackedSourceRetrievalAdapter — and every existing
   * caller of getRecordingContext, which never supplies one — never needs
   * it. An adapter that requires an actor and does not receive one must
   * fail closed (MISSING_ACTOR) rather than attribute a write to nobody.
   */
  actorId?: string;
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
 * -state outcomes. UNAVAILABLE/TIMEOUT were reserved in 6H-8 for a future
 * live-retrieval implementation and are now used by
 * WikipediaSourceRetrievalAdapter (6H-9) for real network failures.
 *
 * Phase 6H-9 additions:
 * - UNSUPPORTED_PROVIDER: the Source's url does not match any provider this
 *   adapter knows how to retrieve (e.g. not an en.wikipedia.org page) — a
 *   registration-time mismatch, never a network call is attempted.
 * - EXTERNAL_PAGE_NOT_FOUND: the external provider resolved the request but
 *   reported the specific page does not exist (distinct from
 *   SOURCE_NOT_FOUND, which is about the Music Madras Source row).
 * - MALFORMED_RESPONSE: the external provider returned a response this
 *   adapter cannot safely parse/trust.
 * - MISSING_ACTOR: a write-performing adapter was invoked without a real
 *   actorId — fails closed rather than attributing a write to nobody.
 */
export type SourceRetrievalErrorType =
  | "SOURCE_NOT_FOUND"
  | "SOURCE_NOT_APPROVED"
  | "UNAVAILABLE"
  | "TIMEOUT"
  | "UNKNOWN"
  | "UNSUPPORTED_PROVIDER"
  | "EXTERNAL_PAGE_NOT_FOUND"
  | "MALFORMED_RESPONSE"
  | "MISSING_ACTOR";

export interface SourceRetrievalErrorInfo {
  type: SourceRetrievalErrorType;
  message: string;
}

/** Phase 6H-9 — distinguishes a first-ever retrieval from one that found the same or different content as last time, per the brief's explicit requirement to tell these apart without a version-history table. */
export type SourceRetrievalChangeStatus = "FIRST_RETRIEVAL" | "UNCHANGED" | "CHANGED";

export interface SourceRetrievalSuccess {
  ok: true;
  sourceId: string;
  citations: SourceRetrievalCitation[];
  /** Null when there is no citation content to fingerprint yet — not itself a failure. */
  contentFingerprint: string | null;
  retrievedAt: Date;
  /**
   * Optional — only an adapter that compares against a previously-stored
   * fingerprint (WikipediaSourceRetrievalAdapter) sets this.
   * CitationBackedSourceRetrievalAdapter has no "previous" concept to
   * compare against (it always reflects whatever is currently stored) and
   * leaves this undefined.
   */
  changeStatus?: SourceRetrievalChangeStatus;
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
