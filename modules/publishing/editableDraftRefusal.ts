// Phase 6J-1 — why a Studio edit to a Recording's draft was refused, and what
// to tell the editor. The Studio recording wizard used to bind a revision id
// (and, for participants, a performance id) into each form at render time and
// trust it when the form was posted; a stale or replayed form could then
// mutate a revision that had since been published, or one that was never this
// Recording's draft. The server now resolves the authoritative editable draft
// from the Recording id and treats the bound ids only as an "expected" token.
//
// Pure: no database, no framework.

export type EditableDraftRefusal =
  | "RECORDING_NOT_FOUND"
  | "RECORDING_ARCHIVED"
  | "NO_OPEN_DRAFT"
  | "STALE_REVISION";

const MESSAGES: Record<EditableDraftRefusal, string> = {
  RECORDING_NOT_FOUND: "This Recording no longer exists.",
  RECORDING_ARCHIVED: "This Recording is archived. Restore it before making changes.",
  NO_OPEN_DRAFT: "This Recording has no open draft to edit. Start a new draft from its Source step first.",
  STALE_REVISION: "This page is out of date — the Recording's draft has changed since you opened it. Reload the page and try again.",
};

export function describeEditableDraftRefusal(reason: EditableDraftRefusal): string {
  return MESSAGES[reason];
}
