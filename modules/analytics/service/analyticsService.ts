import type { AnalyticsEvent } from "../events/eventTypes";
import { validateAnalyticsEvent } from "../events/validateAnalyticsEvent";
import type { AnalyticsDeliveryResult, AnalyticsProviderAdapter } from "./analyticsProviderAdapter";

/**
 * Music Madras Application
 *     ↓
 * AnalyticsService (this file) — validates against the taxonomy, then
 * fans out to every registered provider adapter
 *     ↓
 * Provider adapters (GA4, YouTube, future providers)
 *
 * The application only ever talks to this class and to
 * modules/analytics/events (brief §2) — it never imports a provider SDK
 * directly. One provider failing to deliver never prevents another
 * provider from receiving the event.
 */
export class AnalyticsService {
  private readonly adapters: AnalyticsProviderAdapter[];

  constructor(adapters: AnalyticsProviderAdapter[]) {
    this.adapters = adapters;
  }

  async track(event: AnalyticsEvent): Promise<AnalyticsDeliveryResult[]> {
    validateAnalyticsEvent(event);

    const results = await Promise.allSettled(this.adapters.map((adapter) => adapter.send(event)));

    return results.map((result, index) => {
      if (result.status === "fulfilled") {
        return result.value;
      }
      return {
        delivered: false,
        provider: this.adapters[index].providerName,
        reason: "adapter_error",
      };
    });
  }
}
