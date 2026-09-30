import type { ContextSourceType } from "./recordingContextContract";

// Phase 6H-4 — the evidence reference shape established in
// docs/content-intelligence-architecture.md Phase 6H-2 §22: a lightweight
// pointer, never a duplicated copy of the referenced record. A
// ContentSuggestion's `evidenceRefs` column stores an array of these.

export interface ContentSuggestionEvidenceRef {
  sourceType: ContextSourceType;
  entityType: string;
  entityId: string;
  field: string;
}
