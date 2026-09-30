import { describe, expect, it } from "vitest";
import { computeContextFingerprint } from "../../modules/mmke/contentIntelligence/computeContextFingerprint";
import type { RecordingContext } from "../../modules/mmke/contentIntelligence/recordingContextContract";

// Phase 6H-4 — determinism tests for the context fingerprint: the minimum
// mechanism for suggestion staleness detection (6H-2 §31).

function baseContext(): RecordingContext {
  return {
    identity: { recordingId: "r1", slug: "r1", status: "PUBLISHED", revisionId: "rev1", revisionNumber: 1, revisionStatus: "PUBLISHED", mode: "PUBLISHED", title: "Test" },
    works: [],
    composers: [],
    performance: null,
    editorial: { description: null, educationalDifficultyLevel: null, educationalListeningGuide: null, educationalAnalysis: null, seoMetaTitle: null, seoMetaDescription: null },
    media: [],
    collections: [],
    learningGuides: [],
    provenance: { sources: [], rights: [] },
    completeness: { report: [], readiness: "INCOMPLETE", hasProvenance: false, gaps: [] },
  };
}

describe("computeContextFingerprint", () => {
  it("produces identical fingerprints for identical context content", () => {
    const a = computeContextFingerprint(baseContext());
    const b = computeContextFingerprint(baseContext());
    expect(a).toBe(b);
  });

  it("produces a different fingerprint when any meaningful field changes", () => {
    const original = computeContextFingerprint(baseContext());
    const changed = computeContextFingerprint({ ...baseContext(), editorial: { ...baseContext().editorial, description: "New description" } });
    expect(changed).not.toBe(original);
  });

  it("produces a different fingerprint when a work is added", () => {
    const original = computeContextFingerprint(baseContext());
    const withWork = computeContextFingerprint({
      ...baseContext(),
      works: [
        {
          id: "w1",
          slug: "w1",
          title: "A Work",
          alternateTitles: [],
          catalogueNumber: null,
          keySignature: null,
          language: null,
          notes: null,
          composer: { id: "c1", slug: "c1", name: "A Composer", era: null, bornDate: null, diedDate: null, biography: null },
        },
      ],
    });
    expect(withWork).not.toBe(original);
  });

  it("returns a hex-encoded sha256-length string", () => {
    const fingerprint = computeContextFingerprint(baseContext());
    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });
});
