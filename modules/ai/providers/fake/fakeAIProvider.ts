import type { AIGenerationRequest, AIGenerationResult, AIProvider, AIProviderCapabilities, AIProviderConfigurationStatus } from "../../provider/aiProvider";

// Phase 6H-5 — a deterministic provider implementing the exact same
// AIProvider interface as AnthropicProvider. Exists so the automated test
// suite (and any future orchestration) never depends on external AI
// credentials or network access (brief: "the automated test suite must NOT
// require external AI credentials"). Never imports Prisma, never imports a
// canonical repository.

export type FakeAIProviderMode = "SUCCESS" | "MALFORMED_OUTPUT" | "PROVIDER_ERROR" | "RETRYABLE_ERROR" | "NON_RETRYABLE_ERROR" | "TIMEOUT";

export interface FakeAIProviderConfig {
  mode?: FakeAIProviderMode;
  /** Overrides the default success output — tests supply a shape matching their own fixture's real entity ids. */
  output?: unknown;
  configured?: boolean;
}

const DEFAULT_SUCCESS_OUTPUT = {
  outputType: "INFORMATION_GAP",
  proposedContent: null,
  targetField: null,
  evidenceEntityIds: [],
  missingField: "performance",
  whyItMatters: "No performance context was supplied, so no editorial claim can be safely made.",
  requestedAction: "Attach a Performance to this recording before requesting an editorial suggestion.",
};

export class FakeAIProvider implements AIProvider {
  readonly providerName = "fake";

  constructor(private readonly config: FakeAIProviderConfig = {}) {}

  validateConfiguration(): AIProviderConfigurationStatus {
    if (this.config.configured === false) {
      return { configured: false, reason: "Fake provider explicitly configured as unconfigured for this test." };
    }
    return { configured: true };
  }

  capabilities(): AIProviderCapabilities {
    return { structuredOutput: true, vision: false, toolCalling: false, streaming: false, usageMetrics: true };
  }

  async generate(request: AIGenerationRequest): Promise<AIGenerationResult> {
    const timestamp = new Date();
    const model = "fake-model-v1";
    const mode = this.config.mode ?? "SUCCESS";

    const configCheck = this.validateConfiguration();
    if (!configCheck.configured) {
      return {
        ok: false,
        provider: this.providerName,
        model,
        error: { type: "CONFIGURATION", message: configCheck.reason ?? "Fake provider is not configured.", retryable: false },
        promptVersion: request.promptVersion,
        timestamp,
      };
    }

    switch (mode) {
      case "SUCCESS":
        return {
          ok: true,
          provider: this.providerName,
          model,
          output: this.config.output ?? DEFAULT_SUCCESS_OUTPUT,
          providerRequestId: "fake-request-id",
          usage: { inputTokens: 100, outputTokens: 50 },
          latencyMs: 5,
          stopReason: "end_turn",
          promptVersion: request.promptVersion,
          timestamp,
        };
      case "MALFORMED_OUTPUT":
        return {
          ok: true,
          provider: this.providerName,
          model,
          output: this.config.output ?? { unexpectedShape: true },
          promptVersion: request.promptVersion,
          timestamp,
        };
      case "PROVIDER_ERROR":
        return {
          ok: false,
          provider: this.providerName,
          model,
          error: { type: "PROVIDER_ERROR", message: "Simulated provider-side failure.", retryable: true, status: 500 },
          promptVersion: request.promptVersion,
          timestamp,
        };
      case "RETRYABLE_ERROR":
        return {
          ok: false,
          provider: this.providerName,
          model,
          error: { type: "RATE_LIMIT", message: "Simulated rate limit.", retryable: true, status: 429 },
          promptVersion: request.promptVersion,
          timestamp,
        };
      case "NON_RETRYABLE_ERROR":
        return {
          ok: false,
          provider: this.providerName,
          model,
          error: { type: "INVALID_REQUEST", message: "Simulated malformed request.", retryable: false, status: 400 },
          promptVersion: request.promptVersion,
          timestamp,
        };
      case "TIMEOUT":
        return {
          ok: false,
          provider: this.providerName,
          model,
          error: { type: "TIMEOUT", message: "Simulated request timeout.", retryable: true },
          promptVersion: request.promptVersion,
          timestamp,
        };
    }
  }
}
