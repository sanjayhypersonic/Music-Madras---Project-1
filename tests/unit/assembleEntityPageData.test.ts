import { describe, expect, it } from "vitest";
import { assembleEntityPageData } from "../../modules/mmke/entityPage/assembleEntityPageData";

// Phase 6G-4A: pure mapping tests, no database — the same fixture shape
// the real Prisma query results structurally satisfy.

const BASE_INPUT = {
  entityType: "composer" as const,
  id: "composer-1",
  slug: "test-composer",
  name: "Test Composer",
  description: "A short biography.",
  works: [],
  programmes: [],
  performances: [],
  recordings: [],
  videos: [],
  collections: [],
};

describe("assembleEntityPageData", () => {
  it("maps identity fields straight through", () => {
    const result = assembleEntityPageData(BASE_INPUT);
    expect(result.entityType).toBe("composer");
    expect(result.id).toBe("composer-1");
    expect(result.slug).toBe("test-composer");
    expect(result.name).toBe("Test Composer");
    expect(result.description).toBe("A short biography.");
  });

  it("returns relatedWorks as null when works is null (non-Composer entity types)", () => {
    const result = assembleEntityPageData({ ...BASE_INPUT, entityType: "venue", works: null });
    expect(result.relatedWorks).toBeNull();
  });

  it("maps a populated works array", () => {
    const result = assembleEntityPageData({
      ...BASE_INPUT,
      works: [{ id: "w1", slug: "requiem", title: "Requiem" }],
    });
    expect(result.relatedWorks).toEqual([{ id: "w1", slug: "requiem", title: "Requiem" }]);
  });

  it("maps performances, deriving venueName from the nested venue and handling a null venue", () => {
    const result = assembleEntityPageData({
      ...BASE_INPUT,
      performances: [
        { id: "p1", performanceDate: new Date("2024-01-01"), venue: { name: "St. Andrew's Church" } },
        { id: "p2", performanceDate: null, venue: null },
      ],
    });
    expect(result.relatedPerformances).toEqual([
      { id: "p1", performanceDate: new Date("2024-01-01"), venueName: "St. Andrew's Church" },
      { id: "p2", performanceDate: null, venueName: null },
    ]);
  });

  it("maps recordings, falling back to null title when there is no published revision", () => {
    const result = assembleEntityPageData({
      ...BASE_INPUT,
      recordings: [
        { id: "r1", slug: "rec-1", currentPublishedRevision: { title: "Live at the Cathedral" } },
        { id: "r2", slug: "rec-2", currentPublishedRevision: null },
      ],
    });
    expect(result.relatedRecordings).toEqual([
      { id: "r1", slug: "rec-1", title: "Live at the Cathedral" },
      { id: "r2", slug: "rec-2", title: null },
    ]);
  });

  it("maps videos to the public /videos/[slug] shape", () => {
    const result = assembleEntityPageData({
      ...BASE_INPUT,
      videos: [{ page: { slug: "hallelujah-chorus" }, youtubeVideo: { title: "Hallelujah Chorus" } }],
    });
    expect(result.relatedVideos).toEqual([{ slug: "hallelujah-chorus", title: "Hallelujah Chorus" }]);
  });

  it("maps collections straight through", () => {
    const result = assembleEntityPageData({
      ...BASE_INPUT,
      collections: [{ id: "c1", slug: "christmas-concerts", title: "Christmas Concerts" }],
    });
    expect(result.relatedCollections).toEqual([{ id: "c1", slug: "christmas-concerts", title: "Christmas Concerts" }]);
  });

  it("handles every section being empty without error", () => {
    const result = assembleEntityPageData(BASE_INPUT);
    expect(result.relatedProgrammes).toEqual([]);
    expect(result.relatedPerformances).toEqual([]);
    expect(result.relatedRecordings).toEqual([]);
    expect(result.relatedVideos).toEqual([]);
    expect(result.relatedCollections).toEqual([]);
  });
});
