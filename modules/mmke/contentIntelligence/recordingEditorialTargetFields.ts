import type { RecordingRevision } from "@prisma/client";

// Phase 6I-2 — the ONE list of RecordingRevision fields an AI editorial
// suggestion may target, and therefore the only fields an approved
// suggestion may ever be applied to. Previously a private constant inside
// modules/ai/structuredOutput/validateRecordingEditorialOutput.ts; extracted
// here (no behavior change) so the generation-time validator and the
// apply-time gate cannot drift apart.
//
// Deliberately excludes title, performance, and every relationship: AI
// output is editorial prose/SEO text only, never canonical structure.
export const RECORDING_EDITORIAL_TARGET_FIELDS = [
  "description",
  "educationalListeningGuide",
  "educationalAnalysis",
  "seoMetaTitle",
  "seoMetaDescription",
] as const;

export type RecordingEditorialTargetField = (typeof RECORDING_EDITORIAL_TARGET_FIELDS)[number];

// Compile-time guarantee that every target field is a real RecordingRevision
// column — the apply path writes it through the existing draft-update path.
type _TargetFieldsAreRevisionColumns = RecordingEditorialTargetField extends keyof RecordingRevision ? true : never;
export const _targetFieldsAreRevisionColumns: _TargetFieldsAreRevisionColumns = true;

export function isRecordingEditorialTargetField(value: unknown): value is RecordingEditorialTargetField {
  return typeof value === "string" && (RECORDING_EDITORIAL_TARGET_FIELDS as readonly string[]).includes(value);
}
