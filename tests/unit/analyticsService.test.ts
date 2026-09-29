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
import { isCanonicalEntityType } from "../../modules/analytics/events/eventTypes";

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

  it("dispatches the new Phase 6G-18 entity types (Performance, Organisation, video_view) without validation errors", async () => {
    const adapter = new FakeAdapter("fake");
    const service = new AnalyticsService([adapter]);

    await expect(
      service.track(createEntityViewEvent({ entityType: "Performance", entityId: "perf-1" }))
    ).resolves.toBeDefined();
    await expect(
      service.track(createEntityViewEvent({ entityType: "Organisation", entityId: "org-1" }))
    ).resolves.toBeDefined();
    await expect(
      service.track(createEntityViewEvent({ entityType: "YouTubeVideo", entityId: "yt-1", youtubeVideoId: "yt-1" }))
    ).resolves.toBeDefined();

    expect(adapter.sentEvents).toHaveLength(3);
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

  it("createEntityViewEvent routes YouTubeVideo to the dedicated video_view event (Phase 6G-18)", () => {
    const event = createEntityViewEvent({ entityType: "YouTubeVideo", entityId: "yt-1", youtubeVideoId: "yt-1" });
    expect(event.name).toBe("video_view");
  });

  it("recognizes Performance and Organisation as canonical entity types (Phase 6G-18 — public pages exist for both)", () => {
    expect(isCanonicalEntityType("Performance")).toBe(true);
    expect(isCanonicalEntityType("Organisation")).toBe(true);
  });

  it("createEntityViewEvent falls back to entity_view for Performance/Organisation (no dedicated event, same as Venue)", () => {
    expect(createEntityViewEvent({ entityType: "Performance", entityId: "perf-1" }).name).toBe("entity_view");
    expect(createEntityViewEvent({ entityType: "Organisation", entityId: "org-1" }).name).toBe("entity_view");
  });

  it("createCatalogueSearchEvent carries an optional entityType/page without ever carrying raw query text", () => {
    const event = createCatalogueSearchEvent(5, { entityType: "work", page: 2 });
    expect(event.params).toEqual({ resultCount: 5, entityType: "work", page: 2 });
    expect(event.params).not.toHaveProperty("query");
    expect(event.params).not.toHaveProperty("q");
  });

  it("createCatalogueSearchEvent omits entityType/page when not provided", () => {
    const event = createCatalogueSearchEvent(0);
    expect(event.params).toEqual({ resultCount: 0 });
  });
});
