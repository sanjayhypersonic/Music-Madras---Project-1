// GATE 5, AUDIT (docs/content-guardrails.md section 6). PURE.
//
// Every claim decision is LOGGED as an append-only event (research-audit.jsonl beside the sheets): a new decision, a changed one, a change of approver,
// and a claim becoming stale. The log is never rewritten; the current state of a claim is its latest event. Spreadsheets can be edited silently, so the
// log is written by the first tool that reads them (npm run ai:video-describe-draft) by comparing the sheet with the log's latest state.

export type AuditAction = "CLAIM_DECIDED" | "CLAIM_DECISION_CHANGED" | "CLAIM_APPROVER_CHANGED" | "CLAIM_MARKED_STALE";

export interface AuditEvent {
  at: string;
  action: AuditAction;
  claimId: string;
  decision: string;
  approver: string;
  previousDecision?: string;
  previousApprover?: string;
  note?: string;
}

export interface ClaimDecisionRow {
  claimId: string;
  decision: string;
  approver: string;
  status?: string;
}

/** The latest logged state per claim. */
export function latestState(events: readonly AuditEvent[]): Map<string, AuditEvent> {
  const out = new Map<string, AuditEvent>();
  for (const e of events) out.set(e.claimId, e);
  return out;
}

/** The events to append for what changed in the sheet since the log's latest state. Rows with no decision and no history produce nothing. */
export function auditDecisionChanges(events: readonly AuditEvent[], rows: readonly ClaimDecisionRow[], at: Date): AuditEvent[] {
  const last = latestState(events);
  const out: AuditEvent[] = [];
  for (const r of rows) {
    const decision = r.decision.trim().toLowerCase();
    const approver = r.approver.trim();
    const prev = last.get(r.claimId);
    const base = { at: at.toISOString(), claimId: r.claimId, decision, approver };
    if (r.status === "stale" && prev?.action !== "CLAIM_MARKED_STALE") out.push({ ...base, action: "CLAIM_MARKED_STALE", note: "a source changed or the claim is too old: re-research and re-approve" });
    if (!prev) {
      if (decision) out.push({ ...base, action: "CLAIM_DECIDED" });
    } else if (prev.decision !== decision) {
      out.push({ ...base, action: "CLAIM_DECISION_CHANGED", previousDecision: prev.decision, previousApprover: prev.approver });
    } else if (prev.approver !== approver) {
      out.push({ ...base, action: "CLAIM_APPROVER_CHANGED", previousApprover: prev.approver });
    }
  }
  return out;
}

export const toJsonl = (events: readonly AuditEvent[]): string => events.map((e) => JSON.stringify(e)).join("\n") + (events.length ? "\n" : "");

export function parseJsonl(text: string): AuditEvent[] {
  return text
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as AuditEvent);
}
