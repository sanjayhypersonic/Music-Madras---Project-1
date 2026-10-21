import { lifecycleInvalidation, type VideoLifecycleState } from "./videoLifecycle";

// Phase 6K fix (F3), revised in the lifecycle hardening — the pure rules of the approval RECONCILIATION procedure.
//
// Two representations of "this unlisted page is approved" exist side by side: the legacy flag on the page
// (youtube_video_pages.unlistedPublicationApprovedAt, which every version of the software has written) and the recorded approval rows
// (video_exposure_approvals, written only by the current version). The current version writes both together, so they always agree. They can
// disagree only when an EARLIER version of the software wrote the flag alone — during a rollout window between "migration applied" and "new code
// deployed", or after a rollback — and the current eligibility rule needs the rows, so a flag-only approval would silently stop being public
// (and a flag-only revocation would leave a live approval row behind).
//
// Reconciliation brings the rows into line with the flag, by the same rule the migrations used, and never invents anything — in particular it never
// invents an APPROVER (the legacy flag recorded none), it never lists a page that was not published, and it never gives an approval to a page or video
// the lifecycle rules say cannot hold one (archived, private):
//   flag set, no active PAGE row   → the legacy approval stands: add a PAGE approval, and a DISCOVERY approval (the old rule listed it) ONLY when the
//                                    page is published and no listing approval is already active — both marked as carried over so an editor can
//                                    reconsider them. Skipped, and reported, if a hold is in place. Nothing is added for a video that is not unlisted.
//   flag set, page archived or video private → the flag is stale (such a page cannot hold an approval): clear it, and say so.
//   flag cleared, active rows      → the legacy REVOCATION stands: revoke every active approval of the page.
//   flag set, active PAGE row      → consistent. Nothing to do (a page-only approval made by the current version is respected: no listing is added).
//   flag cleared, no active rows   → consistent. Nothing to do.
// Idempotent: applying the plan and planning again yields no actions.

export interface PageApprovalState {
  /** The legacy flag is set. */
  flag: boolean;
  activeScopes: readonly { scope: "PAGE" | "DISCOVERY" | "PLAYLIST"; playlistPageId: string | null }[];
  /** An active rights/copyright/privacy hold on the video. */
  hold: boolean;
  /** The page is published (a draft page was never publicly listed). */
  published: boolean;
  /** The video's current situation: privacy, observability, and whether the page is archived. */
  lifecycle: VideoLifecycleState;
}

export type ReconcileDecision =
  | { kind: "NONE" }
  | { kind: "ADD_LEGACY_APPROVALS"; addPage: true; addDiscovery: boolean }
  | { kind: "REVOKE_ORPHANED_APPROVALS"; count: number }
  | { kind: "CLEAR_STALE_FLAG" }
  | { kind: "BLOCKED_BY_HOLD" };

export function decideReconciliation(state: PageApprovalState): ReconcileDecision {
  const hasPage = state.activeScopes.some((a) => a.scope === "PAGE");
  if (state.flag && !hasPage) {
    if (lifecycleInvalidation(state.lifecycle) !== null) return { kind: "CLEAR_STALE_FLAG" };
    if (state.hold) return { kind: "BLOCKED_BY_HOLD" };
    if (state.lifecycle.privacyStatus !== "unlisted") return { kind: "NONE" }; // approvals exist only for unlisted videos
    return { kind: "ADD_LEGACY_APPROVALS", addPage: true, addDiscovery: state.published && !state.activeScopes.some((a) => a.scope === "DISCOVERY") };
  }
  if (!state.flag && state.activeScopes.length > 0) return { kind: "REVOKE_ORPHANED_APPROVALS", count: state.activeScopes.length };
  return { kind: "NONE" };
}
