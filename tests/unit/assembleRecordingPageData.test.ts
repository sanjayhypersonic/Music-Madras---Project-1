import { describe, expect, it } from "vitest";
import { assembleRecordingPageData, type AssembleRecordingPageDataInput } from "../../modules/mmke/recordingPage/assembleRecordingPageData";

function baseInput(): AssembleRecordingPageDataInput {
  return {
    id: "rec-1",
    slug: "rec-1-slug",
    title: "Test Recording",
    description: "A test description.",
    seoMetaTitle: null,
    seoMetaDescription: null,
    seoCanonicalPath: null,
    educationalDifficultyLevel: null,
    educationalListeningGuide: null,
    educationalAnalysis: null,
    works: [],
    programme: null,
    performance: null,
    videos: [],
    collections: [],
  };
}

describe("assembleRecordingPageData", () => {
  it("maps flat fields through unchanged", () => {
    const result = assembleRecordingPageData(baseInput());
    expect(result.id).toBe("rec-1");
    expect(result.slug).toBe("rec-1-slug");
    expect(result.title).toBe("Test Recording");
    expect(result.description).toBe("A test description.");
  });

  it("dedupes composers across multiple works by the same composer", () => {
    const composer = { id: "composer-1", slug: "bach", name: "J.S. Bach" };
    const input = baseInput();
    input.works = [
      { id: "work-1", slug: "work-1", title: "Work One", composer },
      { id: "work-2", slug: "work-2", title: "Work Two", composer },
    ];

    const result = assembleRecordingPageData(input);
    expect(result.works).toHaveLength(2);
    expect(result.composers).toHaveLength(1);
    expect(result.composers[0].id).toBe("composer-1");
  });

  it("returns null programme/performance when none is linked, without throwing", () => {
    const result = assembleRecordingPageData(baseInput());
    expect(result.programme).toBeNull();
    expect(result.performance).toBeNull();
  });

  it("maps programme items in order with movement/encore flags", () => {
    const input = baseInput();
    input.programme = {
      id: "programme-1",
      slug: "programme-1",
      title: "Test Programme",
      items: [
        { id: "item-1", movement: "I. Allegro", isEncore: false, musicalWork: { id: "work-1", slug: "work-1", title: "Work One" } },
        { id: "item-2", movement: null, isEncore: true, musicalWork: { id: "work-2", slug: "work-2", title: "Work Two" } },
      ],
    };

    const result = assembleRecordingPageData(input);
    expect(result.programme?.items).toHaveLength(2);
    expect(result.programme?.items[0].movement).toBe("I. Allegro");
    expect(result.programme?.items[0].isEncore).toBe(false);
    expect(result.programme?.items[1].isEncore).toBe(true);
  });

  it("maps performance venue/organisation/participants through", () => {
    const input = baseInput();
    input.performance = {
      id: "performance-1",
      performanceDate: new Date("2020-01-01"),
      venue: { id: "venue-1", name: "Test Hall", organisation: { id: "org-1", name: "Test Org" } },
      performers: [{ artist: { id: "artist-1", name: "Test Artist" }, role: "Soloist" }],
      choirs: [{ choir: { id: "choir-1", name: "Test Choir" } }],
      conductors: [{ conductor: { id: "conductor-1", name: "Test Conductor" } }],
    };

    const result = assembleRecordingPageData(input);
    expect(result.performance?.venue?.organisation?.name).toBe("Test Org");
    expect(result.performance?.artists[0]).toEqual({ id: "artist-1", name: "Test Artist", role: "Soloist" });
    expect(result.performance?.choirs[0]).toEqual({ id: "choir-1", name: "Test Choir" });
    expect(result.performance?.conductors[0]).toEqual({ id: "conductor-1", name: "Test Conductor" });
  });

  it("maps a performance with no venue to a null venue, never throwing", () => {
    const input = baseInput();
    input.performance = {
      id: "performance-1",
      performanceDate: null,
      venue: null,
      performers: [],
      choirs: [],
      conductors: [],
    };

    const result = assembleRecordingPageData(input);
    expect(result.performance?.venue).toBeNull();
  });

  it("maps videos and collections through", () => {
    const input = baseInput();
    input.videos = [{ page: { slug: "video-1" }, youtubeVideo: { title: "Video One", thumbnailUrl: "https://example.com/thumb.jpg" } }];
    input.collections = [{ id: "collection-1", slug: "collection-1", title: "Test Collection" }];

    const result = assembleRecordingPageData(input);
    expect(result.videos).toEqual([{ slug: "video-1", title: "Video One", thumbnailUrl: "https://example.com/thumb.jpg" }]);
    expect(result.collections).toEqual([{ id: "collection-1", slug: "collection-1", title: "Test Collection" }]);
  });
});
