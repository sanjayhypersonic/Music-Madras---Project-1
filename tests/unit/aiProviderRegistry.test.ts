import { afterEach, describe, expect, it } from "vitest";
import {
  createAIProvider,
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
