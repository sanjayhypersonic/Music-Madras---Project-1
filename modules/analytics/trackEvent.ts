import { getAnalyticsService } from "./service/getAnalyticsService";
import type { AnalyticsEvent } from "./events/eventTypes";

// Phase 6G-18 — the one function every public Museum page calls to record
// an event (via Next.js's `after()`, so it never delays the response —
// see app/(museum)/**/page.tsx call sites). This is the only place that
// swallows an analytics failure: AnalyticsService.track() itself can
// throw (an invalid event) or resolve with per-adapter delivery failures,
// and neither may ever become a user-facing error or affect a page that
// has already rendered (brief §23 — "GA4 unavailable/misconfigured/failed
// → the Museum still renders"). Errors are swallowed, not logged loudly,
// since a missing GA4 configuration is the expected, common case in every
// environment today (see getAnalyticsService.ts) — that is not a fault to
// surface, just an inert no-op.
export async function trackEvent(event: AnalyticsEvent): Promise<void> {
  try {
    await getAnalyticsService().track(event);
  } catch {
    // Intentionally ignored — see module comment above.
  }
}
