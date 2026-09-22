import { describe, expect, it } from "vitest";
import { deriveCataloguePageState } from "../../modules/mmke/catalogue/deriveCataloguePageState";

describe("deriveCataloguePageState", () => {
  it("returns 'No Page' when no YouTubeVideoPage exists", () => {
    expect(deriveCataloguePageState(null)).toBe("No Page");
  });

  it("returns 'Draft' for an active draft page", () => {
    expect(deriveCataloguePageState({ status: "DRAFT", archivedAt: null })).toBe("Draft");
  });

  it("returns 'Published' for an active published page", () => {
    expect(deriveCataloguePageState({ status: "PUBLISHED", archivedAt: null })).toBe("Published");
  });

  it("returns 'Archived' for an archived draft page", () => {
    expect(deriveCataloguePageState({ status: "DRAFT", archivedAt: new Date() })).toBe("Archived");
  });

  it("returns 'Archived' for an archived published page (archival takes precedence over status)", () => {
    expect(deriveCataloguePageState({ status: "PUBLISHED", archivedAt: new Date() })).toBe("Archived");
  });
});
