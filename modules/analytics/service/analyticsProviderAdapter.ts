import type { AnalyticsEvent } from "../events/eventTypes";

export interface AnalyticsDeliveryResult {
  delivered: boolean;
  provider: string;
  reason?: string; // e.g. "not_configured" — never a raw error stack
}

/**
 * The boundary every analytics provider (GA4, YouTube, and any future
 * provider) implements (brief §2/§6). The rest of the application depends
 * only on this interface and on AnalyticsService below — never directly on
 * a provider's SDK or API shape.
 */
export interface AnalyticsProviderAdapter {
  readonly providerName: string;
  send(event: AnalyticsEvent): Promise<AnalyticsDeliveryResult>;
}
