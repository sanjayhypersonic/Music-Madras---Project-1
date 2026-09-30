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
}

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
}
