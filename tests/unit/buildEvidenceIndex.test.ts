import { describe, expect, it } from "vitest";
import { buildEvidenceIndex } from "../../modules/ai/structuredOutput/buildEvidenceIndex";
import type { RecordingContext } from "../../modules/mmke/contentIntelligence/recordingContextContract";

function baseContext(): RecordingContext {
  return {
    identity: { recordingId: "r1", slug: "r1", status: "PUBLISHED", revisionId: "rev1", revisionNumber: 1, revisionStatus: "PUBLISHED", mode: "PUBLISHED", title: "Test" },
    works: [
      {
        id: "work-1",
        slug: "work-1",
        title: "A Work",
        alternateTitles: [],
        catalogueNumber: null,
        keySignature: null,
        language: null,
        notes: null,
        composer: { id: "composer-1", slug: "composer-1", name: "A Composer", era: null, bornDate: null, diedDate: null, biography: null },
      },
    ],
    composers: [{ id: "composer-1", slug: "composer-1", name: "A Composer", era: null, bornDate: null, diedDate: null, biography: null }],
    performance: {
      id: "performance-1",
      slug: "performance-1",
      performanceDate: null,
      venue: {
        id: "venue-1",
        slug: "venue-1",
        name: "A Venue",
        type: "CHURCH",
        address: null,
        city: null,
        country: null,
        organisation: { id: "organisation-1", slug: "organisation-1", name: "An Organisation", description: null },
      },
      programme: null,
      performers: [{ id: "artist-1", slug: "artist-1", name: "An Artist", description: null, role: "Soloist" }],
      choirs: [{ id: "choir-1", slug: "choir-1", name: "A Choir", description: null, role: null }],
      conductors: [{ id: "conductor-1", slug: "conductor-1", name: "A Conductor", description: null, role: null }],
    },
    editorial: { description: null, educationalDifficultyLevel: null, educationalListeningGuide: null, educationalAnalysis: null, seoMetaTitle: null, seoMetaDescription: null },
    media: [{ id: "video-1", youtubeVideoId: "yt-1", title: null, description: null, publishedAt: null, durationSeconds: null, thumbnailUrl: null, publicSlug: null }],
    collections: [{ id: "collection-1", slug: "collection-1", title: "A Collection" }],
    learningGuides: [{ id: "guide-1", slug: "guide-1", title: "A Guide" }],
    provenance: {
      sources: [
        {
          id: "source-1",
          title: null,
          url: null,
          publisher: null,
          approvalState: "APPROVED",
          citations: [{ id: "citation-1", text: "An excerpt." }],
          attachedTo: { entityType: "RECORDING", entityId: "r1" },
        },
      ],
      rights: [{ id: "rights-1", holder: null, licenseType: null, attachedTo: { entityType: "RECORDING", entityId: "r1" } }],
    },
    completeness: { report: [], readiness: "INCOMPLETE", hasProvenance: true, gaps: [] },
  };
}

describe("buildEvidenceIndex", () => {
  it("indexes every entity id reachable from the context", () => {
    const index = buildEvidenceIndex(baseContext());
    for (const id of [
      "work-1",
      "composer-1",
      "performance-1",
      "venue-1",
      "organisation-1",
      "artist-1",
      "choir-1",
      "conductor-1",
      "video-1",
      "collection-1",
      "guide-1",
      "source-1",
      "rights-1",
      "citation-1",
    ]) {
      expect(index.has(id)).toBe(true);
    }
  });

  it("never indexes an id not present in the context", () => {
    const index = buildEvidenceIndex(baseContext());
    expect(index.has("some-invented-id")).toBe(false);
  });

  it("tags the correct sourceType per section", () => {
    const index = buildEvidenceIndex(baseContext());
    expect(index.get("work-1")?.sourceType).toBe("CANONICAL_MMKE");
    expect(index.get("video-1")?.sourceType).toBe("YOUTUBE_METADATA");
    expect(index.get("source-1")?.sourceType).toBe("APPROVED_EXTERNAL_SOURCE");
  });

  it("handles a context with no performance and no provenance without throwing", () => {
    const context = { ...baseContext(), performance: null, provenance: { sources: [], rights: [] } };
    expect(() => buildEvidenceIndex(context)).not.toThrow();
    const index = buildEvidenceIndex(context);
    expect(index.has("performance-1")).toBe(false);
  });

  describe("Phase 6H-8 — Citation-level evidence", () => {
    it("indexes a Citation as its own evidence entity, distinct from its parent Source", () => {
      const index = buildEvidenceIndex(baseContext());
      expect(index.get("citation-1")).toEqual({ sourceType: "APPROVED_EXTERNAL_SOURCE", entityType: "Citation", entityId: "citation-1", field: "provenance" });
      expect(index.get("source-1")).toEqual({ sourceType: "APPROVED_EXTERNAL_SOURCE", entityType: "Source", entityId: "source-1", field: "provenance" });
    });

    it("never indexes a Citation that is not present in the supplied context", () => {
      const index = buildEvidenceIndex(baseContext());
      expect(index.has("some-invented-citation-id")).toBe(false);
    });

    it("a Source with no citations still indexes the Source itself but adds no extra Citation entries", () => {
      const context = {
        ...baseContext(),
        provenance: {
          sources: [{ id: "source-2", title: null, url: null, publisher: null, approvalState: "APPROVED" as const, citations: [], attachedTo: { entityType: "RECORDING", entityId: "r1" } }],
          rights: [],
        },
      };
      const index = buildEvidenceIndex(context);
      expect(index.has("source-2")).toBe(true);
      expect(index.size).toBe(
        buildEvidenceIndex({ ...baseContext(), provenance: { sources: [], rights: [] } }).size + 1
      );
    });
  });
});
