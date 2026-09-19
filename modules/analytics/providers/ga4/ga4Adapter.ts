import type { AnalyticsEvent } from "../../events/eventTypes";
import type { AnalyticsDeliveryResult, AnalyticsProviderAdapter } from "../../service/analyticsProviderAdapter";
import { mapToGa4Event } from "./mapToGa4Event";

export interface Ga4AdapterConfig {
  measurementId?: string;
  apiSecret?: string;
}

const GA4_MEASUREMENT_PROTOCOL_ENDPOINT = "https://www.google-analytics.com/mp/collect";

/**
 * GA4 provider adapter (brief §6). Phase 3 deliberately ships this
 * unconfigured everywhere it's used — no measurement ID or API secret is
 * read from a real environment variable with a real value anywhere in
 * this codebase yet (see .env.example, which only documents the variable
 * names). Without configuration, `send` is a pure no-op: it never makes a
 * network call, matching "do NOT send production events yet." The
 * Measurement Protocol call is written out (gated behind the config
 * check) because that's what "create a provider adapter boundary" means —
 * writing the adapter is not the same as connecting a real account.
 */
export class Ga4Adapter implements AnalyticsProviderAdapter {
  readonly providerName = "ga4";

  constructor(private readonly config: Ga4AdapterConfig) {}

  async send(event: AnalyticsEvent): Promise<AnalyticsDeliveryResult> {
    if (!this.config.measurementId || !this.config.apiSecret) {
      return { delivered: false, provider: this.providerName, reason: "not_configured" };
    }

    const ga4Event = mapToGa4Event(event);
    const url = `${GA4_MEASUREMENT_PROTOCOL_ENDPOINT}?measurement_id=${this.config.measurementId}&api_secret=${this.config.apiSecret}`;

    const response = await fetch(url, {
      method: "POST",
      body: JSON.stringify({
        client_id: event.sessionId ?? "anonymous",
        events: [{ name: ga4Event.name, params: ga4Event.params }],
      }),
    });

    return { delivered: response.ok, provider: this.providerName, reason: response.ok ? undefined : "http_error" };
  }
}
