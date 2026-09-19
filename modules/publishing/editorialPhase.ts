import type { RecordingReadiness } from "../mmke/completeness/checkRecordingRevisionCompleteness";

// Editorial workflow phases (Phase 4 brief §5): DRAFT -> ENRICHMENT ->
// EDITORIAL_REVIEW -> APPROVED -> PUBLISHED -> UPDATED -> ARCHIVED.
//
// This is deliberately NOT a new stored column. RecordingAggregateStatus
// (schema, Phase 1) already has exactly the states a database needs to
// enforce transitions safely — DRAFT / IN_REVIEW / PUBLISHED / ARCHIVED —
// and adding a second, richer status enum alongside it would be the kind
// of "second source of truth" this project has consistently avoided (see
// e.g. the Draft/Revision model itself, or computeRecordingReadiness in
// modules/mmke/completeness, which is exactly this same pattern: a pure,
// named categorization computed from data that is already stored). Every
// one of the seven brief phases is fully determined by three things this
// application already has on hand:
//   - Recording.status (DRAFT | IN_REVIEW | PUBLISHED | ARCHIVED)
//   - whether a published revision exists at all
//   - the open draft revision's own completeness readiness
export type EditorialPhase =
  | "DRAFT"
  | "ENRICHMENT"
  | "EDITORIAL_REVIEW"
  | "APPROVED"
  | "PUBLISHED"
  | "UPDATED"
  | "ARCHIVED";

export interface EditorialPhaseInput {
  aggregateStatus: "DRAFT" | "IN_REVIEW" | "PUBLISHED" | "ARCHIVED";
  hasPublishedRevision: boolean;
  /** Readiness of the currently open draft revision, if any; irrelevant otherwise. */
  draftReadiness: RecordingReadiness | null;
  /** Whether the open draft has at least a title or a linked work — distinguishes a bare-new draft from one actively being enriched. */
  draftHasAnyContent: boolean;
}

export function computeEditorialPhase(input: EditorialPhaseInput): EditorialPhase {
  if (input.aggregateStatus === "ARCHIVED") {
    return "ARCHIVED";
  }

  if (input.aggregateStatus === "PUBLISHED") {
    // publishCurrentDraft always clears currentDraftRevisionId, so a
    // PUBLISHED aggregate status never has an open draft — see
    // recordingRepository.publishCurrentDraft.
    return "PUBLISHED";
  }

  if (input.aggregateStatus === "IN_REVIEW" && input.hasPublishedRevision) {
    // forkDraftFromPublished sets status back to IN_REVIEW the moment a
    // published recording gains a new open draft — the public Museum is
    // still serving the published revision unchanged, so this is a
    // distinct phase from a recording that has never been published.
    return "UPDATED";
  }

  if (input.aggregateStatus === "IN_REVIEW") {
    return input.draftReadiness === "PUBLISHABLE" ? "APPROVED" : "EDITORIAL_REVIEW";
  }

  // DRAFT
  return input.draftHasAnyContent ? "ENRICHMENT" : "DRAFT";
}
