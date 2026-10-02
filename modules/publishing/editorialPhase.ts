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
  /**
   * Phase 6I-2 — whether the Recording currently has an open draft revision.
   * Optional (defaults to false) so existing callers/tests are unaffected.
   * Needed because a PUBLISHED Recording can now legitimately have an open
   * draft: forkDraftFromPublished keeps a live Recording PUBLISHED so its
   * public page is not taken offline while it is being edited.
   */
  hasOpenDraft?: boolean;
}

export function computeEditorialPhase(input: EditorialPhaseInput): EditorialPhase {
  if (input.aggregateStatus === "ARCHIVED") {
    return "ARCHIVED";
  }

  if (input.aggregateStatus === "PUBLISHED") {
    // publishCurrentDraft clears currentDraftRevisionId, so a freshly
    // published Recording has no open draft. Since Phase 6I-2 a PUBLISHED
    // Recording that gains a new draft (forkDraftFromPublished) STAYS
    // PUBLISHED so its public page remains live — that is a pending update.
    return input.hasOpenDraft ? "UPDATED" : "PUBLISHED";
  }

  if (input.aggregateStatus === "IN_REVIEW" && input.hasPublishedRevision) {
    // A Recording that is not currently PUBLISHED (e.g. unpublished or
    // restored, then forked) still lands in IN_REVIEW with a published
    // revision on record — also a pending update, though not publicly live.
    return "UPDATED";
  }

  if (input.aggregateStatus === "IN_REVIEW") {
    return input.draftReadiness === "PUBLISHABLE" ? "APPROVED" : "EDITORIAL_REVIEW";
  }

  // DRAFT
  return input.draftHasAnyContent ? "ENRICHMENT" : "DRAFT";
}
