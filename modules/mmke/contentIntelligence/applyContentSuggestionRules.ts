import { isRecordingEditorialTargetField } from "./recordingEditorialTargetFields";
import type { RecordingEditorialTargetField } from "./recordingEditorialTargetFields";

// Phase 6I-2 — the pure decisions behind applying an approved ContentSuggestion
// to a Recording draft. Prisma-free (ADR §3 boundary rule), so they are shared
// by the repository that enforces them and by the review page that explains
// them, and are unit-testable without a database.

interface ApplicableSuggestionShape {
  suggestionType: string;
  targetEntityType: string;
  targetField: string | null;
}

/** The field an approved suggestion would write to, or null if it is not an applicable Recording-editorial suggestion. */
export function getApplicableTargetField(suggestion: ApplicableSuggestionShape): RecordingEditorialTargetField | null {
  if (suggestion.suggestionType !== "EDITORIAL_PROSE") return null;
  if (suggestion.targetEntityType !== "RECORDING") return null;
  return isRecordingEditorialTargetField(suggestion.targetField) ? suggestion.targetField : null;
}

/** The content that would be applied: the editor's final wording if they edited (`finalContent ?? proposedContent`), otherwise the original proposal. */
export function resolveContentToApply(suggestion: { finalContent: string | null; proposedContent: string }): {
  content: string;
  contentSource: "finalContent" | "proposedContent";
} {
  return suggestion.finalContent !== null
    ? { content: suggestion.finalContent, contentSource: "finalContent" }
    : { content: suggestion.proposedContent, contentSource: "proposedContent" };
}
