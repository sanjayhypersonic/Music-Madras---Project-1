// Pure state-machine rules for ContentSuggestion.status (Phase 6H-4).
// Mirrors modules/publishing/videoPageTransitions.ts's shape: no database,
// no framework, shared by the repository and its tests.
//
// DRAFT_READY -> EDITOR_REVIEW -> {APPROVED | REJECTED | CHANGES_REQUESTED}.
// APPROVED/REJECTED/CHANGES_REQUESTED are terminal in this phase — no
// generator exists yet to act on a CHANGES_REQUESTED suggestion, so there
// is deliberately no transition back out of it here. A future regeneration
// mechanism creates a NEW ContentGenerationRequest/ContentSuggestion pair
// against the same target (docs/content-intelligence-architecture.md Phase
// 6H-2 §25's "request regeneration" — never a mutation of the original).

export type ContentSuggestionStatusValue = "DRAFT_READY" | "EDITOR_REVIEW" | "CHANGES_REQUESTED" | "APPROVED" | "REJECTED";

const VALID_TRANSITIONS: Record<ContentSuggestionStatusValue, ContentSuggestionStatusValue[]> = {
  DRAFT_READY: ["EDITOR_REVIEW"],
  EDITOR_REVIEW: ["APPROVED", "REJECTED", "CHANGES_REQUESTED"],
  CHANGES_REQUESTED: [],
  APPROVED: [],
  REJECTED: [],
};

export function isValidContentSuggestionTransition(from: ContentSuggestionStatusValue, to: ContentSuggestionStatusValue): boolean {
  return VALID_TRANSITIONS[from].includes(to);
}

export function canSubmitContentSuggestionForReview(status: ContentSuggestionStatusValue): boolean {
  return isValidContentSuggestionTransition(status, "EDITOR_REVIEW");
}

export function canApproveContentSuggestion(status: ContentSuggestionStatusValue): boolean {
  return isValidContentSuggestionTransition(status, "APPROVED");
}

export function canRejectContentSuggestion(status: ContentSuggestionStatusValue): boolean {
  return isValidContentSuggestionTransition(status, "REJECTED");
}

export function canRequestContentSuggestionChanges(status: ContentSuggestionStatusValue): boolean {
  return isValidContentSuggestionTransition(status, "CHANGES_REQUESTED");
}
