import { describe, expect, it } from "vitest";
import { describeGenerationFailureForEditor } from "../../modules/ai/gateway/describeGenerationFailureForEditor";
import type { GenerateRecordingEditorialSuggestionResult } from "../../modules/ai/gateway/generateRecordingEditorialSuggestion";

type Failure = Extract<GenerateRecordingEditorialSuggestionResult, { ok: false }>;

// Phase 6H-6 — this is the boundary between technical failure detail and
// what a Studio editor sees. Every case here must never leak a provider
// stack trace, header, or raw SDK message.

describe("describeGenerationFailureForEditor", () => {
  it("describes an archived Recording clearly", () => {
    const result: Failure = { ok: false, generationRequest: null, reason: "RECORDING_CONTEXT_UNAVAILABLE", contextReason: "ARCHIVED" };
    expect(describeGenerationFailureForEditor(result)).toBe("This Recording is archived and cannot be used for editorial generation.");
  });

  it("describes a missing published revision using the brief's exact suggested wording", () => {
    const result: Failure = { ok: false, generationRequest: null, reason: "RECORDING_CONTEXT_UNAVAILABLE", contextReason: "NO_PUBLISHED_REVISION" };
    expect(describeGenerationFailureForEditor(result)).toBe("The Recording does not have enough published context to generate an editorial suggestion.");
  });

  it("describes a not-found Recording", () => {
    const result: Failure = { ok: false, generationRequest: null, reason: "RECORDING_CONTEXT_UNAVAILABLE", contextReason: "NOT_FOUND" };
    expect(describeGenerationFailureForEditor(result)).toBe("This Recording could not be found.");
  });

  it("describes an in-progress generation clearly, without technical detail", () => {
    const result: Failure = { ok: false, generationRequest: null, reason: "GENERATION_ALREADY_IN_PROGRESS" };
    expect(describeGenerationFailureForEditor(result)).toContain("already being generated");
  });

  it("describes a Recording that is not currently published (Phase 6J-5), without technical detail", () => {
    const result: Failure = { ok: false, generationRequest: null, reason: "RECORDING_NOT_PUBLISHED" };
    expect(describeGenerationFailureForEditor(result)).toBe("This Recording is not currently published, so editorial generation is not available for it. Publish it first.");
  });

  it("maps a CONFIGURATION provider failure to the brief's exact suggested wording", () => {
    const result: Failure = { ok: false, generationRequest: {} as never, reason: "CONFIGURATION: ANTHROPIC_API_KEY is not set." };
    expect(describeGenerationFailureForEditor(result)).toBe("AI provider configuration is unavailable.");
  });

  it("maps provider errors (rate limit, timeout, network, auth, generic) to a generic retry message, never the raw provider text", () => {
    for (const reason of [
      "RATE_LIMIT: Anthropic rate limit exceeded.",
      "TIMEOUT: The request to the Anthropic API timed out.",
      "NETWORK: Could not connect to the Anthropic API.",
      "AUTHENTICATION: Anthropic rejected the API key.",
      "PROVIDER_ERROR: Simulated provider-side failure.",
      "INVALID_REQUEST: Simulated malformed request.",
    ]) {
      const result: Failure = { ok: false, generationRequest: {} as never, reason };
      const message = describeGenerationFailureForEditor(result);
      expect(message).toBe("Editorial generation could not be completed. Please try again later.");
      expect(message).not.toContain("Anthropic");
    }
  });

  it("maps a structured-output validation failure to the brief's exact suggested wording", () => {
    const result: Failure = {
      ok: false,
      generationRequest: {} as never,
      reason: 'Invalid structured output from the AI provider: no valid evidence references — every id in evidenceEntityIds was either absent or not present in the supplied context.',
    };
    expect(describeGenerationFailureForEditor(result)).toBe("AI generation returned an invalid structured response.");
  });

  it("falls back to a generic, safe message for any unrecognized reason string", () => {
    const result: Failure = { ok: false, generationRequest: {} as never, reason: "Failed to persist the suggestion: some database detail." };
    expect(describeGenerationFailureForEditor(result)).toBe("Editorial generation could not be completed.");
  });

  it("never returns a message containing a stack trace marker or a secret-shaped string", () => {
    const result: Failure = { ok: false, generationRequest: {} as never, reason: "AUTHENTICATION: Bearer sk-ant-super-secret at Object.<anonymous> (/app/node_modules/...)" };
    const message = describeGenerationFailureForEditor(result);
    expect(message).not.toContain("sk-ant-super-secret");
    expect(message).not.toContain("node_modules");
  });
});
