import { describe, expect, it } from "vitest";
import { assembleRecordingContext, type AssembleRecordingContextInput } from "../../modules/mmke/contentIntelligence/assembleRecordingContext";
import { RECORDING_CONTEXT_SOURCE_MAP } from "../../modules/mmke/contentIntelligence/recordingContextContract";

// Phase 6H-3 — pure, DB-free tests for the Recording Context Assembler's
// shaping/derivation logic: determinism, gap detection, and dedup. The
// real-database wiring (getRecordingContext) is covered separately in
// tests/integration/recordingContextRepository.test.ts.

function baseInput(overrides: Partial<AssembleRecordingContextInput> = {}): AssembleRecordingContextInput {
  return {
    recording: { id: "recording-1", slug: "recording-1-slug", status: "PUBLISHED" },
    revision: {
      id: "revision-1",
      revisionNumber: 1,
      revisionStatus: "PUBLISHED",
      title: "Test Recording",
      description: null,
      seoMetaTitle: null,
      seoMetaDescription: null,
      educationalDifficultyLevel: null,
      educationalListeningGuide: null,
      educationalAnalysis: null,
      works: [],
      mediaResources: [],
      performance: null,
    },
    mode: "PUBLISHED",
    publicSlugByVideoId: new Map(),
    collections: [],
    learningGuides: [],
    sources: [],
    rights: [],
    completenessReport: [],
    readiness: "INCOMPLETE",
    ...overrides,
  };
}

const composer = { id: "composer-1", slug: "composer-1", name: "Test Composer", era: null, bornDate: null, diedDate: null, biography: "A biography." };
const work = {
  musicalWorkId: "work-1",
  musicalWork: {
    id: "work-1",
    slug: "work-1",
    title: "Test Work",
    alternateTitles: [],
    catalogueNumber: null,
    keySignature: null,
    language: null,
    notes: null,
    composer,
  },
};

describe("assembleRecordingContext — determinism", () => {
  it("sorts performers, choirs, and conductors by name regardless of input order", () => {
    const input = baseInput({
      revision: {
        ...baseInput().revision,
        performance: {
          id: "performance-1",
          slug: "performance-1",
          performanceDate: null,
          venue: { id: "venue-1", slug: "venue-1", name: "Test Venue", type: "CHURCH", address: null, city: null, country: null, organisation: null },
          programme: null,
          performers: [
            { role: "Soloist", artist: { id: "artist-b", slug: "artist-b", name: "Zeta Artist", biography: null } },
            { role: "Soloist", artist: { id: "artist-a", slug: "artist-a", name: "Alpha Artist", biography: null } },
          ],
          choirs: [],
          conductors: [],
        },
      },
    });

    const context = assembleRecordingContext(input);
    expect(context.performance?.performers.map((p) => p.name)).toEqual(["Alpha Artist", "Zeta Artist"]);
  });

  it("sorts media by publishedAt then id, independent of input order", () => {
    const older = {
      provider: "YOUTUBE",
      youtubeVideoId: "yt-old",
      youtubeVideo: { id: "yt-old", youtubeVideoId: "yt-old", title: "Old", description: null, publishedAt: new Date("2020-01-01"), durationSeconds: null, thumbnailUrl: null },
    };
    const newer = {
      provider: "YOUTUBE",
      youtubeVideoId: "yt-new",
      youtubeVideo: { id: "yt-new", youtubeVideoId: "yt-new", title: "New", description: null, publishedAt: new Date("2023-01-01"), durationSeconds: null, thumbnailUrl: null },
    };
    const input = baseInput({ revision: { ...baseInput().revision, mediaResources: [newer, older] } });

    const context = assembleRecordingContext(input);
    expect(context.media.map((m) => m.id)).toEqual(["yt-old", "yt-new"]);
  });

  it("produces identical output for identical input (called twice)", () => {
    const input = baseInput({ revision: { ...baseInput().revision, works: [work] } });
    expect(assembleRecordingContext(input)).toEqual(assembleRecordingContext(input));
  });
});

