import type { ObservabilityState, VideoExposureRevokeReason } from "@prisma/client";

// Phase 6K lifecycle hardening (F11) — when an approval to expose an unlisted video stops describing the video's situation.
//
// The policy (product owner, Phase 6K hardening):
//   - A video that STAYS unlisted keeps its approval. Unlisted status alone never revokes anything.
//   - A video that becomes PRIVATE loses every public-exposure approval. Becoming unlisted again does not bring them back: a fresh approval is needed.
//   - Archiving a video's page loses its approvals the same way; restoring the page does not bring them back.
//   - ONLY those two transitions end an approval permanently. UNAVAILABLE and DELETED do NOT (owner decision): such a video is hidden by the
//     exposure rule for as long as it is not OBSERVED, so it is never shown as available content, but its approvals and their history stand untouched.
//     The same goes for UNCERTAINTY: a video the sync could not see (NOT_OBSERVED after an incomplete or implausible pass, SYNC_ERROR) is hidden while
//     it is unobserved, and its approvals stand: it may simply come back. When it does, exposure resumes only if EVERY independent condition still
//     holds (see below); nothing is exposed merely because an approval was kept.
//   - Unpublishing a page (the editor's own act) is neither: it hides the page, and approvals stand.
//
// Enforcement is layered, not a single place: (1) the state-transition boundary (updateYouTubeVideoFields / setYouTubeVideoObservability and the
// page archive function) revokes in the SAME transaction as the change; (2) the final exposure predicate (videoExposure.ts) independently denies every
// private, archived, held, unapproved or not-OBSERVED (so also unavailable, deleted, not-observed, sync-error) video whatever approvals exist, so
// availability, privacy, archive state, approval and holds are each enforced on their own; (3) a repeatable invariant check finds and repairs any
// active approval that survived a writer which bypassed (1) (videoLifecycleRepository.ts), so a later return to unlisted/unarchived cannot resurrect it.

/**
 * `VIDEO_UNAVAILABLE` is a RETIRED revoke reason: it stays in the database enum (removing a value would need a migration, and any row that carries it is
 * history that must not be rewritten) but no code path writes it any more, and it is not a lifecycle invalidation.
 */
export type LifecycleInvalidation = Extract<VideoExposureRevokeReason, "VIDEO_PRIVATE" | "PAGE_ARCHIVED">;

export interface VideoLifecycleState {
  privacyStatus: string | null;
  observabilityState: ObservabilityState;
  archived: boolean;
}

/** Why an approval cannot stand in this state, or null when it can. Pure and idempotent: the same state always gives the same answer. */
export function lifecycleInvalidation(state: VideoLifecycleState): LifecycleInvalidation | null {
  if (state.archived) return "PAGE_ARCHIVED";
  if (state.privacyStatus === "private" || state.observabilityState === "PRIVATE") return "VIDEO_PRIVATE";
  return null;
}

const LIFECYCLE_REASONS: ReadonlySet<VideoExposureRevokeReason> = new Set<VideoExposureRevokeReason>(["VIDEO_PRIVATE", "PAGE_ARCHIVED"]);

export const isLifecycleReason = (reason: VideoExposureRevokeReason | null): reason is LifecycleInvalidation => reason !== null && LIFECYCLE_REASONS.has(reason);

/** What Studio says about a page's approval. Exactly one of these always applies. */
export type ApprovalLifecycleStatus =
  /** Approved, and nothing the editors have not looked at. */
  | "APPROVED"
  /** Approved and public, but the video's metadata changed after it was reviewed and nobody has looked at the change yet. */
  | "APPROVED_METADATA_REVIEW_PENDING"
  /** The approval ended because the video went private or the page was archived, and that is still the case. */
  | "REVOKED_BY_LIFECYCLE"
  /** The approval ended because of the lifecycle and the video is unlisted/unarchived again: nothing is exposed until someone approves afresh. */
  | "AWAITING_FRESH_APPROVAL"
  /** No approval (never approved, or an editor withdrew it). */
  | "NOT_APPROVED";

export interface ApprovalLifecycleFacts {
  activePageApproval: boolean;
  metadataReviewPending: boolean;
  /** Why the most recent PAGE approval ended, if it has ended and no later one is active. */
  lastPageRevokedReason: VideoExposureRevokeReason | null;
  state: VideoLifecycleState;
}

export function deriveApprovalLifecycleStatus(facts: ApprovalLifecycleFacts): ApprovalLifecycleStatus {
  if (facts.activePageApproval) return facts.metadataReviewPending ? "APPROVED_METADATA_REVIEW_PENDING" : "APPROVED";
  if (isLifecycleReason(facts.lastPageRevokedReason)) {
    // Still in the situation that ended it, or out of it (back to unlisted / restored) and waiting for a fresh approval.
    return lifecycleInvalidation(facts.state) !== null ? "REVOKED_BY_LIFECYCLE" : "AWAITING_FRESH_APPROVAL";
  }
  return "NOT_APPROVED";
}

export const APPROVAL_STATUS_TEXT: Record<ApprovalLifecycleStatus, { label: string; detail: string }> = {
  APPROVED: { label: "Approved", detail: "The page is approved for the public Museum and its metadata has been reviewed." },
  APPROVED_METADATA_REVIEW_PENDING: {
    label: "Approved — metadata review pending",
    detail: "The page stays public, but the video's title, description, thumbnail or other page-defining details changed after they were reviewed. Look at the change and confirm it.",
  },
  REVOKED_BY_LIFECYCLE: {
    label: "Approval revoked — video private or page archived",
    detail: "The approval ended automatically because the video became private or its page was archived. It is not exposed publicly.",
  },
  AWAITING_FRESH_APPROVAL: {
    label: "Awaiting fresh approval",
    detail: "The approval ended when the video became private or the page was archived, and that is no longer the case. Nothing is exposed publicly until someone approves it again.",
  },
  NOT_APPROVED: { label: "Not approved", detail: "No approval is recorded, so an unlisted video is not exposed publicly." },
};
