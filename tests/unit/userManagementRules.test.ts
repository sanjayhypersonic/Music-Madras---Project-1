import { describe, expect, it } from "vitest";
import {
  USER_MANAGER_ROLES,
  assignableRoles,
  checkChangeRole,
  checkDisable,
  checkInvite,
  checkReactivate,
  describeUserManagementRefusal,
  roleRank,
  type TargetFacts,
  type UserFacts,
  type UserManagementRefusal,
} from "../../modules/auth/userManagementRules";
import type { StudioRoleName } from "../../modules/auth/types";

// Phase 6J-1 — every user-management transition, as pure rules. The repository
// enforces these under an advisory lock; here they are exercised exhaustively
// without a database.

const actor = (role: StudioRoleName, status: UserFacts["status"] = "ACTIVE", id = "actor"): UserFacts => ({ id, role, status });
const target = (role: StudioRoleName, over: Partial<TargetFacts> = {}): TargetFacts => ({ id: "target", role, status: "ACTIVE", hasPassword: true, ...over });
const ALL: StudioRoleName[] = ["FOUNDER", "SUPER_ADMINISTRATOR", "ADMINISTRATOR", "EDITOR", "REVIEWER", "CONTRIBUTOR"];

describe("roles and rank", () => {
  it("keeps exactly the six roles, ordered Founder > Super Administrator > Administrator > Editor = Reviewer > Contributor", () => {
    expect(roleRank("FOUNDER")).toBeGreaterThan(roleRank("SUPER_ADMINISTRATOR"));
    expect(roleRank("SUPER_ADMINISTRATOR")).toBeGreaterThan(roleRank("ADMINISTRATOR"));
    expect(roleRank("ADMINISTRATOR")).toBeGreaterThan(roleRank("EDITOR"));
    expect(roleRank("EDITOR")).toBe(roleRank("REVIEWER"));
    expect(roleRank("EDITOR")).toBeGreaterThan(roleRank("CONTRIBUTOR"));
  });

  it("only the Founder and Super Administrator hold USER_MANAGE", () => {
    expect([...USER_MANAGER_ROLES].sort()).toEqual(["FOUNDER", "SUPER_ADMINISTRATOR"]);
  });

  it("never lets anyone hand out FOUNDER, and only roles below one's own", () => {
    for (const role of ALL) expect(assignableRoles(role)).not.toContain("FOUNDER");
    expect(assignableRoles("FOUNDER").sort()).toEqual(["ADMINISTRATOR", "CONTRIBUTOR", "EDITOR", "REVIEWER", "SUPER_ADMINISTRATOR"]);
    expect(assignableRoles("SUPER_ADMINISTRATOR").sort()).toEqual(["ADMINISTRATOR", "CONTRIBUTOR", "EDITOR", "REVIEWER"]);
    expect(assignableRoles("CONTRIBUTOR")).toEqual([]);
  });
});

describe("checkInvite", () => {
  it("refuses to invite a FOUNDER, whoever asks (a second Founder cannot be created by invitation)", () => {
    for (const role of ALL) expect(checkInvite(actor(role), "FOUNDER")).toBe("FOUNDER_ROLE_NOT_ASSIGNABLE");
  });

  it("allows a role strictly below the inviter's own, and refuses an equal or higher one", () => {
    expect(checkInvite(actor("FOUNDER"), "SUPER_ADMINISTRATOR")).toBeNull();
    expect(checkInvite(actor("SUPER_ADMINISTRATOR"), "ADMINISTRATOR")).toBeNull();
    expect(checkInvite(actor("SUPER_ADMINISTRATOR"), "SUPER_ADMINISTRATOR")).toBe("ROLE_RANK_TOO_HIGH");
    expect(checkInvite(actor("ADMINISTRATOR"), "SUPER_ADMINISTRATOR")).toBe("ROLE_RANK_TOO_HIGH");
    expect(checkInvite(actor("EDITOR"), "EDITOR")).toBe("ROLE_RANK_TOO_HIGH");
  });

  it("refuses an inviter whose account is not active", () => {
    expect(checkInvite(actor("FOUNDER", "DISABLED"), "EDITOR")).toBe("ACTOR_NOT_ACTIVE");
    expect(checkInvite(actor("FOUNDER", "INVITED"), "EDITOR")).toBe("ACTOR_NOT_ACTIVE");
  });
});

