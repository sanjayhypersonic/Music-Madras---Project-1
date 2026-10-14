import { afterEach, describe, expect, it } from "vitest";
import {
  createAIProvider,
  FakeAIProviderForbiddenError,
  getConfiguredAIProvider,
  isSupportedAIProviderName,
  resetConfiguredAIProviderForTests,
  UnsupportedAIProviderError,
} from "../../modules/ai/provider/aiProviderRegistry";
import { AnthropicProvider } from "../../modules/ai/providers/anthropic/anthropicProvider";
import { FakeAIProvider } from "../../modules/ai/providers/fake/fakeAIProvider";

// Phase 6H-5 — provider selection is configuration-driven, not a business-
// logic conditional. These tests prove FakeAIProvider and AnthropicProvider
// are reached through the exact same registry function.

describe("createAIProvider", () => {
  it("returns an AnthropicProvider for \"anthropic\"", () => {
    expect(createAIProvider("anthropic")).toBeInstanceOf(AnthropicProvider);
  });

  it("returns a FakeAIProvider for \"fake\"", () => {
    expect(createAIProvider("fake")).toBeInstanceOf(FakeAIProvider);
  });

  it("throws UnsupportedAIProviderError for an unknown provider name", () => {
    expect(() => createAIProvider("openai")).toThrow(UnsupportedAIProviderError);
  });
});

// Phase 6J-9A — the canned-output provider can never be built by a production process.
describe("createAIProvider — the fake provider in production", () => {
  it("refuses \"fake\" when NODE_ENV is production, with a message that names no environment value", () => {
    const previousKey = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "sk-ant-never-print-this-value";
    try {
      expect(() => createAIProvider("fake", { NODE_ENV: "production" })).toThrow(FakeAIProviderForbiddenError);
      let message = "";
      try {
        createAIProvider("fake", { NODE_ENV: "production" });
      } catch (err) {
        message = err instanceof Error ? err.message : "";
      }
      expect(message).toMatch(/not allowed in production/);
      expect(message).not.toContain("sk-ant-never-print-this-value");
    } finally {
      if (previousKey === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = previousKey;
    }
  });

  it("still builds the fake provider outside production (tests and local development)", () => {
    expect(createAIProvider("fake", { NODE_ENV: "test" })).toBeInstanceOf(FakeAIProvider);
    expect(createAIProvider("fake", { NODE_ENV: "development" })).toBeInstanceOf(FakeAIProvider);
    expect(createAIProvider("fake", {})).toBeInstanceOf(FakeAIProvider);
  });

  it("AI-disabled operation stays valid in production: anthropic with no key builds and reports itself unconfigured instead of throwing", () => {
    const previousKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const provider = createAIProvider("anthropic", { NODE_ENV: "production" });
      expect(provider).toBeInstanceOf(AnthropicProvider);
      expect(provider.validateConfiguration().configured).toBe(false);
    } finally {
      if (previousKey !== undefined) process.env.ANTHROPIC_API_KEY = previousKey;
    }
  });

  it("an unsupported provider is still reported as unsupported in production", () => {
    expect(() => createAIProvider("openai", { NODE_ENV: "production" })).toThrow(UnsupportedAIProviderError);
  });
});

describe("isSupportedAIProviderName", () => {
  it("accepts exactly anthropic and fake", () => {
    expect(isSupportedAIProviderName("anthropic")).toBe(true);
    expect(isSupportedAIProviderName("fake")).toBe(true);
    expect(isSupportedAIProviderName("openai")).toBe(false);
    expect(isSupportedAIProviderName("google")).toBe(false);
  });
});

describe("getConfiguredAIProvider — configuration-driven selection", () => {
  const originalProvider = process.env.AI_PROVIDER;

  afterEach(() => {
    if (originalProvider === undefined) delete process.env.AI_PROVIDER;
    else process.env.AI_PROVIDER = originalProvider;
    resetConfiguredAIProviderForTests();
  });

  it("selects FakeAIProvider when AI_PROVIDER=fake, and AnthropicProvider when AI_PROVIDER=anthropic — without any change to calling code", () => {
    process.env.AI_PROVIDER = "fake";
    resetConfiguredAIProviderForTests();
    expect(getConfiguredAIProvider()).toBeInstanceOf(FakeAIProvider);

    process.env.AI_PROVIDER = "anthropic";
    resetConfiguredAIProviderForTests();
    expect(getConfiguredAIProvider()).toBeInstanceOf(AnthropicProvider);
  });

  it("defaults to anthropic when AI_PROVIDER is unset", () => {
    delete process.env.AI_PROVIDER;
    resetConfiguredAIProviderForTests();
    expect(getConfiguredAIProvider()).toBeInstanceOf(AnthropicProvider);
  });
});
