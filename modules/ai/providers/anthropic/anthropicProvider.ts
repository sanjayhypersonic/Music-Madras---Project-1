import Anthropic from "@anthropic-ai/sdk";
import { jsonSchemaOutputFormat } from "@anthropic-ai/sdk/helpers/json-schema";
import type { AIGenerationRequest, AIGenerationResult, AIProvider, AIProviderCapabilities, AIProviderConfigurationStatus, AIProviderErrorInfo, AIResearchRequest, AIResearchResult } from "../../provider/aiProvider";
import { normalizeAnthropicError } from "./normalizeAnthropicError";

// Phase 6H-5 — the first (and, by design, replaceable) real provider
// adapter. This is the ONLY file that imports the Anthropic SDK's client
// and models it directly (normalizeAnthropicError.ts is the only other file
// that imports its error classes). It never imports Prisma, an MMKE
// repository, or a Studio module — see the dependency-direction rule in
// docs/content-intelligence-architecture.md Phase 6H-5.
//
// Structured output: the request carries the schema from the SDK's
// `jsonSchemaOutputFormat()` (which also adapts the schema to what the API
// accepts). The provider still returns the raw parsed value as
// `output: unknown`; modules/ai/structuredOutput/** re-validates it
// independently, since LLM output is untrusted regardless of provider-side
// schema enforcement.
//
// Credits extraction, milestone 1 — stop reasons are checked BEFORE any
// output is read. `messages.parse()` was replaced by `messages.create()` and
// an explicit JSON.parse, because `parse()` throws on text that is not JSON
// before the caller can see why the response ended: a refusal or a response
// cut off at the output limit used to surface as an UNKNOWN error. Now:
//   stop_reason "refusal"                                   -> REFUSAL (not retryable)
//   stop_reason "max_tokens" / "model_context_window_exceeded" -> OUTPUT_TRUNCATED (no partial output is trusted)
//   any other stop with text that is not JSON               -> INVALID_OUTPUT
// Only the text blocks are read; thinking blocks are ignored. The output
// limit and the timeout were raised (1024 -> 16000 tokens, 30 s -> 180 s):
// current models think before answering and thinking counts toward the
// limit. 16000 stays within the SDK's non-streaming guidance; callers that
// want a smaller answer (the playlist assistant) still pass their own limit.

export interface AnthropicProviderConfig {
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
  maxRetries?: number;
}

/** Sonnet 5.5 — a capable, cost-reasonable default for structured editorial generation. Overridable per request or via AI_MODEL. */
const DEFAULT_MODEL = "claude-sonnet-5-5";
export const ANTHROPIC_DEFAULT_TIMEOUT_MS = 180_000;
const DEFAULT_MAX_RETRIES = 2;
export const ANTHROPIC_DEFAULT_MAX_OUTPUT_TOKENS = 16_000;

const TRUNCATING_STOP_REASONS = new Set(["max_tokens", "model_context_window_exceeded"]);

/** Classifies a completed response: an error when it must not be trusted, otherwise its parsed JSON output. Pure. */
export function interpretAnthropicResponse(response: {
  content: ReadonlyArray<{ type: string; text?: string }>;
  stop_reason: string | null;
  stop_details?: { category?: string | null } | null;
}): { ok: true; output: unknown } | { ok: false; error: AIProviderErrorInfo } {
  if (response.stop_reason === "refusal") {
    const category = response.stop_details?.category;
    // The category is a short enumerated label (e.g. "cyber"), never content; the explanation text is deliberately not copied.
    const label = typeof category === "string" && /^[a-z_]{1,40}$/.test(category) ? ` (category: ${category})` : "";
    return { ok: false, error: { type: "REFUSAL", message: `The model declined this request${label}.`, retryable: false } };
  }
  if (response.stop_reason !== null && TRUNCATING_STOP_REASONS.has(response.stop_reason)) {
    return {
      ok: false,
      error: { type: "OUTPUT_TRUNCATED", message: `The response was cut off before it was complete (${response.stop_reason}); no partial output is used.`, retryable: false },
    };
  }
  const text = response.content
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text as string)
    .join("");
  if (text.trim().length === 0) {
    return { ok: false, error: { type: "INVALID_OUTPUT", message: "The response contained no output text.", retryable: false } };
  }
  try {
    return { ok: true, output: JSON.parse(text) };
  } catch {
    return { ok: false, error: { type: "INVALID_OUTPUT", message: "The response text was not valid JSON.", retryable: false } };
  }
}

