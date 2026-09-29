import { trackEvent } from "./trackEvent";
import { createEphemeralSessionId } from "./createEphemeralSessionId";
import type { AnalyticsEvent, PageContext } from "./events/eventTypes";

// Phase 6G-18 — the one call every public Museum page makes (via
// Next.js's `after()`, so it never delays the response) to record its
// view. Always fires the universal `page_view` event; when the page has a
// canonical MMKE entity, also fires the dedicated (or generic `entity_view`
// fallback) event a factory in modules/analytics/events/factories.ts
// already builds — both share one ephemeral session id (see
// createEphemeralSessionId.ts) so GA4 can group the two hits from the
// same page load, without either ever being written to the visitor's
// browser or reused across a navigation.
//
// This is the one shared instrumentation point (brief §15: "shared...
// page-specific event helpers") — each page still makes its own one-line
// call naming its own canonical event, rather than a generic mechanism
// that would obscure which page type fired what.
export async function trackPublicPageView(
  page: PageContext,
  entityEvent?: Omit<AnalyticsEvent, "occurredAt" | "sessionId">
): Promise<void> {
  const sessionId = createEphemeralSessionId();
  await trackEvent({ name: "page_view", occurredAt: new Date(), sessionId, page });
  if (entityEvent) {
    await trackEvent({ ...entityEvent, occurredAt: new Date(), sessionId });
  }
}
