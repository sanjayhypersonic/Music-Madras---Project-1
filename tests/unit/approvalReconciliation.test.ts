import { describe, expect, it } from "vitest";
import { decideReconciliation, type PageApprovalState } from "../../modules/mmke/catalogue/approvalReconciliation";

// F3 — the pure reconciliation rules, exhaustively over every combination of flag, approval scopes and hold.

type Scope = "PAGE" | "DISCOVERY" | "PLAYLIST";
const SCOPE_SETS: Scope[][] = [[], ["PAGE"], ["DISCOVERY"], ["PLAYLIST"], ["PAGE", "DISCOVERY"], ["PAGE", "PLAYLIST"], ["DISCOVERY", "PLAYLIST"], ["PAGE", "DISCOVERY", "PLAYLIST"]];
const LIVE = { privacyStatus: "unlisted", observabilityState: "OBSERVED", archived: false } as const;
const state = (flag: boolean, scopes: Scope[], hold: boolean, overrides: Partial<PageApprovalState> = {}): PageApprovalState => ({
  flag,
  activeScopes: scopes.map((scope) => ({ scope, playlistPageId: scope === "PLAYLIST" ? "pl" : null })),
  hold,
  published: true,
  lifecycle: LIVE,
  ...overrides,
});

describe("decideReconciliation", () => {
  it("a flag with no active PAGE approval is a legacy approval: carry it over (page, plus listing unless already listed) — or report it when a hold blocks it", () => {
    for (const scopes of SCOPE_SETS.filter((s) => !s.includes("PAGE"))) {
      expect(decideReconciliation(state(true, scopes, false)), JSON.stringify(scopes)).toEqual({ kind: "ADD_LEGACY_APPROVALS", addPage: true, addDiscovery: !scopes.includes("DISCOVERY") });
      expect(decideReconciliation(state(true, scopes, true)), `${JSON.stringify(scopes)} + hold`).toEqual({ kind: "BLOCKED_BY_HOLD" });
    }
  });

  it("never lists a page that is not published: a legacy flag on a DRAFT page carries over the page approval only", () => {
    expect(decideReconciliation(state(true, [], false, { published: false }))).toEqual({ kind: "ADD_LEGACY_APPROVALS", addPage: true, addDiscovery: false });
  });

  it("never carries an approval over to an archived page or a private video: the stale flag is cleared instead", () => {
    for (const lifecycle of [
      { privacyStatus: "unlisted", observabilityState: "OBSERVED", archived: true },
      { privacyStatus: "private", observabilityState: "OBSERVED", archived: false },
      { privacyStatus: "unlisted", observabilityState: "PRIVATE", archived: false },
    ] as const) {
      expect(decideReconciliation(state(true, [], false, { lifecycle })), JSON.stringify(lifecycle)).toEqual({ kind: "CLEAR_STALE_FLAG" });
      expect(decideReconciliation(state(true, [], true, { lifecycle })), `${JSON.stringify(lifecycle)} + hold`).toEqual({ kind: "CLEAR_STALE_FLAG" });
    }
  });

  it("an unobserved, unavailable or deleted video is not a lifecycle change (owner decision): the legacy approval is still carried over, and the exposure rule keeps the video hidden meanwhile", () => {
    for (const observabilityState of ["NOT_OBSERVED", "SYNC_ERROR", "UNAVAILABLE", "DELETED"] as const) {
      expect(decideReconciliation(state(true, [], false, { lifecycle: { ...LIVE, observabilityState } })), observabilityState).toEqual({ kind: "ADD_LEGACY_APPROVALS", addPage: true, addDiscovery: true });
    }
  });

  it("adds nothing for a video that is not unlisted (approvals exist only for unlisted videos)", () => {
    expect(decideReconciliation(state(true, [], false, { lifecycle: { ...LIVE, privacyStatus: "public" } }))).toEqual({ kind: "NONE" });
  });

  it("a cleared flag with any active approval is a legacy revocation: revoke what is left behind", () => {
    for (const scopes of SCOPE_SETS.filter((s) => s.length > 0)) {
      for (const hold of [false, true]) expect(decideReconciliation(state(false, scopes, hold)), JSON.stringify({ scopes, hold })).toEqual({ kind: "REVOKE_ORPHANED_APPROVALS", count: scopes.length });
    }
  });

  it("states that already agree are left alone — including a page-only approval made by the current version, to which no listing is added", () => {
    expect(decideReconciliation(state(false, [], false))).toEqual({ kind: "NONE" });
    expect(decideReconciliation(state(false, [], true))).toEqual({ kind: "NONE" });
    for (const scopes of SCOPE_SETS.filter((s) => s.includes("PAGE"))) for (const hold of [false, true]) expect(decideReconciliation(state(true, scopes, hold)), JSON.stringify({ scopes, hold })).toEqual({ kind: "NONE" });
  });

  it("never grants anything to a page that carries neither the flag nor an approval", () => {
    for (const hold of [false, true]) expect(decideReconciliation(state(false, [], hold)).kind).toBe("NONE");
  });
});
