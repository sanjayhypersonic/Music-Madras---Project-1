import { describe, expect, it } from "vitest";
import { getApplicableTargetField, resolveContentToApply } from "../../modules/mmke/contentIntelligence/applyContentSuggestionRules";
import { describeApplyRefusalForEditor, type ApplyContentSuggestionRefusal } from "../../modules/mmke/contentIntelligence/applyContentSuggestionRefusal";
import { RECORDING_EDITORIAL_TARGET_FIELDS, isRecordingEditorialTargetField } from "../../modules/mmke/contentIntelligence/recordingEditorialTargetFields";
import { validateRecordingEditorialOutput } from "../../modules/ai/structuredOutput/validateRecordingEditorialOutput";
import type { RecordingContext } from "../../modules/mmke/contentIntelligence/recordingContextContract";

// Phase 6I-2 — pure, database-free tests for the decisions behind applying an
// approved ContentSuggestion to a Recording draft.

describe("recording editorial target fields", () => {
  it("are exactly the five editorial prose/SEO columns — never the title, performance, or any relationship", () => {
    expect([...RECORDING_EDITORIAL_TARGET_FIELDS].sort()).toEqual(
      ["description", "educationalAnalysis", "educationalListeningGuide", "seoMetaDescription", "seoMetaTitle"].sort()
    );
    for (const forbidden of ["title", "performanceId", "works", "mediaResources", "slug", "status", "composerId"]) {
      expect(isRecordingEditorialTargetField(forbidden)).toBe(false);
    }
  });

  it("is the same list the generation-time validator enforces (one source of truth, so the two gates cannot drift)", () => {
    const emptyContext = {
      works: [],
      composers: [],
      performance: null,
      media: [],
      collections: [],
      learningGuides: [],
      provenance: { sources: [], rights: [] },
    } as unknown as RecordingContext;

    for (const field of RECORDING_EDITORIAL_TARGET_FIELDS) {
      // A field the validator accepts must pass the apply gate...
      const raw = { outputType: "SUGGESTION", proposedContent: "x", targetField: field, evidenceEntityIds: [], missingField: null, whyItMatters: null, requestedAction: null };
      // ...(evidence is checked separately, so an empty evidence list is rejected for that reason, not the field)
      expect(() => validateRecordingEditorialOutput(raw, emptyContext)).toThrow(/evidence/i);
      expect(isRecordingEditorialTargetField(field)).toBe(true);
    }
    const bad = { outputType: "SUGGESTION", proposedContent: "x", targetField: "title", evidenceEntityIds: [], missingField: null, whyItMatters: null, requestedAction: null };
    expect(() => validateRecordingEditorialOutput(bad, emptyContext)).toThrow(/targetField/);
  });
});

describe("getApplicableTargetField", () => {
  it("returns the field for an EDITORIAL_PROSE suggestion targeting a whitelisted Recording field", () => {
    expect(getApplicableTargetField({ suggestionType: "EDITORIAL_PROSE", targetEntityType: "RECORDING", targetField: "educationalAnalysis" })).toBe("educationalAnalysis");
  });

  it("returns null for every other suggestion type", () => {
    for (const suggestionType of ["SEO_METADATA", "INTERNAL_LINK", "INFORMATION_GAP", "SOURCE_LEAD", "SEARCH_TERMINOLOGY", "CANONICAL_RELATIONSHIP_CANDIDATE"]) {
      expect(getApplicableTargetField({ suggestionType, targetEntityType: "RECORDING", targetField: "description" })).toBeNull();
    }
  });

  it("returns null for a non-Recording target, a missing field, or a field outside the whitelist", () => {
    expect(getApplicableTargetField({ suggestionType: "EDITORIAL_PROSE", targetEntityType: "COMPOSER", targetField: "description" })).toBeNull();
    expect(getApplicableTargetField({ suggestionType: "EDITORIAL_PROSE", targetEntityType: "RECORDING", targetField: null })).toBeNull();
    expect(getApplicableTargetField({ suggestionType: "EDITORIAL_PROSE", targetEntityType: "RECORDING", targetField: "title" })).toBeNull();
  });
});

describe("resolveContentToApply", () => {
  it("uses finalContent when the editor edited (finalContent ?? proposedContent)", () => {
    expect(resolveContentToApply({ finalContent: "Edited.", proposedContent: "Original." })).toEqual({ content: "Edited.", contentSource: "finalContent" });
  });

  it("uses proposedContent when there is no finalContent", () => {
    expect(resolveContentToApply({ finalContent: null, proposedContent: "Original." })).toEqual({ content: "Original.", contentSource: "proposedContent" });
  });
});

describe("describeApplyRefusalForEditor", () => {
  const ALL: ApplyContentSuggestionRefusal[] = [
    "SUGGESTION_NOT_FOUND",
    "NOT_APPROVED",
    "UNSUPPORTED_TARGET",
    "EMPTY_CONTENT",
    "ALREADY_APPLIED",
    "CONTENT_SUGGESTION_STALE",
    "FRESHNESS_UNKNOWN",
    "RECORDING_NOT_FOUND",
    "RECORDING_ARCHIVED",
    "NO_REVISION",
    "BUSY",
  ];

  it("has a non-empty, secret-free message for every refusal reason", () => {
    for (const reason of ALL) {
      const message = describeApplyRefusalForEditor(reason);
      expect(message.length).toBeGreaterThan(10);
      expect(message).not.toMatch(/uuid|stack|prisma|sql/i);
    }
  });

  it("tells the editor to regenerate when the suggestion is stale or unverifiable", () => {
    expect(describeApplyRefusalForEditor("CONTENT_SUGGESTION_STALE")).toMatch(/outdated Recording context/);
    expect(describeApplyRefusalForEditor("CONTENT_SUGGESTION_STALE")).toMatch(/Regenerate/);
    expect(describeApplyRefusalForEditor("FRESHNESS_UNKNOWN")).toMatch(/Regenerate/);
  });
});
