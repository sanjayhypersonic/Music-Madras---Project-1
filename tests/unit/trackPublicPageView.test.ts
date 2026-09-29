import { describe, expect, it, vi, beforeEach } from "vitest";

const trackEventMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("../../modules/analytics/trackEvent", () => ({ trackEvent: trackEventMock }));

import { trackPublicPageView } from "../../modules/analytics/trackPublicPageView";

describe("trackPublicPageView", () => {
  beforeEach(() => {
    trackEventMock.mockClear();
  });

  it("always fires a page_view event carrying the given path", async () => {
    await trackPublicPageView({ path: "/composers/bach" });

    expect(trackEventMock).toHaveBeenCalledTimes(1);
    const [event] = trackEventMock.mock.calls[0];
    expect(event.name).toBe("page_view");
    expect(event.page).toEqual({ path: "/composers/bach" });
  });

  it("also fires the given entity event, sharing the same session id as the page_view", async () => {
    await trackPublicPageView(
      { path: "/composers/bach" },
      { name: "composer_view", entity: { entityType: "Composer", entityId: "composer-1" } }
    );

    expect(trackEventMock).toHaveBeenCalledTimes(2);
    const [pageViewEvent] = trackEventMock.mock.calls[0];
    const [entityViewEvent] = trackEventMock.mock.calls[1];

    expect(pageViewEvent.name).toBe("page_view");
    expect(entityViewEvent.name).toBe("composer_view");
    expect(entityViewEvent.entity).toEqual({ entityType: "Composer", entityId: "composer-1" });
    expect(entityViewEvent.sessionId).toBe(pageViewEvent.sessionId);
    expect(typeof pageViewEvent.sessionId).toBe("string");
  });

  it("fires only the page_view event when no entity event is given", async () => {
    await trackPublicPageView({ path: "/archive" });
    expect(trackEventMock).toHaveBeenCalledTimes(1);
    expect(trackEventMock.mock.calls[0][0].name).toBe("page_view");
  });
});
