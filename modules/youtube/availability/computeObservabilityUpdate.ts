import type { ObservabilityState } from "@prisma/client";

// ADR §15's observability state machine, as much of it as Phase 6F's
// initial synchronization actually exercises. Deliberately narrow: this
// answers "given what THIS pass observed, what should the state become,"
// and nothing about *escalating* a repeated absence into DELETED — that
// requires counting consecutive FULL-completeness passes against
// SyncPolicy.deletionEvidenceRequiredPasses, which is explicitly a later
// phase's job (ADR §15, Phase 6A's own scope notes). What this function
// guarantees: a resource that IS observed is always OBSERVED, regardless
// of its prior state (recovery is immediate — no evidence threshold
// applies to *reappearing*, only to disappearing/deletion); a resource
// that is NOT observed this pass only ever moves as far as NOT_OBSERVED,
// never further — matching the brief's explicit "do not invent deletion
// evidence" instruction by construction, not by a runtime check.

export interface ObservabilityUpdateResult {
  nextState: ObservabilityState;
  /** True only when nextState actually differs from currentState — the caller uses this to decide whether an ObservabilityTransition record (and its audit log entry) is warranted. */
  changed: boolean;
}

export function computeObservabilityUpdate(
  currentState: ObservabilityState,
  wasObservedThisPass: boolean
): ObservabilityUpdateResult {
  const nextState: ObservabilityState = wasObservedThisPass
    ? "OBSERVED"
    : currentState === "OBSERVED"
      ? "NOT_OBSERVED"
      : currentState;

  return { nextState, changed: nextState !== currentState };
}