/** R-34: how many times a paused web-search turn is resumed. */
export const MAX_RESEARCH_TURNS = 3;

/**
 * R-34: the passages and search results in a web-search response. Pure. Only text blocks' `web_search_result_location` citations are kept (URL,
 * title, cited text); a `web_search_tool_result` whose content is an error object (not a list) contributes nothing.
 */
export function interpretAnthropicResearchContent(content: ReadonlyArray<{ type: string } & Record<string, unknown>>): {
  passages: Array<{ text: string; citations: Array<{ url: string; title: string | null; citedText: string }> }>;
  searchResults: Array<{ url: string; title: string | null }>;
} {
  const passages: Array<{ text: string; citations: Array<{ url: string; title: string | null; citedText: string }> }> = [];
  const searchResults: Array<{ url: string; title: string | null }> = [];
  for (const block of content) {
    if (block.type === "text" && typeof block.text === "string") {
      const citations = (Array.isArray(block.citations) ? block.citations : [])
        .filter((c): c is { type: string; url: string; title?: string | null; cited_text: string } => typeof c === "object" && c !== null && (c as { type?: string }).type === "web_search_result_location" && typeof (c as { url?: unknown }).url === "string" && typeof (c as { cited_text?: unknown }).cited_text === "string")
        .map((c) => ({ url: c.url, title: c.title ?? null, citedText: c.cited_text }));
      if (block.text.trim()) passages.push({ text: block.text, citations });
    } else if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
      for (const r of block.content as Array<{ type?: string; url?: unknown; title?: unknown }>) {
        if (r?.type === "web_search_result" && typeof r.url === "string") searchResults.push({ url: r.url, title: typeof r.title === "string" ? r.title : null });
      }
    }
  }
  return { passages, searchResults };
}

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
    return { structuredOutput: true, vision: false, toolCalling: false, streaming: false, usageMetrics: true, webResearch: true };
  }

  /**
   * R-34: one bounded web-search session (the server-side `web_search_20260209` tool; Anthropic runs the searches). No structured output here:
   * structured outputs cannot be combined with citations, and the citations (URL, title and the page's own cited text) are the evidence. A
   * `pause_turn` is resumed at most MAX_RESEARCH_TURNS times by sending the assistant turn back unchanged. Usage (tokens and the number of web
   * searches) is returned for cost logging. Untested against the live API in this phase (no API calls were made); covered by the pure
   * interpreter below and by the fake provider in the pipeline tests.
   */
  async research(request: AIResearchRequest): Promise<AIResearchResult> {
    const timestamp = new Date();
    const model = request.model ?? this.config.model ?? DEFAULT_MODEL;
    const configCheck = this.validateConfiguration();
    if (!configCheck.configured) {
      return { ok: false, provider: this.providerName, model, error: { type: "CONFIGURATION", message: configCheck.reason ?? "Anthropic provider is not configured.", retryable: false }, promptVersion: request.promptVersion, timestamp };
    }
    const client = new Anthropic({ apiKey: this.config.apiKey, timeout: this.config.timeoutMs ?? ANTHROPIC_DEFAULT_TIMEOUT_MS, maxRetries: this.config.maxRetries ?? DEFAULT_MAX_RETRIES });
    const messages: Anthropic.MessageParam[] = [{ role: "user", content: JSON.stringify({ context: request.contextPayload }) }];
    const tool: Anthropic.WebSearchTool20260209 = {
      type: "web_search_20260209",
      name: "web_search",
      max_uses: Math.max(1, Math.min(request.maxSearches, 10)),
      ...(request.blockedDomains && request.blockedDomains.length > 0 ? { blocked_domains: request.blockedDomains } : {}),
    };
    const usage = { inputTokens: 0, outputTokens: 0, webSearchRequests: 0 };
    const content: Array<{ type: string } & Record<string, unknown>> = [];
    let stopReason: string | undefined;
    try {
      for (let turn = 0; turn < MAX_RESEARCH_TURNS; turn++) {
        const response = await client.messages.create({
          model,
          max_tokens: request.maxOutputTokens ?? ANTHROPIC_DEFAULT_MAX_OUTPUT_TOKENS,
          system: request.systemInstructions, // the instructions stay in `system`; the subject travels as data in the user turn
          messages,
          tools: [tool],
        });
        usage.inputTokens += response.usage?.input_tokens ?? 0;
        usage.outputTokens += response.usage?.output_tokens ?? 0;
        usage.webSearchRequests += response.usage?.server_tool_use?.web_search_requests ?? 0;
        stopReason = response.stop_reason ?? undefined;
        if (response.stop_reason === "refusal") {
          return { ok: false, provider: this.providerName, model, error: { type: "REFUSAL", message: "The model declined this research request.", retryable: false }, promptVersion: request.promptVersion, timestamp };
        }
        if (response.stop_reason !== null && TRUNCATING_STOP_REASONS.has(response.stop_reason)) {
          return { ok: false, provider: this.providerName, model, error: { type: "OUTPUT_TRUNCATED", message: "The research response was cut off; nothing from it is used.", retryable: false }, promptVersion: request.promptVersion, timestamp };
        }
        content.push(...(response.content as unknown as Array<{ type: string } & Record<string, unknown>>));
        if (response.stop_reason !== "pause_turn") break;
        messages.push({ role: "assistant", content: response.content });
      }
    } catch (err) {
      return { ok: false, provider: this.providerName, model, error: normalizeAnthropicError(err), promptVersion: request.promptVersion, timestamp };
    }
    const interpreted = interpretAnthropicResearchContent(content);
    return { ok: true, provider: this.providerName, model, ...interpreted, usage, stopReason, promptVersion: request.promptVersion, timestamp };
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
      timeout: this.config.timeoutMs ?? ANTHROPIC_DEFAULT_TIMEOUT_MS,
      maxRetries: this.config.maxRetries ?? DEFAULT_MAX_RETRIES,
    });

    // The helper's `parse` function is for messages.parse(); only the format itself is sent.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { parse: _unusedParse, ...format } = jsonSchemaOutputFormat(request.outputSchema as never) as { parse?: unknown; type: "json_schema"; schema: Record<string, unknown> };

    const startedAt = Date.now();

    try {
      const response = await client.messages.create({
        model,
        max_tokens: request.maxOutputTokens ?? ANTHROPIC_DEFAULT_MAX_OUTPUT_TOKENS,
        // The prompt-injection boundary: system instructions travel ONLY in
        // Anthropic's dedicated `system` field, never concatenated with
        // context data. The context payload — which may include a YouTube
        // description an uploader wrote — goes in the user message as
        // plain, explicitly-labeled data (see the system instructions
        // themselves in modules/ai/prompts/**, which tell the model to
        // treat it as such).
        system: request.systemInstructions,
        messages: [{ role: "user", content: JSON.stringify({ context: request.contextPayload }) }],
        output_config: { format },
      });

      const interpreted = interpretAnthropicResponse(response);
      if (!interpreted.ok) {
        return { ok: false, provider: this.providerName, model, error: interpreted.error, promptVersion: request.promptVersion, timestamp };
      }

      return {
        ok: true,
        provider: this.providerName,
        model,
        output: interpreted.output,
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
