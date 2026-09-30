import { describe, expect, it } from "vitest";
import {
  canApproveContentSuggestion,
  canRejectContentSuggestion,
  canRequestContentSuggestionChanges,
  canSubmitContentSuggestionForReview,
  isValidContentSuggestionTransition,
  type ContentSuggestionStatusValue,
} from "../../modules/publishing/contentSuggestionTransitions";

// Phase 6H-4 — pure state-machine tests for ContentSuggestion.status.

const ALL_STATUSES: ContentSuggestionStatusValue[] = ["DRAFT_READY", "EDITOR_REVIEW", "CHANGES_REQUESTED", "APPROVED", "REJECTED"];

describe("ContentSuggestion lifecycle transitions", () => {
  it("allows DRAFT_READY -> EDITOR_REVIEW only", () => {
    expect(canSubmitContentSuggestionForReview("DRAFT_READY")).toBe(true);
    for (const status of ALL_STATUSES.filter((s) => s !== "DRAFT_READY")) {
      expect(canSubmitContentSuggestionForReview(status)).toBe(false);
    }
  });

  it("allows approve/reject/request-changes only from EDITOR_REVIEW", () => {
    for (const status of ALL_STATUSES.filter((s) => s !== "EDITOR_REVIEW")) {
      expect(canApproveContentSuggestion(status)).toBe(false);
      expect(canRejectContentSuggestion(status)).toBe(false);
      expect(canRequestContentSuggestionChanges(status)).toBe(false);
    }
    expect(canApproveContentSuggestion("EDITOR_REVIEW")).toBe(true);
    expect(canRejectContentSuggestion("EDITOR_REVIEW")).toBe(true);
    expect(canRequestContentSuggestionChanges("EDITOR_REVIEW")).toBe(true);
  });

  it("treats APPROVED, REJECTED, and CHANGES_REQUESTED as terminal — no further transitions in this phase", () => {
    for (const terminal of ["APPROVED", "REJECTED", "CHANGES_REQUESTED"] as ContentSuggestionStatusValue[]) {
      for (const target of ALL_STATUSES) {
        expect(isValidContentSuggestionTransition(terminal, target)).toBe(false);
      }
    }
  });

  it("never allows skipping DRAFT_READY straight to APPROVED or REJECTED", () => {
    expect(isValidContentSuggestionTransition("DRAFT_READY", "APPROVED")).toBe(false);
    expect(isValidContentSuggestionTransition("DRAFT_READY", "REJECTED")).toBe(false);
  });
});
