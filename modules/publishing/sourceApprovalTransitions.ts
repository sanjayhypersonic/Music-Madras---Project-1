// Pure state-machine rules for Source.approvalState (Phase 6H-8). Mirrors
// modules/publishing/contentSuggestionTransitions.ts's shape: no database,
// no framework, shared by the repository and its tests.
//
// UNREVIEWED -> {APPROVED | REJECTED}; APPROVED -> {REJECTED | DISABLED};
// REJECTED/DISABLED -> APPROVED (re-review can reinstate a source — approval
// is never a one-way door, since circumstances or review judgement can
// change). There is no transition out of UNREVIEWED other than an explicit
// approve/reject decision, and no automatic transition anywhere in this
// table — every edge requires an authorized Studio action.

export type SourceApprovalStateValue = "UNREVIEWED" | "APPROVED" | "REJECTED" | "DISABLED";

const VALID_TRANSITIONS: Record<SourceApprovalStateValue, SourceApprovalStateValue[]> = {
  UNREVIEWED: ["APPROVED", "REJECTED"],
  APPROVED: ["REJECTED", "DISABLED"],
  REJECTED: ["APPROVED"],
  DISABLED: ["APPROVED"],
};

export function isValidSourceApprovalTransition(from: SourceApprovalStateValue, to: SourceApprovalStateValue): boolean {
  return VALID_TRANSITIONS[from].includes(to);
}

export function canApproveSource(state: SourceApprovalStateValue): boolean {
  return isValidSourceApprovalTransition(state, "APPROVED");
}

export function canRejectSource(state: SourceApprovalStateValue): boolean {
  return isValidSourceApprovalTransition(state, "REJECTED");
}

export function canDisableSource(state: SourceApprovalStateValue): boolean {
  return isValidSourceApprovalTransition(state, "DISABLED");
}
