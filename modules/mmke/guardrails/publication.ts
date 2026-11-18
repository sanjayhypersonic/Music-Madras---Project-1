// GATE 4, PUBLICATION (docs/content-guardrails.md section 5). PURE.
//
// Nothing is ever published automatically: this function only PLANS review batches for a person, and its result says so (`autoPublish: false`,
// a literal type). A draft enters a batch only when its gate-3 checks passed, a named editor approved it, and none of its claims is in an unresolved
// conflict. Each batch is small, and a deterministic SAMPLE of it (always including every draft that relies on a weak claim) goes to a second
// reviewer before the first reviewer publishes the batch by hand through the existing Studio / YouTube workflow.

import { createHash } from "crypto";

export interface PublicationCandidate {
  id: string;
  checksPassed: boolean;
  approvedBy: string | null;
  usesWeakClaims: boolean;
  hasUnresolvedConflict: boolean;
}

export interface PublicationPlan {
  autoPublish: false;
  batches: Array<{ ids: string[]; secondReview: string[] }>;
  excluded: Array<{ id: string; reason: string }>;
}

export const DEFAULT_BATCH_SIZE = 10;
export const DEFAULT_SAMPLE_RATE = 0.2;

const rank = (seed: string, id: string) => createHash("sha256").update(`${seed}\u0000${id}`).digest("hex");

export function planPublicationBatches(candidates: readonly PublicationCandidate[], options: { batchSize?: number; sampleRate?: number; seed: string }): PublicationPlan {
  const size = Math.max(1, Math.min(options.batchSize ?? DEFAULT_BATCH_SIZE, 25));
  const rate = Math.min(Math.max(options.sampleRate ?? DEFAULT_SAMPLE_RATE, 0), 1);
  const excluded: PublicationPlan["excluded"] = [];
  const eligible: PublicationCandidate[] = [];
  for (const c of candidates) {
    if (!c.checksPassed) excluded.push({ id: c.id, reason: "gate-3 checks have not passed" });
    else if (!c.approvedBy) excluded.push({ id: c.id, reason: "no named approver" });
    else if (c.hasUnresolvedConflict) excluded.push({ id: c.id, reason: "a claim it relies on is in an unresolved conflict" });
    else eligible.push(c);
  }
  const batches: PublicationPlan["batches"] = [];
  for (let i = 0; i < eligible.length; i += size) {
    const batch = eligible.slice(i, i + size);
    const must = batch.filter((c) => c.usesWeakClaims).map((c) => c.id);
    const want = Math.max(1, Math.ceil(batch.length * rate));
    const extra = batch
      .filter((c) => !must.includes(c.id))
      .sort((a, b) => rank(options.seed, a.id).localeCompare(rank(options.seed, b.id)))
      .slice(0, Math.max(0, want - must.length))
      .map((c) => c.id);
    batches.push({ ids: batch.map((c) => c.id), secondReview: [...must, ...extra] });
  }
  return { autoPublish: false, batches, excluded };
}
