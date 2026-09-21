// Pure state-machine rules for FieldOwnership.ownership (Phase 6B, ADR
// §16.2). No database, no framework — mirrors
// modules/publishing/revisionTransitions.ts exactly: this only encodes
// which transitions are legal, so the repository layer and its tests
// share one definition of "valid" rather than duplicating the rule. It
// does not decide *when* a transition should happen (e.g. "an editor
// just changed a synced field") — that judgment belongs to the
// not-yet-built sync engine and Studio actions layer; this module would
// only ever be asked "is X -> Y legal," never "should X become Y."

export type FieldOwnershipStateValue = "YOUTUBE_CONTROLLED" | "MUSIC_MADRAS_CONTROLLED" | "SHARED_REQUIRES_REVIEW";

const VALID_TRANSITIONS: Record<FieldOwnershipStateValue, FieldOwnershipStateValue[]> = {
  // A field starts YouTube-controlled; an editor changing it takes
  // control (ADR §16.2: "set automatically the instant an editor changes
  // a field that started as YOUTUBE_SOURCE").
  YOUTUBE_CONTROLLED: ["MUSIC_MADRAS_CONTROLLED"],
  // "Accept external" during conflict resolution can hand control back
  // (ADR §16.3, step 4: "flips FieldOwnership.ownership back to
  // YOUTUBE_SOURCE if appropriate").
  MUSIC_MADRAS_CONTROLLED: ["YOUTUBE_CONTROLLED"],
  // A fixed classification for fields where neither side is
  // unconditionally authoritative (ADR §16.2) — not part of the
  // automatic two-state handoff above.
  SHARED_REQUIRES_REVIEW: [],
};

export function canTransitionFieldOwnership(from: FieldOwnershipStateValue, to: FieldOwnershipStateValue): boolean {
  return VALID_TRANSITIONS[from].includes(to);
}
