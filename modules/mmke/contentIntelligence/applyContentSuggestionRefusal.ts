// Phase 6I-2 — the closed set of reasons applying an approved
// ContentSuggestion to a Recording draft can be refused, plus the editor-facing
// wording for each. Pure, Prisma-free (ADR §3 boundary rule): shared by the
// repository that decides, the Server Action that reports, and the review
// page that explains why the button is absent.

export type ApplyContentSuggestionRefusal =
  | "SUGGESTION_NOT_FOUND"
  | "NOT_APPROVED"
  | "UNSUPPORTED_TARGET"
  | "EMPTY_CONTENT"
  | "ALREADY_APPLIED"
  | "CONTENT_SUGGESTION_STALE"
  | "FRESHNESS_UNKNOWN"
  | "RECORDING_NOT_FOUND"
  | "RECORDING_ARCHIVED"
  | "NO_REVISION";

export function describeApplyRefusalForEditor(reason: ApplyContentSuggestionRefusal): string {
  switch (reason) {
    case "CONTENT_SUGGESTION_STALE":
      return "This suggestion was generated from outdated Recording context. Regenerate before applying.";
    case "FRESHNESS_UNKNOWN":
      return "This suggestion's freshness could not be verified (no context fingerprint was recorded, or the Recording is unavailable), so it cannot be applied. Regenerate before applying.";
    case "ALREADY_APPLIED":
      return "This suggestion has already been applied to the Recording draft.";
    case "NOT_APPROVED":
      return "Only an APPROVED suggestion can be applied.";
    case "UNSUPPORTED_TARGET":
      return "This suggestion does not target an editorial field that can be applied to a Recording.";
    case "EMPTY_CONTENT":
      return "This suggestion has no content to apply.";
    case "RECORDING_ARCHIVED":
      return "This Recording is archived, so content cannot be applied to it.";
    case "RECORDING_NOT_FOUND":
    case "NO_REVISION":
      return "This Recording has no revision the content can be applied to.";
    case "SUGGESTION_NOT_FOUND":
    default:
      return "This suggestion could not be found.";
  }
}
