import type { AIProvider } from "./aiProvider";
import { AnthropicProvider } from "../providers/anthropic/anthropicProvider";
import { FakeAIProvider } from "../providers/fake/fakeAIProvider";

// Phase 6H-5 — provider selection, configuration-driven (AI_PROVIDER/AI_MODEL
// env vars, mirroring modules/analytics/service/getAnalyticsService.ts's own
// env-driven construction exactly). This is the ONLY place a provider name
// string is switched on — Content Intelligence business logic never
// branches on "anthropic" vs "fake" itself; it calls whatever AIProvider
// getConfiguredAIProvider() returns.

export const SUPPORTED_AI_PROVIDER_NAMES = ["anthropic", "fake"] as const;
export type AIProviderName = (typeof SUPPORTED_AI_PROVIDER_NAMES)[number];

export function isSupportedAIProviderName(value: string): value is AIProviderName {
  return (SUPPORTED_AI_PROVIDER_NAMES as readonly string[]).includes(value);
}

export class UnsupportedAIProviderError extends Error {
  constructor(name: string) {
    super(`"${name}" is not a supported AI provider. Supported providers: ${SUPPORTED_AI_PROVIDER_NAMES.join(", ")}.`);
    this.name = "UnsupportedAIProviderError";
  }
}

export function createAIProvider(name: string): AIProvider {
  if (!isSupportedAIProviderName(name)) {
    throw new UnsupportedAIProviderError(name);
  }
  switch (name) {
    case "anthropic":
      return new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY || undefined, model: process.env.AI_MODEL || undefined });
    case "fake":
      return new FakeAIProvider();
  }
}

// A lazily-built module-level singleton, mirroring getAnalyticsService.ts —
// every caller wants the exact same configured instance.
let instance: AIProvider | null = null;

export function getConfiguredAIProvider(): AIProvider {
  if (!instance) {
    instance = createAIProvider(process.env.AI_PROVIDER || "anthropic");
  }
  return instance;
}

/** Test-only: forces the next getConfiguredAIProvider() call to rebuild, so tests can swap AI_PROVIDER between runs. */
export function resetConfiguredAIProviderForTests(): void {
  instance = null;
}
