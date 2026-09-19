import { describe, expect, it } from "vitest";
import { InvalidAnalyticsEventError, validateAnalyticsEvent } from "../../modules/analytics/events/validateAnalyticsEvent";
import type { AnalyticsEvent } from "../../modules/analytics/events/eventTypes";

function baseEvent(overrides: Partial<AnalyticsEvent> = {}): AnalyticsEvent {
  return { name: "recording_view", occurredAt: new Date(), ...overrides };
}

describe("validateAnalyticsEvent — taxonomy enforcement", () => {
  it("accepts a well-formed event with no params", () => {
    expect(() => validateAnalyticsEvent(baseEvent())).not.toThrow();
  });

  it("rejects an event name outside the controlled taxonomy", () => {
    expect(() =>
      // @ts-expect-error deliberately invalid for the test
      validateAnalyticsEvent(baseEvent({ name: "some_made_up_event" }))
    ).toThrow(InvalidAnalyticsEventError);
  });

  it("rejects an unrecognized entity type", () => {
    expect(() =>
      // @ts-expect-error deliberately invalid for the test
      validateAnalyticsEvent(baseEvent({ entity: { entityType: "NotARealEntity" } }))
    ).toThrow(InvalidAnalyticsEventError);
  });
});

describe("validateAnalyticsEvent — parameter allowlist (brief §7)", () => {
  it("accepts a parameter that is part of the event's schema", () => {
    expect(() =>
      validateAnalyticsEvent(baseEvent({ name: "catalogue_search", params: { resultCount: 5 } }))
    ).not.toThrow();
  });

  it("rejects a parameter not listed for that event", () => {
    expect(() =>
      validateAnalyticsEvent(baseEvent({ name: "catalogue_search", params: { unexpectedKey: 1 } }))
    ).toThrow(InvalidAnalyticsEventError);
  });

  it("rejects a parameter of the wrong type", () => {
    expect(() =>
      validateAnalyticsEvent(
        baseEvent({ name: "catalogue_search", params: { resultCount: "five" as unknown as number } })
      )
    ).toThrow(InvalidAnalyticsEventError);
  });

  it("rejects a string parameter exceeding its declared maximum length", () => {
    const tooLong = "x".repeat(500);
    expect(() =>
      validateAnalyticsEvent(baseEvent({ name: "outbound_link", params: { destinationHost: tooLong } }))
    ).toThrow(InvalidAnalyticsEventError);
  });
});

describe("validateAnalyticsEvent — privacy safeguards (brief §5, §16, §17)", () => {
  it("rejects a raw search query parameter on catalogue_search (not in its schema at all)", () => {
    expect(() =>
      validateAnalyticsEvent(baseEvent({ name: "catalogue_search", params: { query: "some search text" } }))
    ).toThrow(InvalidAnalyticsEventError);
  });

  it("rejects sheet music request params that try to smuggle requester details", () => {
    expect(() =>
      validateAnalyticsEvent(
        baseEvent({
          name: "sheet_music_request_submitted",
          params: { email: "someone@example.com" } as unknown as Record<string, boolean>,
        })
      )
    ).toThrow(InvalidAnalyticsEventError);
  });

  it("rejects any parameter key that looks like a password/token/secret, even hypothetically", () => {
    expect(() =>
      validateAnalyticsEvent(
        baseEvent({ name: "media_interaction", params: { mediaType: "audio", password: "x" } as unknown as Record<string, string> })
      )
    ).toThrow(InvalidAnalyticsEventError);
  });

  it("accepts the documented boolean-only sheet music request context", () => {
    expect(() =>
      validateAnalyticsEvent(
        baseEvent({
          name: "sheet_music_request_started",
          params: { hasRecordingContext: true, hasMusicalWorkContext: false },
        })
      )
    ).not.toThrow();
  });
});
