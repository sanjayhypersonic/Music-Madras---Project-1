import { describe, expect, it } from "vitest";
import { mapToGa4Event } from "../../modules/analytics/providers/ga4/mapToGa4Event";
import type { AnalyticsEvent } from "../../modules/analytics/events/eventTypes";

describe("mapToGa4Event", () => {
  it("passes the internal event name through unchanged", () => {
    const result = mapToGa4Event({ name: "recording_view", occurredAt: new Date() });
    expect(result.name).toBe("recording_view");
  });

  it("flattens entity context into snake_case parameters", () => {
    const event: AnalyticsEvent = {
      name: "recording_view",
      occurredAt: new Date(),
      entity: { entityType: "Recording", entityId: "abc-123" },
    };
    const result = mapToGa4Event(event);
    expect(result.params.entity_type).toBe("Recording");
    expect(result.params.entity_id).toBe("abc-123");
  });

  it("flattens page context into GA4 page_* parameters", () => {
    const event: AnalyticsEvent = {
      name: "page_view",
      occurredAt: new Date(),
      page: { path: "/recordings/example", title: "Example" },
    };
    const result = mapToGa4Event(event);
    expect(result.params.page_path).toBe("/recordings/example");
    expect(result.params.page_title).toBe("Example");
  });

  it("converts boolean params to 1/0 (GA4 has no boolean parameter type)", () => {
    const event: AnalyticsEvent = {
      name: "sheet_music_request_started",
      occurredAt: new Date(),
      params: { hasRecordingContext: true, hasMusicalWorkContext: false },
    };
    const result = mapToGa4Event(event);
    expect(result.params.has_recording_context).toBe(1);
    expect(result.params.has_musical_work_context).toBe(0);
  });

  it("truncates an overlong string value to GA4's 100-character limit", () => {
    const event: AnalyticsEvent = {
      name: "outbound_link",
      occurredAt: new Date(),
      params: { destinationHost: "x".repeat(150) },
    };
    const result = mapToGa4Event(event);
    expect((result.params.destination_host as string).length).toBe(100);
  });

  it("throws if the event name exceeds GA4's 40-character event name limit", () => {
    expect(() =>
      mapToGa4Event({
        // @ts-expect-error deliberately invalid for the test
        name: "a".repeat(41),
        occurredAt: new Date(),
      })
    ).toThrow();
  });
});
