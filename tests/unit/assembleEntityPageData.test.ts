import { describe, expect, it } from "vitest";
import { assembleEntityPageData } from "../../modules/mmke/entityPage/assembleEntityPageData";

// Phase 6G-4A/6G-4B: pure mapping tests, no database — the same fixture
// shape the real Prisma query results structurally satisfy.

const BASE_INPUT = {
  entityType: "composer" as const,
  id: "composer-1",
  slug: "test-composer",
  name: "Test Composer",
  description: "A short biography.",
  lifespan: { bornDate: "1685", diedDate: "1750", era: "Baroque" },
  venueDetails: null,
  works: [],
  composers: null,
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
    expect(result.lifespan).toEqual({ bornDate: "1685", diedDate: "1750", era: "Baroque" });
  });

  it("returns lifespan as null for an entity type that has no lifespan-equivalent field", () => {
    const result = assembleEntityPageData({ ...BASE_INPUT, entityType: "venue", works: null, lifespan: null });
    expect(result.lifespan).toBeNull();
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

  it("maps performances, deriving venueName/venueSlug and participant names, and handling a null venue", () => {
    const result = assembleEntityPageData({
      ...BASE_INPUT,
      performances: [
        {
          id: "p1",
          slug: "requiem-premiere-st-andrews-church-2024-01-01",
          performanceDate: new Date("2024-01-01"),
          venue: { name: "St. Andrew's Church", slug: "st-andrews-church" },
          performers: [{ artist: { name: "Jane Soloist", slug: "jane-soloist" } }],
          choirs: [{ choir: { name: "St. Andrew's Choir", slug: "st-andrews-choir" } }],
          conductors: [{ conductor: { name: "John Conductor", slug: "john-conductor" } }],
        },
        { id: "p2", slug: "second-performance", performanceDate: null, venue: null, performers: [], choirs: [], conductors: [] },
      ],
    });
    expect(result.relatedPerformances).toEqual([
      {
        id: "p1",
        slug: "requiem-premiere-st-andrews-church-2024-01-01",
        performanceDate: new Date("2024-01-01"),
        venueName: "St. Andrew's Church",
        venueSlug: "st-andrews-church",
        artists: [{ name: "Jane Soloist", slug: "jane-soloist" }],
        choirs: [{ name: "St. Andrew's Choir", slug: "st-andrews-choir" }],
        conductors: [{ name: "John Conductor", slug: "john-conductor" }],
      },
      {
        id: "p2",
        slug: "second-performance",
        performanceDate: null,
        venueName: null,
        venueSlug: null,
        artists: [],
        choirs: [],
        conductors: [],
      },
    ]);
  });

  it("derives relatedParticipants deduped across every performance", () => {
    const result = assembleEntityPageData({
      ...BASE_INPUT,
      performances: [
        {
          id: "p1",
          slug: "performance-one",
          performanceDate: null,
          venue: { name: "St. Andrew's Church", slug: "st-andrews-church" },
          performers: [{ artist: { name: "Jane Soloist", slug: "jane-soloist" } }],
          choirs: [{ choir: { name: "St. Andrew's Choir", slug: "st-andrews-choir" } }],
          conductors: [{ conductor: { name: "John Conductor", slug: "john-conductor" } }],
        },
        {
          id: "p2",
          slug: "performance-two",
          performanceDate: null,
          venue: { name: "St. Andrew's Church", slug: "st-andrews-church" }, // same venue again — must dedupe
          performers: [{ artist: { name: "Jane Soloist", slug: "jane-soloist" } }], // same artist again — must dedupe
          choirs: [],
          conductors: [{ conductor: { name: "Second Conductor", slug: "second-conductor" } }],
        },
      ],
    });
    expect(result.relatedParticipants).toEqual({
      artists: [{ name: "Jane Soloist", slug: "jane-soloist" }],
      choirs: [{ name: "St. Andrew's Choir", slug: "st-andrews-choir" }],
      conductors: [{ name: "John Conductor", slug: "john-conductor" }, { name: "Second Conductor", slug: "second-conductor" }],
      venues: [{ name: "St. Andrew's Church", slug: "st-andrews-church" }],
    });
  });

  it("returns empty relatedParticipants for no performances", () => {
    const result = assembleEntityPageData(BASE_INPUT);
    expect(result.relatedParticipants).toEqual({ artists: [], choirs: [], conductors: [], venues: [] });
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

  it("maps videos to the public /videos/[slug] shape, including the thumbnail", () => {
    const result = assembleEntityPageData({
      ...BASE_INPUT,
      videos: [{ page: { slug: "hallelujah-chorus" }, youtubeVideo: { title: "Hallelujah Chorus", thumbnailUrl: "https://i.ytimg.com/vi/abc/hqdefault.jpg" } }],
    });
    expect(result.relatedVideos).toEqual([
      { slug: "hallelujah-chorus", title: "Hallelujah Chorus", thumbnailUrl: "https://i.ytimg.com/vi/abc/hqdefault.jpg" },
    ]);
  });

  it("maps collections straight through", () => {
    const result = assembleEntityPageData({
      ...BASE_INPUT,
      collections: [{ id: "c1", slug: "christmas-concerts", title: "Christmas Concerts" }],
    });
    expect(result.relatedCollections).toEqual([{ id: "c1", slug: "christmas-concerts", title: "Christmas Concerts" }]);
  });

  it("maps venueDetails and relatedComposers straight through (Phase 6G-6, Venue-only fields)", () => {
    const result = assembleEntityPageData({
      ...BASE_INPUT,
      entityType: "venue",
      works: [{ id: "w1", slug: "requiem", title: "Requiem" }],
      composers: [{ id: "c1", slug: "mozart", name: "W.A. Mozart" }],
      venueDetails: { type: "CHURCH", address: "1 Church St", city: "Chennai", country: "India", organisation: { id: "org-1", slug: "test-trust", name: "Test Trust" } },
    });
    expect(result.relatedComposers).toEqual([{ id: "c1", slug: "mozart", name: "W.A. Mozart" }]);
    expect(result.venueDetails).toEqual({ type: "CHURCH", address: "1 Church St", city: "Chennai", country: "India", organisation: { id: "org-1", slug: "test-trust", name: "Test Trust" } });
  });

  it("returns venueDetails and relatedComposers as null for entity types that don't populate them", () => {
    const result = assembleEntityPageData(BASE_INPUT);
    expect(result.venueDetails).toBeNull();
    expect(result.relatedComposers).toBeNull();
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
