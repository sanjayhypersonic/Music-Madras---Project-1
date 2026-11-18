// Phase 6H-5 — the provider-neutral AI contract. Every provider adapter
// (Anthropic today; OpenAI/Google/a deterministic fake tomorrow) implements
// exactly this interface. Content Intelligence business logic
// (modules/ai/gateway/**) depends ONLY on this file — never on a specific
// provider's SDK types. Mirrors modules/analytics/service/analyticsProviderAdapter.ts's
// role for GA4/YouTube exactly: one small interface, one place every
// adapter is measured against.
//
// This file has zero external dependencies (no SDK import, no Prisma) —
// it is pure TypeScript, safe to import from anywhere in the application.

export interface AIGenerationRequest {
  /** Authoritative instructions — always kept structurally separate from `contextPayload` (the prompt-injection boundary, docs/content-intelligence-architecture.md Phase 6H-5). */
  systemInstructions: string;
  /** The deterministic context (e.g. a RecordingContext, Phase 6H-3) the model reasons over — always DATA, never instructions. */
  contextPayload: unknown;
  /** A provider-neutral JSON Schema describing the required structured output shape. */
  outputSchema: Record<string, unknown>;
  /** e.g. "recording-editorial-v1" — persisted verbatim on the ContentGenerationRequest. */
  promptVersion: string;
  targetEntityType: string;
  targetEntityId: string;
  /** The ContentSuggestionType being requested (the actual delivered type may differ, e.g. INFORMATION_GAP). */
  suggestionType: string;
  /** The Phase 6H-4 context fingerprint the request was generated against. */
  contextFingerprint: string;
  /** Overrides the provider's configured default model, where the provider supports more than one. */
  model?: string;
  maxOutputTokens?: number;
}

export type AIProviderErrorType =
  | "CONFIGURATION"
  | "AUTHENTICATION"
  | "INVALID_REQUEST"
  | "RATE_LIMIT"
  | "TIMEOUT"
  | "NETWORK"
  | "PROVIDER_ERROR"
  /** The model declined the request (Anthropic stop_reason "refusal"). Retrying the same request is not expected to help. */
  | "REFUSAL"
  /** The response stopped before the output was complete (output-token limit or context window reached), so no partial output is trusted. */
  | "OUTPUT_TRUNCATED"
  /** The response completed but its text was not valid JSON for the requested schema. */
  | "INVALID_OUTPUT"
  | "UNKNOWN";

/** Normalized, provider-neutral error shape — never a raw provider SDK error, never a secret/credential. */
export interface AIProviderErrorInfo {
  type: AIProviderErrorType;
  message: string;
  retryable: boolean;
  status?: number;
}

export interface AIGenerationSuccess {
  ok: true;
  provider: string;
  model: string;
  /** The raw structured output as returned by the provider — still UNTRUSTED, re-validated by modules/ai/structuredOutput before use. */
  output: unknown;
  providerRequestId?: string;
  usage?: { inputTokens?: number; outputTokens?: number };
  latencyMs?: number;
  stopReason?: string;
  promptVersion: string;
  timestamp: Date;
}

export interface AIGenerationFailure {
  ok: false;
  provider: string;
  model?: string;
  error: AIProviderErrorInfo;
  promptVersion: string;
  timestamp: Date;
}

export type AIGenerationResult = AIGenerationSuccess | AIGenerationFailure;

export interface AIProviderCapabilities {
  structuredOutput: boolean;
  vision: boolean;
  toolCalling: boolean;
  streaming: boolean;
  usageMetrics: boolean;
  /** R-34: the provider can run a web search and return cited passages (AIProvider.research). */
  webResearch?: boolean;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// R-34 (upload-to-draft pipeline, docs/upload-pipeline.md): web research with citations.
//
// One request = one bounded search session about one subject. The provider returns only what the search tool produced: passages of text with
// the citations the provider attached (URL, page title and the VERBATIM cited text from that page) and the list of results it saw. It returns no
// structured claims: turning passages into claims is a second, ordinary generate() call over this data, and every claim is then checked in code
// against these citations (modules/pipeline/research.ts). Web pages are untrusted data, never instructions.

export interface AIResearchRequest {
  systemInstructions: string;
  /** What to research (subject, role, the video's title) — DATA, never instructions. */
  contextPayload: unknown;
  promptVersion: string;
  targetEntityType: string;
  targetEntityId: string;
  /** Upper bound on searches in this request (cost control). */
  maxSearches: number;
  /** Domains never to use (e.g. lyrics sites). */
  blockedDomains?: string[];
  model?: string;
  maxOutputTokens?: number;
}

export interface AIResearchCitation {
  url: string;
  title: string | null;
  /** The text the provider says it cited, copied from the page. */
  citedText: string;
}

export interface AIResearchSuccess {
  ok: true;
  provider: string;
  model: string;
  passages: Array<{ text: string; citations: AIResearchCitation[] }>;
  searchResults: Array<{ url: string; title: string | null }>;
  usage?: { inputTokens?: number; outputTokens?: number; webSearchRequests?: number };
  stopReason?: string;
  promptVersion: string;
  timestamp: Date;
}

export type AIResearchResult = AIResearchSuccess | AIGenerationFailure;

export interface AIProviderConfigurationStatus {
  configured: boolean;
  reason?: string;
}

/**
 * Every provider adapter implements exactly these three methods — no more.
 * Only what the first real use case (structured editorial generation)
 * genuinely needs (brief: "do not add speculative methods").
 */
export interface AIProvider {
  readonly providerName: string;
  generate(request: AIGenerationRequest): Promise<AIGenerationResult>;
  validateConfiguration(): AIProviderConfigurationStatus;
  capabilities(): AIProviderCapabilities;
  /** R-34: optional. A provider without web research leaves it out, and the pipeline flags the bundle "research unavailable". */
  research?(request: AIResearchRequest): Promise<AIResearchResult>;
}