describe("checkDisable", () => {
  it("never lets anyone disable themselves", () => {
    for (const role of ALL) expect(checkDisable(actor(role, "ACTIVE", "same"), target(role, { id: "same" }), 5)).toBe("SELF_DISABLE");
  });

  it("protects the Founder from everyone", () => {
    expect(checkDisable(actor("SUPER_ADMINISTRATOR"), target("FOUNDER"), 5)).toBe("FOUNDER_PROTECTED");
    expect(checkDisable(actor("FOUNDER", "ACTIVE", "a"), target("FOUNDER", { id: "b" }), 5)).toBe("FOUNDER_PROTECTED");
  });

  it("lets a Super Administrator disable an Administrator but not a peer; only the Founder manages Super Administrators", () => {
    expect(checkDisable(actor("SUPER_ADMINISTRATOR"), target("ADMINISTRATOR"), 5)).toBeNull();
    expect(checkDisable(actor("SUPER_ADMINISTRATOR"), target("SUPER_ADMINISTRATOR"), 5)).toBe("TARGET_RANK_TOO_HIGH");
    expect(checkDisable(actor("FOUNDER"), target("SUPER_ADMINISTRATOR"), 5)).toBeNull();
  });

  it("reports an already-disabled account rather than acting twice", () => {
    expect(checkDisable(actor("FOUNDER"), target("EDITOR", { status: "DISABLED" }), 5)).toBe("ALREADY_DISABLED");
  });

  it("protects the last active user-manager", () => {
    expect(checkDisable(actor("FOUNDER"), target("SUPER_ADMINISTRATOR"), 1)).toBe("LAST_USER_MANAGER");
    expect(checkDisable(actor("FOUNDER"), target("SUPER_ADMINISTRATOR"), 2)).toBeNull();
    // A non-manager is unaffected by the count.
    expect(checkDisable(actor("FOUNDER"), target("EDITOR"), 1)).toBeNull();
  });

  it("lets an invited (not yet active) user's invitation be revoked even when only one manager remains", () => {
    expect(checkDisable(actor("FOUNDER"), target("SUPER_ADMINISTRATOR", { status: "INVITED", hasPassword: false }), 1)).toBeNull();
  });

  it("refuses a disabled or invited actor", () => {
    expect(checkDisable(actor("FOUNDER", "DISABLED"), target("EDITOR"), 5)).toBe("ACTOR_NOT_ACTIVE");
  });
});

