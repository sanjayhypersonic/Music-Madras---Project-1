// Upload-to-draft pipeline (R-34): token and cost accounting with a hard per-run cap. Pure.
//
// Prices are Anthropic first-party list prices per million tokens (input, output) and $10 per 1,000 web searches, as published for these models
// on 2026-11-03. An unknown model is charged at the most expensive known rate, so the cap errs on the safe side. The cap is checked BEFORE each
// call against a conservative estimate, and every call's actual usage is charged after it; a run stops (STOPPED_COST_CAP) rather than exceed it.

export const MODEL_PRICES_USD_PER_MTOK: Readonly<Record<string, { input: number; output: number }>> = {
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
  "claude-fable-5-2": { input: 8, output: 40 },
  "fake-model-v1": { input: 0, output: 0 },
};
export const WEB_SEARCH_USD = 0.01;
const FALLBACK = { input: 8, output: 40 };

export interface CallUsage {
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  webSearchRequests?: number;
}

export function costOf(usage: CallUsage): number {
  const price = MODEL_PRICES_USD_PER_MTOK[usage.model] ?? FALLBACK;
  return ((usage.inputTokens ?? 0) * price.input + (usage.outputTokens ?? 0) * price.output) / 1_000_000 + (usage.webSearchRequests ?? 0) * WEB_SEARCH_USD;
}

/** Conservative estimates of one call, used for the cap check before the call is made. */
export const ESTIMATES = {
  extraction: { inputTokens: 6_000, outputTokens: 4_000, webSearchRequests: 0 },
  claimsFromCitations: { inputTokens: 12_000, outputTokens: 3_000, webSearchRequests: 0 },
  research: (maxSearches: number) => ({ inputTokens: 40_000, outputTokens: 4_000, webSearchRequests: maxSearches }),
} as const;

export class CostMeter {
  inputTokens = 0;
  outputTokens = 0;
  webSearches = 0;
  spentUsd = 0;
  calls = 0;

  constructor(readonly capUsd: number, readonly model: string) {}

  /** True when a call of this estimated size would take the run over its cap. */
  wouldExceed(estimate: Omit<CallUsage, "model">): boolean {
    return this.spentUsd + costOf({ model: this.model, ...estimate }) > this.capUsd;
  }

  charge(usage: CallUsage): number {
    const usd = costOf(usage);
    this.inputTokens += usage.inputTokens ?? 0;
    this.outputTokens += usage.outputTokens ?? 0;
    this.webSearches += usage.webSearchRequests ?? 0;
    this.spentUsd += usd;
    this.calls += 1;
    return usd;
  }

  /** Token and cost totals for the run log (no content, no secrets). */
  summary() {
    return { calls: this.calls, inputTokens: this.inputTokens, outputTokens: this.outputTokens, webSearches: this.webSearches, costUsd: Math.round(this.spentUsd * 10_000) / 10_000, capUsd: this.capUsd };
  }
}