describe("assembleRecordingContext — composer dedup", () => {
  it("dedupes composers across multiple works by the same composer", () => {
    const secondWork = { ...work, musicalWorkId: "work-2", musicalWork: { ...work.musicalWork, id: "work-2", slug: "work-2", title: "Second Work" } };
    const input = baseInput({ revision: { ...baseInput().revision, works: [work, secondWork] } });

    const context = assembleRecordingContext(input);
    expect(context.works).toHaveLength(2);
    expect(context.composers).toHaveLength(1);
    expect(context.composers[0].id).toBe(composer.id);
  });
});

describe("assembleRecordingContext — information gaps", () => {
  it("flags WORK, PERFORMANCE, MEDIA, PROVENANCE, and EDITORIAL_CONTENT as MISSING for a bare recording", () => {
    const context = assembleRecordingContext(baseInput());
    const gapFields = context.completeness.gaps.map((g) => `${g.field}:${g.state}`);

    expect(gapFields).toContain("WORK:MISSING");
    expect(gapFields).toContain("PERFORMANCE:MISSING");
    expect(gapFields).toContain("MEDIA:MISSING");
    expect(gapFields).toContain("PROVENANCE:MISSING");
    expect(gapFields).toContain("EDITORIAL_CONTENT:MISSING");
    // No performance at all means the Venue-has-no-description NOT_APPLICABLE
    // note must not appear — there is no venue to note it about.
    expect(context.completeness.gaps.some((g) => g.state === "NOT_APPLICABLE")).toBe(false);
    expect(context.completeness.hasProvenance).toBe(false);
  });

  it("flags the Venue description gap as NOT_APPLICABLE (a schema gap), never as MISSING, once a Performance exists", () => {
    const input = baseInput({
      revision: {
        ...baseInput().revision,
        works: [work],
        educationalListeningGuide: "A guide.",
        performance: {
          id: "performance-1",
          slug: "performance-1",
          performanceDate: null,
          venue: { id: "venue-1", slug: "venue-1", name: "Test Venue", type: "CHURCH", address: null, city: null, country: null, organisation: null },
          programme: null,
          performers: [{ role: "Soloist", artist: { id: "artist-1", slug: "artist-1", name: "Test Artist", biography: null } }],
          choirs: [],
          conductors: [],
        },
      },
    });

    const context = assembleRecordingContext(input);
    const venueGap = context.completeness.gaps.find((g) => g.field === "EDITORIAL_CONTENT" && g.state === "NOT_APPLICABLE");
    expect(venueGap).toBeDefined();
    expect(context.completeness.gaps.map((g) => `${g.field}:${g.state}`)).not.toContain("WORK:MISSING");
    expect(context.completeness.gaps.map((g) => `${g.field}:${g.state}`)).not.toContain("PERFORMANCE:MISSING");
    expect(context.completeness.gaps.map((g) => `${g.field}:${g.state}`)).not.toContain("PARTICIPANTS:MISSING");
    expect(context.completeness.gaps.map((g) => `${g.field}:${g.state}`)).not.toContain("EDITORIAL_CONTENT:MISSING");
  });

  it("reports hasProvenance true once at least one Source or RightsInformation is attached", () => {
    const input = baseInput({
      sources: [{ entityType: "RECORDING", entityId: "recording-1", source: { id: "source-1", title: "A Source", url: null, publisher: null } }],
    });
    const context = assembleRecordingContext(input);
    expect(context.completeness.hasProvenance).toBe(true);
    expect(context.completeness.gaps.map((g) => `${g.field}:${g.state}`)).not.toContain("PROVENANCE:MISSING");
  });
});

describe("assembleRecordingContext — data minimization / no AI content", () => {
  it("never includes AI_GENERATED in the static source classification map", () => {
    expect(Object.values(RECORDING_CONTEXT_SOURCE_MAP)).not.toContain("AI_GENERATED");
  });

  it("includes YouTube description verbatim as source data, never rewritten", () => {
    const rawDescription = "Recorded live at St. Andrew's Church.\n#chennai #choir";
    const input = baseInput({
      revision: {
        ...baseInput().revision,
        mediaResources: [
          {
            provider: "YOUTUBE",
            youtubeVideoId: "yt-1",
            youtubeVideo: { id: "yt-1", youtubeVideoId: "yt-1", title: "A Video", description: rawDescription, publishedAt: null, durationSeconds: null, thumbnailUrl: null },
          },
        ],
      },
    });
    const context = assembleRecordingContext(input);
    expect(context.media[0].description).toBe(rawDescription);
  });
});
