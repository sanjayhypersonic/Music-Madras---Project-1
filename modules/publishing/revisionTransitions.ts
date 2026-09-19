// Pure state-machine rules for RecordingRevision.revisionStatus (ADR §5).
// No database, no framework — this only encodes which transitions are
// legal, so both the repository layer and its tests share one definition
// of "valid" rather than duplicating the rule.

export type RevisionStatusValue = "DRAFT" | "PUBLISHED" | "SUPERSEDED";

const VALID_TRANSITIONS: Record<RevisionStatusValue, RevisionStatusValue[]> = {
  // A draft becomes published (ADR §5.3, second bullet).
  DRAFT: ["PUBLISHED"],
  // A published revision is superseded only when a later draft, forked
  // from it, is itself published (ADR §5.3, third bullet) — it is never
  // otherwise legal to move a PUBLISHED revision back to DRAFT.
  PUBLISHED: ["SUPERSEDED"],
  // Superseded is terminal — historical revisions are retained, never
  // resurrected (ADR §5.5).
  SUPERSEDED: [],
};

export function isValidRevisionTransition(
  from: RevisionStatusValue,
  to: RevisionStatusValue
): boolean {
  return VALID_TRANSITIONS[from].includes(to);
}

// Phase 2 — preconditions extracted out of recordingRepository so they are
// directly unit-testable (ADR §5.3/§5.4) without a database.

export interface RecordingPointerState {
  hasOpenDraft: boolean;
  hasPublishedRevision: boolean;
}

/**
 * Edit-after-publish (ADR §5.3, third bullet) is only legal when there is
 * a published revision to fork from, and no draft is already open — a
 * Recording has exactly one current draft at a time (ADR §5.4).
 */
export function canForkNewDraft(state: RecordingPointerState): boolean {
  return state.hasPublishedRevision && !state.hasOpenDraft;
}

/**
 * Publishing by moving the pointer (ADR §5.3, second bullet) requires an
 * open draft revision to promote.
 */
export function canPublishCurrentDraft(state: Pick<RecordingPointerState, "hasOpenDraft">): boolean {
  return state.hasOpenDraft;
}