describe("checkChangeRole", () => {
  it("never lets anyone change their own role (no self-demotion, no self-promotion)", () => {
    for (const role of ALL) expect(checkChangeRole(actor(role, "ACTIVE", "same"), target(role, { id: "same" }), "EDITOR", 5)).toBe("SELF_ROLE_CHANGE");
  });

  it("protects the Founder's role, and never assigns FOUNDER", () => {
    expect(checkChangeRole(actor("SUPER_ADMINISTRATOR"), target("FOUNDER"), "EDITOR", 5)).toBe("FOUNDER_PROTECTED");
    expect(checkChangeRole(actor("FOUNDER", "ACTIVE", "a"), target("FOUNDER", { id: "b" }), "EDITOR", 5)).toBe("FOUNDER_PROTECTED");
    expect(checkChangeRole(actor("FOUNDER"), target("SUPER_ADMINISTRATOR"), "FOUNDER", 5)).toBe("FOUNDER_ROLE_NOT_ASSIGNABLE");
    expect(checkChangeRole(actor("SUPER_ADMINISTRATOR"), target("EDITOR"), "FOUNDER", 5)).toBe("FOUNDER_ROLE_NOT_ASSIGNABLE");
  });

  it("only manages users below the actor and only assigns roles below the actor", () => {
    expect(checkChangeRole(actor("SUPER_ADMINISTRATOR"), target("EDITOR"), "ADMINISTRATOR", 5)).toBeNull();
    expect(checkChangeRole(actor("SUPER_ADMINISTRATOR"), target("EDITOR"), "SUPER_ADMINISTRATOR", 5)).toBe("ROLE_RANK_TOO_HIGH");
    expect(checkChangeRole(actor("SUPER_ADMINISTRATOR"), target("SUPER_ADMINISTRATOR"), "EDITOR", 5)).toBe("TARGET_RANK_TOO_HIGH");
    expect(checkChangeRole(actor("FOUNDER"), target("SUPER_ADMINISTRATOR"), "ADMINISTRATOR", 5)).toBeNull();
  });

  it("reports a no-op change", () => {
    expect(checkChangeRole(actor("SUPER_ADMINISTRATOR"), target("EDITOR"), "EDITOR", 5)).toBe("NO_CHANGE");
  });

  it("protects the last active user-manager from demotion", () => {
    expect(checkChangeRole(actor("FOUNDER"), target("SUPER_ADMINISTRATOR"), "ADMINISTRATOR", 1)).toBe("LAST_USER_MANAGER");
    expect(checkChangeRole(actor("FOUNDER"), target("SUPER_ADMINISTRATOR"), "ADMINISTRATOR", 2)).toBeNull();
  });
});

describe("checkReactivate", () => {
  it("does not let an INVITED user bypass invitation acceptance by being 'reactivated'", () => {
    expect(checkReactivate(actor("FOUNDER"), target("EDITOR", { status: "INVITED", hasPassword: false }))).toBe("MUST_ACCEPT_INVITATION");
    expect(checkReactivate(actor("FOUNDER"), target("EDITOR", { status: "INVITED", hasPassword: true }))).toBe("MUST_ACCEPT_INVITATION");
  });

  it("reactivates only a DISABLED user who has a password", () => {
    expect(checkReactivate(actor("FOUNDER"), target("EDITOR", { status: "DISABLED", hasPassword: true }))).toBeNull();
    expect(checkReactivate(actor("FOUNDER"), target("EDITOR", { status: "DISABLED", hasPassword: false }))).toBe("NO_PASSWORD");
    expect(checkReactivate(actor("FOUNDER"), target("EDITOR", { status: "ACTIVE" }))).toBe("ALREADY_ACTIVE");
  });

  it("respects rank when reactivating", () => {
    expect(checkReactivate(actor("SUPER_ADMINISTRATOR"), target("SUPER_ADMINISTRATOR", { status: "DISABLED" }))).toBe("TARGET_RANK_TOO_HIGH");
    expect(checkReactivate(actor("EDITOR"), target("CONTRIBUTOR", { status: "DISABLED" }))).toBeNull(); // rank only; USER_MANAGE is checked by the caller
  });
});

describe("messages", () => {
  it("has a clear, id-free message for every refusal", () => {
    const reasons: UserManagementRefusal[] = [
      "FOUNDER_ROLE_NOT_ASSIGNABLE",
      "FOUNDER_PROTECTED",
      "SELF_DISABLE",
      "SELF_ROLE_CHANGE",
      "TARGET_RANK_TOO_HIGH",
      "ROLE_RANK_TOO_HIGH",
      "LAST_USER_MANAGER",
      "MUST_ACCEPT_INVITATION",
      "NO_PASSWORD",
      "ALREADY_ACTIVE",
      "ALREADY_DISABLED",
      "NO_CHANGE",
      "ACTOR_NOT_ACTIVE",
    ];
    for (const reason of reasons) {
      const message = describeUserManagementRefusal(reason);
      expect(message.length).toBeGreaterThan(10);
      expect(message).not.toMatch(/uuid|prisma|sql/i);
    }
  });
});
