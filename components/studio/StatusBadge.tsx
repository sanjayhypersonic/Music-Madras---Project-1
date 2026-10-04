import type { ReactNode } from "react";

// Phase 6J-3B — one small status pill for Studio lists and headers. The word is
// always shown (colour is never the only cue) and the tint comes from the
// FUNCTIONAL roles (success / warning / error / info) or neutral — never from the
// brand, so a status cannot be mistaken for identity. Pass `tone` to override the
// mapping for a status this table does not know.

export type StatusTone = "success" | "warning" | "error" | "info" | "neutral";

const SUCCESS = new Set(["PUBLISHED", "ACTIVE", "SUCCEEDED", "APPROVED", "COMPLETE", "OBSERVED", "APPLIED", "GRANTED"]);
const WARNING = new Set(["PENDING", "EDITOR_REVIEW", "IN_REVIEW", "REVIEW", "DRAFT_READY", "CHANGES_REQUESTED", "PARTIAL", "STALE", "INVITED", "GENERATING", "NOT_OBSERVED"]);
const ERROR = new Set(["FAILED", "REJECTED", "DISABLED", "DELETED", "UNAVAILABLE", "SYNC_ERROR", "REVOKED"]);

export function statusTone(status: string): StatusTone {
  const key = status.trim().toUpperCase().replace(/[\s-]+/g, "_");
  if (SUCCESS.has(key)) return "success";
  if (WARNING.has(key)) return "warning";
  if (ERROR.has(key)) return "error";
  return "neutral";
}

export function StatusBadge({ status, tone, children }: { status: string; tone?: StatusTone; children?: ReactNode }) {
  const resolved = tone ?? statusTone(status);
  return <span className={`studio-badge${resolved === "neutral" ? "" : ` studio-badge--${resolved}`}`}>{children ?? status}</span>;
}