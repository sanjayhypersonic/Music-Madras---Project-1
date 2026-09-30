import Anthropic from "@anthropic-ai/sdk";
import { jsonSchemaOutputFormat } from "@anthropic-ai/sdk/helpers/json-schema";
import type { AIGenerationRequest, AIGenerationResult, AIProvider, AIProviderCapabilities, AIProviderConfigurationStatus } from "../../provider/aiProvider";
import { normalizeAnthropicError } from "./normalizeAnthropicError";

// Phase 6H-5 — the first (and, by design, replaceable) real provider
// adapter. This is the ONLY file that imports the Anthropic SDK's client
// and models it directly (normalizeAnthropicError.ts is the only other file
// that imports its error classes). It never imports Prisma, an MMKE
// repository, or a Studio module — see the dependency-direction rule in
// docs/content-intelligence-architecture.md Phase 6H-5.
//
// Structured output uses the SDK's native `messages.parse()` +
// `jsonSchemaOutputFormat()` (verified against the current official
// Anthropic TypeScript SDK docs during this phase, not from memory) — the
// provider still returns the raw parsed value as `output: unknown`;
// modules/ai/structuredOutput/** re-validates it independently, since LLM
// output is untrusted regardless of provider-side schema enforcement.

export interface AnthropicProviderConfig {
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
  maxRetries?: number;
}

/** Sonnet 5.5 — a capable, cost-reasonable default for structured editorial generation. Overridable per request or via AI_MODEL. */
const DEFAULT_MODEL = "claude-sonnet-5-5";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_MAX_OUTPUT_TOKENS = 1024;

export class AnthropicProvider implements AIProvider {
  readonly providerName = "anthropic";

  constructor(private readonly config: AnthropicProviderConfig = {}) {}

  validateConfiguration(): AIProviderConfigurationStatus {
    if (!this.config.apiKey) {
      return { configured: false, reason: "ANTHROPIC_API_KEY is not set." };
    }
    return { configured: true };
  }

  capabilities(): AIProviderCapabilities {
    return { structuredOutput: true, vision: false, toolCalling: false, streaming: false, usageMetrics: true };
  }

  async generate(request: AIGenerationRequest): Promise<AIGenerationResult> {
    const timestamp = new Date();
    const model = request.model ?? this.config.model ?? DEFAULT_MODEL;

    const configCheck = this.validateConfiguration();
    if (!configCheck.configured) {
      return {
        ok: false,
        provider: this.providerName,
        model,
        error: { type: "CONFIGURATION", message: configCheck.reason ?? "Anthropic provider is not configured.", retryable: false },
        promptVersion: request.promptVersion,
        timestamp,
      };
    }

    const client = new Anthropic({
      apiKey: this.config.apiKey,
      timeout: this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxRetries: this.config.maxRetries ?? DEFAULT_MAX_RETRIES,
    });

    const startedAt = Date.now();

    try {
      const response = await client.messages.parse({
        model,
        max_tokens: request.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
        // The prompt-injection boundary: system instructions travel ONLY in
        // Anthropic's dedicated `system` field, never concatenated with
        // context data. The context payload — which may include a YouTube
        // description an uploader wrote — goes in the user message as
        // plain, explicitly-labeled data (see the system instructions
        // themselves in modules/ai/prompts/**, which tell the model to
        // treat it as such).
        system: request.systemInstructions,
        messages: [{ role: "user", content: JSON.stringify({ context: request.contextPayload }) }],
        output_config: { format: jsonSchemaOutputFormat(request.outputSchema as never) },
      });

      return {
        ok: true,
        provider: this.providerName,
        model,
        output: response.parsed_output,
        providerRequestId: response._request_id ?? undefined,
        usage: { inputTokens: response.usage?.input_tokens, outputTokens: response.usage?.output_tokens },
        latencyMs: Date.now() - startedAt,
        stopReason: response.stop_reason ?? undefined,
        promptVersion: request.promptVersion,
        timestamp,
      };
    } catch (err) {
      return {
        ok: false,
        provider: this.providerName,
        model,
        error: normalizeAnthropicError(err),
        promptVersion: request.promptVersion,
        timestamp,
      };
    }
  }
}
