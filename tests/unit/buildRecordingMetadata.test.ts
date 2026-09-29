import { describe, expect, it } from "vitest";
import { buildRecordingMetadata } from "../../modules/mmke/recordingPage/buildRecordingMetadata";
import type { RecordingPageData } from "../../modules/mmke/recordingPage/recordingPageContract";

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
    learningGuides: [],
    ...overrides,
  };
}

describe("buildRecordingMetadata", () => {
  it("uses the authored seoMetaTitle/seoMetaDescription/seoCanonicalPath when present", () => {
    const data = baseData({
      seoMetaTitle: "Authored Title",
      seoMetaDescription: "Authored description.",
      seoCanonicalPath: "/recordings/custom-path",
    });

    const metadata = buildRecordingMetadata(data);
    expect(metadata.title).toBe("Authored Title");
    expect(metadata.description).toBe("Authored description.");
    expect(metadata.canonicalPath).toBe("/recordings/custom-path");
  });

  it("falls back to the Recording's own title and slug when no SEO fields are authored", () => {
    const data = baseData();
    const metadata = buildRecordingMetadata(data);
    expect(metadata.title).toBe("Test Recording — Music Madras");
    expect(metadata.canonicalPath).toBe("/recordings/rec-1-slug");
  });

  it("falls back to the revision description when no seoMetaDescription is authored", () => {
    const data = baseData({ description: "A real archived description." });
    const metadata = buildRecordingMetadata(data);
    expect(metadata.description).toBe("A real archived description.");
  });

  it("does not invent a description when nothing factual is available", () => {
    const data = baseData();
    const metadata = buildRecordingMetadata(data);
    expect(metadata.description).toBeUndefined();
  });

  it("builds a conservative factual fallback description from performance context when available", () => {
    const data = baseData({
      performance: {
        id: "performance-1",
        slug: "performance-1",
        performanceDate: null,
        venue: { id: "venue-1", slug: "test-hall", name: "Test Hall", organisation: null },
        artists: [],
        choirs: [],
        conductors: [],
      },
    });

    const metadata = buildRecordingMetadata(data);
    expect(metadata.description).toContain("Test Hall");
  });

  it("uses the first public video's thumbnail as the OpenGraph image", () => {
    const data = baseData({ videos: [{ slug: "video-1", title: "Video", thumbnailUrl: "https://example.com/thumb.jpg" }] });
    const metadata = buildRecordingMetadata(data);
    expect(metadata.openGraphImage).toBe("https://example.com/thumb.jpg");
  });

  it("has no OpenGraph image when there is no public video", () => {
    const data = baseData();
    const metadata = buildRecordingMetadata(data);
    expect(metadata.openGraphImage).toBeUndefined();
  });
});
