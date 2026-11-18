// Upload-to-draft pipeline (R-34), stage 1 rules: WHEN a video is queued. Pure.
//
// A video is queued when it is public and observed and has no pipeline row; re-queued (all its stages discarded) when its title, description or
// tags changed since it was queued, unless the owner has already approved or published it: a change after that is the existing metadata-review
// workflow's job (Studio -> video metadata review), not a second bundle. A REJECTED video is re-queued when its text changes (the change may add
// the credits it lacked). Idempotent: the same text never queues twice.

import { createHash } from "crypto";

export function sourceFingerprint(title: string | null, description: string | null, tags: readonly string[]): string {
  return createHash("sha256").update(JSON.stringify([title ?? "", description ?? "", [...tags]])).digest("hex");
}

export type QueueDecision = "QUEUE" | "REQUEUE" | "SKIP";

const DECIDED = new Set(["APPROVED", "PUBLISHED"]);

export function queueDecision(existing: { status: string; sourceFingerprint: string } | null, fingerprint: string): QueueDecision {
  if (!existing) return "QUEUE";
  if (existing.sourceFingerprint === fingerprint) return "SKIP";
  return DECIDED.has(existing.status) ? "SKIP" : "REQUEUE";
}
