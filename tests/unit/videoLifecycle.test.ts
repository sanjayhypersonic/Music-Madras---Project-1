import { describe, expect, it } from "vitest";
import type { ObservabilityState } from "@prisma/client";
import { APPROVAL_STATUS_TEXT, deriveApprovalLifecycleStatus, isLifecycleReason, lifecycleInvalidation, type VideoLifecycleState } from "../../modules/mmke/catalogue/videoLifecycle";
import { isVideoExposed } from "../../modules/mmke/catalogue/videoExposure";

// Lifecycle hardening, F11 — the transition matrix of the approval lifecycle policy, exhaustively, as pure rules. (The same policy is proved against a
// real database, for the repositories that enforce it, in tests/integration/videoLifecycle.test.ts.)

const STATES: ObservabilityState[] = ["OBSERVED", "NOT_OBSERVED", "PRIVATE", "UNLISTED", "UNAVAILABLE", "DELETED", "SYNC_ERROR"];
const PRIVACIES = ["public", "unlisted", "private", null];
const state = (privacyStatus: string | null, observabilityState: ObservabilityState, archived = false): VideoLifecycleState => ({ privacyStatus, observabilityState, archived });

describe("lifecycleInvalidation — when an approval cannot stand", () => {
  it("a video that stays unlisted (and observed, page not archived) keeps its approval", () => {
    expect(lifecycleInvalidation(state("unlisted", "OBSERVED"))).toBeNull();
    expect(lifecycleInvalidation(state("unlisted", "UNLISTED"))).toBeNull(); // the (never written) UNLISTED state is not a revocation either
  });

  it("a private video loses its approvals", () => {
    expect(lifecycleInvalidation(state("private", "OBSERVED"))).toBe("VIDEO_PRIVATE");
    expect(lifecycleInvalidation(state("unlisted", "PRIVATE"))).toBe("VIDEO_PRIVATE");
  });

  it("an archived page loses its approvals, whatever the video's state", () => {
    for (const privacy of PRIVACIES) for (const observability of STATES) expect(lifecycleInvalidation(state(privacy, observability, true)), `${privacy}/${observability}`).toBe("PAGE_ARCHIVED");
  });

  it("uncertainty and unavailability never invalidate anything: not observed, sync error, unavailable and deleted all leave the approval standing (owner decision)", () => {
    for (const state_ of ["NOT_OBSERVED", "SYNC_ERROR", "UNAVAILABLE", "DELETED"] as const) {
      for (const privacy of ["public", "unlisted", null]) expect(lifecycleInvalidation(state(privacy, state_)), `${privacy}/${state_}`).toBeNull();
    }
  });

  it("exactly two transitions revoke: PRIVATE (by privacy status or observability) and an archived page — checked over every state combination", () => {
    for (const privacy of PRIVACIES) for (const observability of STATES) for (const archived of [false, true]) {
      const expected = archived ? "PAGE_ARCHIVED" : privacy === "private" || observability === "PRIVATE" ? "VIDEO_PRIVATE" : null;
      expect(lifecycleInvalidation(state(privacy, observability, archived)), `${privacy}/${observability}/${archived}`).toBe(expected);
    }
  });

  it("public videos and unknown privacy are not lifecycle revocations (public needs no approval; the exposure rule decides the rest)", () => {
    expect(lifecycleInvalidation(state("public", "OBSERVED"))).toBeNull();
    expect(lifecycleInvalidation(state(null, "OBSERVED"))).toBeNull();
  });

  it("is idempotent and pure: the same state always gives the same answer", () => {
    for (const privacy of PRIVACIES) for (const observability of STATES) for (const archived of [false, true]) {
      expect(lifecycleInvalidation(state(privacy, observability, archived))).toBe(lifecycleInvalidation(state(privacy, observability, archived)));
    }
  });

  it("recognises exactly the two lifecycle reasons; the retired VIDEO_UNAVAILABLE (kept in the enum as history only) is not one", () => {
    for (const r of ["VIDEO_PRIVATE", "PAGE_ARCHIVED"] as const) expect(isLifecycleReason(r)).toBe(true);
    for (const r of ["VIDEO_UNAVAILABLE", "EDITOR", "REVIEW_DECISION", "HOLD", "RECONCILED", "MIGRATION", null] as const) expect(isLifecycleReason(r), String(r)).toBe(false);
  });
});

