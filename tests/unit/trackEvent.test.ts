import { describe, expect, it } from "vitest";
import { trackEvent } from "../../modules/analytics/trackEvent";

// Phase 6G-18 — the critical safety-net test: whatever
// AnalyticsService.track() does (validate, dispatch, throw on an invalid
// event, or reject on an adapter failure), trackEvent() must never
// propagate it. A public page's `after()` callback that throws must never
// be allowed to represent "analytics broke the Museum" (brief §23).

describe("trackEvent", () => {
  it("never throws for a valid event, even with no provider configured (GA4 unconfigured in this environment)", async () => {
    await expect(
      trackEvent({ name: "page_view", occurredAt: new Date(), page: { path: "/test" } })
    ).resolves.toBeUndefined();
  });

  it("never throws for an event that fails taxonomy validation", async () => {
    await expect(
      trackEvent({ name: "not_a_real_event" as never, occurredAt: new Date() })
    ).resolves.toBeUndefined();
  });

  it("never throws for an event with a disallowed parameter", async () => {
    await expect(
      trackEvent({ name: "page_view", occurredAt: new Date(), params: { password: "shouldNeverBeAllowed" } as never })
    ).resolves.toBeUndefined();
  });
});
