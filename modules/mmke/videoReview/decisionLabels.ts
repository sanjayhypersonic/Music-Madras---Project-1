import type { VideoReviewDecisionKind } from "@prisma/client";

// Phase 6K lifecycle hardening (F18) — how the review history names what happened. Each kind is its own thing: asking for information, declining,
// recording a hold and clearing a hold used to be recorded as two kinds between them, so the history could not tell them apart.

export const DECISION_LABEL: Record<VideoReviewDecisionKind, string> = {
  APPROVE: "Approved",
  REQUEST_INFO: "Asked for more information",
  DEFER: "Deferred",
  DECLINE: "Declined",
  REVOKE: "Revoked",
  HOLD_SET: "Hold recorded",
  HOLD_CLEARED: "Hold cleared",
};

export function decisionLabel(kind: VideoReviewDecisionKind): string {
  return DECISION_LABEL[kind] ?? kind.toLowerCase().replace(/_/g, " ");
}
