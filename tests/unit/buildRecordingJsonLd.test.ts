import { describe, expect, it } from "vitest";
import { buildRecordingJsonLd } from "../../modules/mmke/recordingPage/buildRecordingJsonLd";
import type { RecordingPageData } from "../../modules/mmke/recordingPage/recordingPageContract";

const SITE_ORIGIN = "https://musicmadras.test";

function baseData(overrides: Partial<RecordingPageData> = {}): RecordingPageData {
  return {
    id: "rec-1",
    slug: "rec-1-slug",
    title: "Test Recording",
    description: null,
    seoMetaTitle: null,
    seoMetaDescription: null,
    seoCanonicalPath: null,
    educationalDifficultyLevel: null,
    educationalListeningGuide: null,
    educationalAnalysis: null,
    works: [],
    composers: [],
    programme: null,
    performance: null,
    videos: [],
    collections: [],
    ...overrides,
  };
}

describe("buildRecordingJsonLd", () => {
  it("produces syntactically valid JSON with the correct primary entity", () => {
    const jsonLd = buildRecordingJsonLd(baseData(), SITE_ORIGIN);
    expect(() => JSON.stringify(jsonLd)).not.toThrow();
    expect(jsonLd["@context"]).toBe("https://schema.org");
    expect(jsonLd["@type"]).toBe("MusicRecording");
    expect(jsonLd.url).toBe("https://musicmadras.test/recordings/rec-1-slug");
  });

  it("omits name/description/image/byArtist/composer/recordingOf entirely when no data supports them", () => {
    const jsonLd = buildRecordingJsonLd(baseData({ title: null }), SITE_ORIGIN);
    expect(jsonLd.name).toBeUndefined();
    expect(jsonLd.description).toBeUndefined();
    expect(jsonLd.image).toBeUndefined();
    expect(jsonLd.byArtist).toBeUndefined();
    expect(jsonLd.composer).toBeUndefined();
    expect(jsonLd.recordingOf).toBeUndefined();
  });

  it("includes byArtist only when performance artists exist", () => {
    const jsonLd = buildRecordingJsonLd(
      baseData({
        performance: {
          id: "performance-1",
          slug: "performance-1",
          performanceDate: null,
          venue: null,
          artists: [{ id: "artist-1", slug: "test-artist", name: "Test Artist", role: "Soloist" }],
          choirs: [],
          conductors: [],
        },
      }),
      SITE_ORIGIN
    );
    expect(jsonLd.byArtist).toEqual([{ "@type": "Person", name: "Test Artist" }]);
  });

  it("includes composer entries only when composers exist", () => {
    const jsonLd = buildRecordingJsonLd(baseData({ composers: [{ id: "composer-1", slug: "bach", name: "J.S. Bach" }] }), SITE_ORIGIN);
    expect(jsonLd.composer).toEqual([{ "@type": "Person", name: "J.S. Bach" }]);
  });

  it("includes recordingOf only when there is exactly one directly attached work", () => {
    const composer = { id: "composer-1", slug: "bach", name: "J.S. Bach" };
    const oneWork = buildRecordingJsonLd(
      baseData({ works: [{ id: "work-1", slug: "work-1", title: "Work One", composer }] }),
      SITE_ORIGIN
    );
    expect(oneWork.recordingOf).toEqual({ "@type": "MusicComposition", name: "Work One", composer: { "@type": "Person", name: "J.S. Bach" } });

    const twoWorks = buildRecordingJsonLd(
      baseData({
        works: [
          { id: "work-1", slug: "work-1", title: "Work One", composer },
          { id: "work-2", slug: "work-2", title: "Work Two", composer },
        ],
      }),
      SITE_ORIGIN
    );
    expect(twoWorks.recordingOf).toBeUndefined(); // ambiguous with more than one work — never guessed
  });

  it("never invents aggregate ratings, reviews, duration, or popularity properties", () => {
    const jsonLd = buildRecordingJsonLd(baseData(), SITE_ORIGIN) as unknown as Record<string, unknown>;
    expect(jsonLd.aggregateRating).toBeUndefined();
    expect(jsonLd.review).toBeUndefined();
    expect(jsonLd.duration).toBeUndefined();
    expect(jsonLd.interactionStatistic).toBeUndefined();
  });
});
