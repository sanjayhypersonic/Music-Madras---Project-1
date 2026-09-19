import { describe, expect, it } from "vitest";
import { AnalyticsService } from "../../modules/analytics/service/analyticsService";
import { InvalidAnalyticsEventError } from "../../modules/analytics/events/validateAnalyticsEvent";
import type { AnalyticsDeliveryResult, AnalyticsProviderAdapter } from "../../modules/analytics/service/analyticsProviderAdapter";
import {
  createCatalogueSearchEvent,
  createEntityViewEvent,
  createSheetMusicRequestSubmittedEvent,
  createYouTubeClickEvent,
} from "../../modules/analytics/events/factories";

class FakeAdapter implements AnalyticsProviderAdapter {
  public sentEvents: string[] = [];
  constructor(
    public readonly providerName: string,
    private readonly shouldFail = false
  ) {}

  async send(): Promise<AnalyticsDeliveryResult> {
    if (this.shouldFail) {
      throw new Error("simulated provider failure");
    }
    this.sentEvents.push(this.providerName);
    return { delivered: true, provider: this.providerName };
  }
}

describe("AnalyticsService", () => {
  it("validates before dispatching — an invalid event never reaches any adapter", async () => {
    const adapter = new FakeAdapter("fake");
    const service = new AnalyticsService([adapter]);

    await expect(
      service.track({ name: "not_a_real_event" as never, occurredAt: new Date() })
    ).rejects.toThrow(InvalidAnalyticsEventError);
    expect(adapter.sentEvents).toHaveLength(0);
  });

  it("dispatches a valid event to every registered adapter", async () => {
    const adapterA = new FakeAdapter("a");
    const adapterB = new FakeAdapter("b");
    const service = new AnalyticsService([adapterA, adapterB]);

    const results = await service.track(createCatalogueSearchEvent(3));

    expect(adapterA.sentEvents).toEqual(["a"]);
    expect(adapterB.sentEvents).toEqual(["b"]);
    expect(results).toHaveLength(2);
  });

  it("one adapter failing does not prevent another adapter from receiving the event", async () => {
    const failingAdapter = new FakeAdapter("failing", true);
    const workingAdapter = new FakeAdapter("working");
    const service = new AnalyticsService([failingAdapter, workingAdapter]);

    const results = await service.track(createCatalogueSearchEvent(0));

    expect(workingAdapter.sentEvents).toEqual(["working"]);
    const failingResult = results.find((r) => r.provider === "failing");
    expect(failingResult?.delivered).toBe(false);
    expect(failingResult?.reason).toBe("adapter_error");
  });
});

describe("event factories produce taxonomy-valid events", () => {
  it("createEntityViewEvent routes to the dedicated *_view event for a known entity type", () => {
    const event = createEntityViewEvent({ entityType: "Composer", entityId: "composer-1" });
    expect(event.name).toBe("composer_view");
  });

  it("createEntityViewEvent falls back to the generic entity_view for an entity type without a dedicated event", () => {
    const event = createEntityViewEvent({ entityType: "Venue", entityId: "venue-1" });
    expect(event.name).toBe("entity_view");
  });

  it("createYouTubeClickEvent carries the youtubeVideoId as entity context, not a raw URL", () => {
    const event = createYouTubeClickEvent("abc123");
    expect(event.entity?.youtubeVideoId).toBe("abc123");
  });

  it("createSheetMusicRequestSubmittedEvent never carries requester details", () => {
    const event = createSheetMusicRequestSubmittedEvent(
      { hasRecordingContext: true, hasMusicalWorkContext: false },
      { recordingId: "rec-1" }
    );
    expect(event.params).toEqual({ hasRecordingContext: true, hasMusicalWorkContext: false });
  });
});
