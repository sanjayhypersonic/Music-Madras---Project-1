import { describe, expect, it } from "vitest";
import { FakeAIProvider } from "../../modules/ai/providers/fake/fakeAIProvider";
import type { AIGenerationRequest } from "../../modules/ai/provider/aiProvider";

// Phase 6H-5 — FakeAIProvider implements the exact same AIProvider
// interface AnthropicProvider does, so the automated suite never needs
// external AI credentials.

const baseRequest: AIGenerationRequest = {
  systemInstructions: "system",
  contextPayload: { hello: "world" },
  outputSchema: { type: "object" },
  promptVersion: "recording-editorial-v1",
  targetEntityType: "RECORDING",
  targetEntityId: "r1",
  suggestionType: "EDITORIAL_PROSE",
  contextFingerprint: "fingerprint",
};

describe("FakeAIProvider", () => {
  it("reports structuredOutput and usageMetrics capabilities", () => {
    const provider = new FakeAIProvider();
    expect(provider.capabilities()).toEqual({ structuredOutput: true, vision: false, toolCalling: false, streaming: false, usageMetrics: true });
  });

  it("SUCCESS mode returns ok:true with provider metadata and usage", async () => {
    const provider = new FakeAIProvider({ mode: "SUCCESS", output: { outputType: "SUGGESTION" } });
    const result = await provider.generate(baseRequest);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.provider).toBe("fake");
    expect(result.output).toEqual({ outputType: "SUGGESTION" });
    expect(result.promptVersion).toBe(baseRequest.promptVersion);
    expect(result.usage).toBeDefined();
  });

  it("MALFORMED_OUTPUT mode still returns ok:true (the malformed shape is the point — validation happens downstream)", async () => {
    const provider = new FakeAIProvider({ mode: "MALFORMED_OUTPUT" });
    const result = await provider.generate(baseRequest);
    expect(result.ok).toBe(true);
  });

  it("PROVIDER_ERROR mode returns a retryable normalized failure", async () => {
    const provider = new FakeAIProvider({ mode: "PROVIDER_ERROR" });
    const result = await provider.generate(baseRequest);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.retryable).toBe(true);
    expect(result.error.type).toBe("PROVIDER_ERROR");
  });

  it("RETRYABLE_ERROR mode (rate limit) is marked retryable", async () => {
    const provider = new FakeAIProvider({ mode: "RETRYABLE_ERROR" });
    const result = await provider.generate(baseRequest);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.retryable).toBe(true);
    expect(result.error.type).toBe("RATE_LIMIT");
  });

  it("NON_RETRYABLE_ERROR mode is marked non-retryable", async () => {
    const provider = new FakeAIProvider({ mode: "NON_RETRYABLE_ERROR" });
    const result = await provider.generate(baseRequest);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.retryable).toBe(false);
    expect(result.error.type).toBe("INVALID_REQUEST");
  });

  it("TIMEOUT mode is marked retryable with type TIMEOUT", async () => {
    const provider = new FakeAIProvider({ mode: "TIMEOUT" });
    const result = await provider.generate(baseRequest);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.type).toBe("TIMEOUT");
    expect(result.error.retryable).toBe(true);
  });

  it("returns a CONFIGURATION failure when explicitly configured as unconfigured, without inspecting the request", async () => {
    const provider = new FakeAIProvider({ configured: false });
    const result = await provider.generate(baseRequest);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.type).toBe("CONFIGURATION");
    expect(result.error.retryable).toBe(false);
  });
});
