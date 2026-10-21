import { createHash } from "crypto";
import type { VideoReviewState } from "@prisma/client";

// Phase 6K-2 — the pure rules of the unlisted-video review queue.
//
// An unlisted video is a CANDIDATE for a public Music Madras page; nobody has decided. Each candidate has a review (state + history).
// The proposal fingerprint hashes the facts that matter to the decision (not view counts, which change constantly), so:
//   - an unchanged item is never surfaced as new again;
//   - a changed item (new title, description, availability...) is surfaced again, including a declined or deferred one — unless a recorded
//     rights/copyright/privacy hold blocks it.
// Nothing here decides exposure or touches YouTube.

export interface FingerprintInput {
  title: string | null;
  description: string | null;
  privacyStatus: string | null;
  durationSeconds: number | null;
  observabilityState: string;
  publishedAt: Date | null;
}

export function computeProposalFingerprint(video: FingerprintInput): string {
  return createHash("sha256")
    .update(JSON.stringify([video.title ?? null, video.description ?? null, video.privacyStatus ?? null, video.durationSeconds ?? null, video.observabilityState, video.publishedAt ? video.publishedAt.toISOString() : null]))
    .digest("hex")
    .slice(0, 32);
}

export type ReviewClass =
  | "NEW" // never reviewed
  | "PENDING" // surfaced, nobody has decided
  | "CHANGED" // decided earlier (deferred / info requested / declined), but the facts changed since
  | "DUE" // deferred, and the deferral has passed
  | "NEEDS_DECISION" // was approved, but the approval has since ended (revoked outside the review, or by the lifecycle rules): a FRESH decision is needed
  | "ARCHIVED_PAGE" // the page is archived: nothing to decide until it is restored (an archived page cannot hold an approval)
  | "DEFERRED" // deferred, not yet due
  | "INFO_REQUESTED" // waiting for information, unchanged
  | "DECLINED"
  | "APPROVED";

export interface ReviewFacts {
  review: { state: VideoReviewState; proposalFingerprint: string; deferUntil: Date | null; holdReason: string | null } | null;
  fingerprint: string;
  now: Date;
  hasActivePageApproval: boolean;
  /** The video's Music Madras page is archived. */
  pageArchived?: boolean;
}

const AWAITING: ReadonlySet<ReviewClass> = new Set<ReviewClass>(["NEW", "PENDING", "CHANGED", "DUE", "NEEDS_DECISION"]);

export function classifyReview(facts: ReviewFacts): { class: ReviewClass; awaitingDecision: boolean } {
  const { review } = facts;
  const make = (c: ReviewClass) => ({ class: c, awaitingDecision: AWAITING.has(c) });
  // An archived page cannot be approved (and archiving ended any approval), so there is nothing to ask until it is restored.
  if (facts.pageArchived) return make("ARCHIVED_PAGE");
  if (!review) return make("NEW");
  const changed = review.proposalFingerprint !== facts.fingerprint;
  switch (review.state) {
    case "PENDING":
      return make("PENDING");
    case "APPROVED":
      return make(facts.hasActivePageApproval ? "APPROVED" : "NEEDS_DECISION");
    case "DEFERRED":
      if (changed) return make("CHANGED");
      return make(review.deferUntil !== null && review.deferUntil.getTime() <= facts.now.getTime() ? "DUE" : "DEFERRED");
    case "INFO_REQUESTED":
      return make(changed ? "CHANGED" : "INFO_REQUESTED");
    case "DECLINED":
      // A recorded hold means "do not surface this again", whatever changes; otherwise a material change resurfaces it.
      return make(changed && !review.holdReason ? "CHANGED" : "DECLINED");
  }
}

export interface QueueSummaryItem {
  videoId: string;
  fingerprint: string;
  class: ReviewClass;
  title: string | null;
}

/**
 * The single notification for the standing queue. Its fingerprint changes when the SET of awaiting items or any item's facts change, and once per
 * `cadenceDays` window while the queue is non-empty (a reminder, at most one per window); otherwise it stays identical, so nothing repeats.
 */
export function buildQueueNotification(awaiting: readonly QueueSummaryItem[], now: Date, cadenceDays: number): { title: string; body: string; fingerprint: string } | null {
  if (awaiting.length === 0) return null;
  const windowIndex = Math.floor(now.getTime() / (Math.max(1, cadenceDays) * 86_400_000));
  const sorted = [...awaiting].sort((a, b) => (a.videoId < b.videoId ? -1 : 1));
  const fingerprint = createHash("sha256")
    .update(JSON.stringify([sorted.map((i) => [i.videoId, i.fingerprint, i.class]), windowIndex]))
    .digest("hex")
    .slice(0, 32);
  const counts = new Map<ReviewClass, number>();
  for (const item of awaiting) counts.set(item.class, (counts.get(item.class) ?? 0) + 1);
  const parts: string[] = [];
  const add = (c: ReviewClass, label: string) => {
    const n = counts.get(c);
    if (n) parts.push(`${n} ${label}`);
  };
  add("NEW", "new");
  add("CHANGED", "changed since last reviewed");
  add("DUE", "deferred and now due");
  add("PENDING", "still waiting");
  add("NEEDS_DECISION", "approval ended, awaiting a fresh approval");
  const listed = sorted.slice(0, 5).map((i) => `- ${(i.title ?? "(untitled video)").slice(0, 80)}`);
  const more = sorted.length > 5 ? `\n…and ${sorted.length - 5} more.` : "";
  return {
    title: `${awaiting.length} unlisted video${awaiting.length === 1 ? "" : "s"} awaiting a decision`,
    body: `${parts.join(", ")}.\n\n${listed.join("\n")}${more}\n\nNothing becomes public until you approve it. Declined and deferred items are not shown again unless they change or fall due.`,
    fingerprint,
  };
}