describe("deriveApprovalLifecycleStatus — what Studio says", () => {
  const live = state("unlisted", "OBSERVED");
  const facts = (over: Partial<Parameters<typeof deriveApprovalLifecycleStatus>[0]> = {}) => ({ activePageApproval: false, metadataReviewPending: false, lastPageRevokedReason: null, state: live, ...over });

  it("approved, no pending metadata changes", () => {
    expect(deriveApprovalLifecycleStatus(facts({ activePageApproval: true }))).toBe("APPROVED");
  });

  it("approved, metadata review pending — the page is still approved", () => {
    expect(deriveApprovalLifecycleStatus(facts({ activePageApproval: true, metadataReviewPending: true }))).toBe("APPROVED_METADATA_REVIEW_PENDING");
  });

  it("approval revoked because of the lifecycle — while the video is still private / the page still archived", () => {
    expect(deriveApprovalLifecycleStatus(facts({ lastPageRevokedReason: "VIDEO_PRIVATE", state: state("private", "OBSERVED") }))).toBe("REVOKED_BY_LIFECYCLE");
    expect(deriveApprovalLifecycleStatus(facts({ lastPageRevokedReason: "PAGE_ARCHIVED", state: state("unlisted", "OBSERVED", true) }))).toBe("REVOKED_BY_LIFECYCLE");
  });

  it("awaiting fresh approval — the lifecycle revoked it and the video is unlisted / the page restored again, so nothing is exposed until someone approves", () => {
    for (const reason of ["VIDEO_PRIVATE", "PAGE_ARCHIVED"] as const) {
      expect(deriveApprovalLifecycleStatus(facts({ lastPageRevokedReason: reason })), reason).toBe("AWAITING_FRESH_APPROVAL");
    }
  });

  it("a revocation by a person (or a hold, a decision, housekeeping, or the retired unavailable reason) is simply 'not approved', never mistaken for the lifecycle", () => {
    for (const reason of ["EDITOR", "REVIEW_DECISION", "HOLD", "RECONCILED", "MIGRATION", "VIDEO_UNAVAILABLE"] as const) expect(deriveApprovalLifecycleStatus(facts({ lastPageRevokedReason: reason })), reason).toBe("NOT_APPROVED");
    expect(deriveApprovalLifecycleStatus(facts())).toBe("NOT_APPROVED");
  });

  it("an approved video that is unavailable, deleted or not observed is still APPROVED (its approval stands); only the exposure rule hides it", () => {
    for (const observability of ["UNAVAILABLE", "DELETED", "NOT_OBSERVED", "SYNC_ERROR"] as const) {
      expect(deriveApprovalLifecycleStatus(facts({ activePageApproval: true, state: state("unlisted", observability) })), observability).toBe("APPROVED");
    }
  });

  it("an active approval always wins: a fresh approval after a lifecycle revocation is simply approved", () => {
    expect(deriveApprovalLifecycleStatus(facts({ activePageApproval: true, lastPageRevokedReason: "VIDEO_PRIVATE" }))).toBe("APPROVED");
  });

  it("every status has Studio wording that says what it means for visitors", () => {
    expect(APPROVAL_STATUS_TEXT.APPROVED_METADATA_REVIEW_PENDING.detail).toMatch(/stays public/);
    expect(APPROVAL_STATUS_TEXT.AWAITING_FRESH_APPROVAL.detail).toMatch(/Nothing is exposed publicly until someone approves it again/);
    expect(APPROVAL_STATUS_TEXT.REVOKED_BY_LIFECYCLE.detail).toMatch(/not exposed publicly/);
  });
});

describe("the final exposure predicate agrees: a lifecycle-invalid video is never exposed, whatever approvals are present", () => {
  const approvals = [{ scope: "PAGE" as const, playlistPageId: null }, { scope: "DISCOVERY" as const, playlistPageId: null }, { scope: "PLAYLIST" as const, playlistPageId: "pl" }];
  const facts = (privacyStatus: string | null, observabilityState: ObservabilityState, archivedAt: Date | null) => ({
    page: { status: "PUBLISHED" as const, archivedAt, unlistedPublicationApprovedAt: new Date() },
    youtubeVideo: { privacyStatus, observabilityState },
    activeApprovals: approvals,
    hold: null,
  });

  it("private, archived, unavailable and unobserved are all denied on every surface even with every approval present", () => {
    const surfaces = [{ kind: "PAGE" as const }, { kind: "DISCOVERY" as const }, { kind: "PLAYLIST" as const, playlistPageId: "pl" }];
    for (const s of surfaces) {
      expect(isVideoExposed(facts("private", "OBSERVED", null), s), `private ${s.kind}`).toBe(false);
      expect(isVideoExposed(facts("unlisted", "OBSERVED", new Date()), s), `archived ${s.kind}`).toBe(false);
      expect(isVideoExposed(facts("unlisted", "DELETED", null), s), `deleted ${s.kind}`).toBe(false);
      expect(isVideoExposed(facts("unlisted", "UNAVAILABLE", null), s), `unavailable ${s.kind}`).toBe(false);
      expect(isVideoExposed(facts("unlisted", "NOT_OBSERVED", null), s), `not observed ${s.kind}`).toBe(false);
      expect(isVideoExposed(facts("unlisted", "OBSERVED", null), s), `approved unlisted ${s.kind}`).toBe(true); // the control
    }
  });

  it("a public video that is unavailable, deleted or not observed is hidden too: nothing confirmed-gone is presented as available content", () => {
    for (const observability of ["UNAVAILABLE", "DELETED", "NOT_OBSERVED", "SYNC_ERROR"] as const) {
      for (const s of [{ kind: "PAGE" as const }, { kind: "DISCOVERY" as const }]) expect(isVideoExposed(facts("public", observability, null), s), `public ${observability} ${s.kind}`).toBe(false);
    }
  });

  it("availability coming back never bypasses privacy, archive, approval or a hold: each is enforced on its own", () => {
    const s = { kind: "PAGE" as const };
    const back = facts("unlisted", "OBSERVED", null); // the video is available again, approvals retained
    expect(isVideoExposed(back, s)).toBe(true); // the control: every condition holds
    expect(isVideoExposed(facts("private", "OBSERVED", null), s), "available but private").toBe(false);
    expect(isVideoExposed(facts("unlisted", "OBSERVED", new Date()), s), "available but archived").toBe(false);
    expect(isVideoExposed({ ...back, hold: "RIGHTS" }, s), "available but on hold").toBe(false);
    expect(isVideoExposed({ ...back, activeApprovals: [] }, s), "available but no approval").toBe(false);
    expect(isVideoExposed({ ...back, page: { ...back.page, status: "DRAFT" } }, s), "available but unpublished").toBe(false);
  });
});
