// Pure state-machine rules for SyncConflict.status (Phase 6B, ADR §16.3).
// No database, no framework — mirrors
// modules/publishing/revisionTransitions.ts exactly.

export type SyncConflictStatusValue = "OPEN" | "RESOLVED" | "IGNORED";

const VALID_TRANSITIONS: Record<SyncConflictStatusValue, SyncConflictStatusValue[]> = {
  // An editor resolves a conflict (ADR §16.3, step 4: keep editorial /
  // accept external / manual merge — all three land on RESOLVED here)
  // or explicitly ignores it.
  OPEN: ["RESOLVED", "IGNORED"],
  // Both are terminal — a resolved or ignored conflict is historical
  // record, never reopened (mirrors RevisionStatus.SUPERSEDED being
  // terminal in revisionTransitions.ts).
  RESOLVED: [],
  IGNORED: [],
};

export function canTransitionSyncConflictStatus(from: SyncConflictStatusValue, to: SyncConflictStatusValue): boolean {
  return VALID_TRANSITIONS[from].includes(to);
}
