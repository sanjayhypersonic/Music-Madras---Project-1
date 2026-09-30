import { describe, expect, it } from "vitest";
import { RecordingEditorialOutputValidationError, validateRecordingEditorialOutput } from "../../modules/ai/structuredOutput/validateRecordingEditorialOutput";
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
    performance: null,
    editorial: { description: null, educationalDifficultyLevel: null, educationalListeningGuide: null, educationalAnalysis: null, seoMetaTitle: null, seoMetaDescription: null },
    media: [],
    collections: [],
    learningGuides: [],
    provenance: { sources: [], rights: [] },
    completeness: { report: [], readiness: "INCOMPLETE", hasProvenance: false, gaps: [] },
  };
}

const validSuggestionOutput = {
  outputType: "SUGGESTION",
  proposedContent: "This recording features A Work by A Composer.",
  targetField: "educationalListeningGuide",
  evidenceEntityIds: ["work-1", "composer-1"],
  missingField: null,
  whyItMatters: null,
  requestedAction: null,
};

const validGapOutput = {
  outputType: "INFORMATION_GAP",
  proposedContent: null,
  targetField: null,
  evidenceEntityIds: [],
  missingField: "performance",
  whyItMatters: "No performance is linked, so no venue or date context exists.",
  requestedAction: "Attach a Performance to this recording.",
};

describe("validateRecordingEditorialOutput — SUGGESTION", () => {
  it("accepts a well-formed suggestion and resolves evidence to real context entities", () => {
    const result = validateRecordingEditorialOutput(validSuggestionOutput, baseContext());
    expect(result.kind).toBe("SUGGESTION");
    if (result.kind !== "SUGGESTION") return;
    expect(result.proposedContent).toBe(validSuggestionOutput.proposedContent);
    expect(result.targetField).toBe("educationalListeningGuide");
    expect(result.evidenceRefs.map((r) => r.entityId).sort()).toEqual(["composer-1", "work-1"]);
  });

  it("silently drops evidence ids not present in the supplied context, keeping only valid ones", () => {
    const result = validateRecordingEditorialOutput({ ...validSuggestionOutput, evidenceEntityIds: ["work-1", "invented-id"] }, baseContext());
    expect(result.kind).toBe("SUGGESTION");
    if (result.kind !== "SUGGESTION") return;
    expect(result.evidenceRefs).toHaveLength(1);
    expect(result.evidenceRefs[0].entityId).toBe("work-1");
  });

  it("rejects a suggestion whose evidence ids are ALL invented — the model may only reason over supplied evidence", () => {
    expect(() => validateRecordingEditorialOutput({ ...validSuggestionOutput, evidenceEntityIds: ["invented-1", "invented-2"] }, baseContext())).toThrow(
      RecordingEditorialOutputValidationError
    );
  });

  it("rejects an empty proposedContent", () => {
    expect(() => validateRecordingEditorialOutput({ ...validSuggestionOutput, proposedContent: "" }, baseContext())).toThrow(RecordingEditorialOutputValidationError);
  });

  it("rejects proposedContent over the length limit", () => {
    expect(() => validateRecordingEditorialOutput({ ...validSuggestionOutput, proposedContent: "x".repeat(5000) }, baseContext())).toThrow(
      RecordingEditorialOutputValidationError
    );
  });

  it("rejects a targetField outside the allowed whitelist", () => {
    expect(() => validateRecordingEditorialOutput({ ...validSuggestionOutput, targetField: "title" }, baseContext())).toThrow(RecordingEditorialOutputValidationError);
  });

  it("rejects an evidenceEntityIds value that isn't an array of strings", () => {
    expect(() => validateRecordingEditorialOutput({ ...validSuggestionOutput, evidenceEntityIds: "work-1" }, baseContext())).toThrow(RecordingEditorialOutputValidationError);
    expect(() => validateRecordingEditorialOutput({ ...validSuggestionOutput, evidenceEntityIds: [123] }, baseContext())).toThrow(RecordingEditorialOutputValidationError);
  });
});

describe("validateRecordingEditorialOutput — INFORMATION_GAP", () => {
  it("accepts a well-formed gap", () => {
    const result = validateRecordingEditorialOutput(validGapOutput, baseContext());
    expect(result.kind).toBe("INFORMATION_GAP");
    if (result.kind !== "INFORMATION_GAP") return;
    expect(result.missingField).toBe("performance");
  });

  it("rejects a gap missing whyItMatters", () => {
    expect(() => validateRecordingEditorialOutput({ ...validGapOutput, whyItMatters: null }, baseContext())).toThrow(RecordingEditorialOutputValidationError);
  });

  it("never fabricates a resolution — requestedAction must be present, never inferred", () => {
    expect(() => validateRecordingEditorialOutput({ ...validGapOutput, requestedAction: "" }, baseContext())).toThrow(RecordingEditorialOutputValidationError);
  });
});

describe("validateRecordingEditorialOutput — structural rejection", () => {
  it("rejects a non-object", () => {
    expect(() => validateRecordingEditorialOutput("just a string", baseContext())).toThrow(RecordingEditorialOutputValidationError);
    expect(() => validateRecordingEditorialOutput(null, baseContext())).toThrow(RecordingEditorialOutputValidationError);
    expect(() => validateRecordingEditorialOutput(["array"], baseContext())).toThrow(RecordingEditorialOutputValidationError);
  });

  it("rejects an invalid outputType", () => {
    expect(() => validateRecordingEditorialOutput({ ...validSuggestionOutput, outputType: "FACT" }, baseContext())).toThrow(RecordingEditorialOutputValidationError);
  });

  it("rejects unexpected extra properties rather than silently ignoring them", () => {
    expect(() => validateRecordingEditorialOutput({ ...validSuggestionOutput, confidence: 0.9 }, baseContext())).toThrow(RecordingEditorialOutputValidationError);
  });

  it("never coerces malformed output into a valid object — it always throws, never returns a partial result", () => {
    expect(() => validateRecordingEditorialOutput({}, baseContext())).toThrow(RecordingEditorialOutputValidationError);
  });
});
