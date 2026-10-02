import { can } from "./policy";
import type { StudioRoleName } from "./types";

// Phase 6J-1 — server-side rules for who may invite, promote, demote, disable
// or reactivate whom. The V1 audit found that holding USER_MANAGE was enough
// to demote or disable the Founder (or oneself), invite a second FOUNDER, and
// "reactivate" an invited account that never set a password. These pure rules
// close that without a new role model: the six roles are unchanged, ordered
// by a simple rank, and the Founder is simply protected.
//
//   1. Nobody can assign FOUNDER (invitation or role change). The Founder is
//      created once, by the seed script.
//   2. The Founder account cannot be disabled or have its role changed.
//   3. Nobody can disable themselves or change their own role (no lockout, no
//      self-demotion).
//   4. An actor may only manage a user ranked strictly BELOW their own role, and
//      may only assign a role ranked strictly below their own. So a Super
//      Administrator cannot touch the Founder or another Super Administrator;
//      only the Founder manages Super Administrators.
//   5. The last active holder of USER_MANAGE can never be disabled or demoted.
//   6. "Reactivate" is only for a DISABLED user who has a password. An INVITED
//      user must accept their invitation (re-invite instead); reactivating them
//      would create an active account with no credential and no acceptance.
//
// Pure: no database. The repository supplies the facts and enforces the result,
// so every caller — Server Action, script, test — gets the same answer.

export type UserManagementRefusal =
  | "FOUNDER_ROLE_NOT_ASSIGNABLE"
  | "FOUNDER_PROTECTED"
  | "SELF_DISABLE"
  | "SELF_ROLE_CHANGE"
  | "TARGET_RANK_TOO_HIGH"
  | "ROLE_RANK_TOO_HIGH"
  | "LAST_USER_MANAGER"
  | "MUST_ACCEPT_INVITATION"
  | "NO_PASSWORD"
  | "ALREADY_ACTIVE"
  | "ALREADY_DISABLED"
  | "NO_CHANGE"
  | "ACTOR_NOT_ACTIVE";

const RANK: Record<StudioRoleName, number> = {
  CONTRIBUTOR: 1,
  EDITOR: 2,
  REVIEWER: 2,
  ADMINISTRATOR: 3,
  SUPER_ADMINISTRATOR: 4,
  FOUNDER: 5,
};

export function roleRank(role: StudioRoleName): number {
  return RANK[role];
}

export interface UserFacts {
  id: string;
  role: StudioRoleName;
  status: "INVITED" | "ACTIVE" | "DISABLED";
}

export interface TargetFacts extends UserFacts {
  hasPassword: boolean;
}

const MESSAGES: Record<UserManagementRefusal, string> = {
  FOUNDER_ROLE_NOT_ASSIGNABLE: "The Founder role cannot be assigned or invited — there is exactly one Founder account.",
  FOUNDER_PROTECTED: "The Founder account cannot be disabled or have its role changed.",
  SELF_DISABLE: "You cannot disable your own account.",
  SELF_ROLE_CHANGE: "You cannot change your own role.",
  TARGET_RANK_TOO_HIGH: "You can only manage users whose role is below your own.",
  ROLE_RANK_TOO_HIGH: "You can only assign roles that are below your own.",
  LAST_USER_MANAGER: "This is the last account that can manage users, so it cannot be disabled or demoted.",
  MUST_ACCEPT_INVITATION: "This user has not accepted their invitation yet. Send a new invitation instead.",
  NO_PASSWORD: "This account has no password set. Send a new invitation instead.",
  ALREADY_ACTIVE: "This account is already active.",
  ALREADY_DISABLED: "This account is already disabled.",
  NO_CHANGE: "That is already this user's role.",
  ACTOR_NOT_ACTIVE: "Your account is not active.",
};

export function describeUserManagementRefusal(reason: UserManagementRefusal): string {
  return MESSAGES[reason];
}

/** The roles an actor may hand out: every role ranked strictly below their own, never FOUNDER. */
export function assignableRoles(actorRole: StudioRoleName): StudioRoleName[] {
  return (Object.keys(RANK) as StudioRoleName[]).filter((role) => role !== "FOUNDER" && RANK[role] < RANK[actorRole]);
}

export function checkInvite(actor: Pick<UserFacts, "role" | "status">, roleToAssign: StudioRoleName): UserManagementRefusal | null {
  if (actor.status !== "ACTIVE") return "ACTOR_NOT_ACTIVE";
  if (roleToAssign === "FOUNDER") return "FOUNDER_ROLE_NOT_ASSIGNABLE";
  if (RANK[roleToAssign] >= RANK[actor.role]) return "ROLE_RANK_TOO_HIGH";
  return null;
}

function holdsUserManage(role: StudioRoleName): boolean {
  return can(role, "USER_MANAGE");
}

/** Every role that can manage users — what the repository counts to protect the last one. */
export const USER_MANAGER_ROLES: StudioRoleName[] = (Object.keys(RANK) as StudioRoleName[]).filter(holdsUserManage);

/** `activeUserManagerCount` = ACTIVE users whose role holds USER_MANAGE, counted before the change. */
export function checkDisable(actor: UserFacts, target: TargetFacts, activeUserManagerCount: number): UserManagementRefusal | null {
  if (actor.status !== "ACTIVE") return "ACTOR_NOT_ACTIVE";
  if (actor.id === target.id) return "SELF_DISABLE";
  if (target.role === "FOUNDER") return "FOUNDER_PROTECTED";
  if (RANK[target.role] >= RANK[actor.role]) return "TARGET_RANK_TOO_HIGH";
  if (target.status === "DISABLED") return "ALREADY_DISABLED";
  if (target.status === "ACTIVE" && holdsUserManage(target.role) && activeUserManagerCount <= 1) return "LAST_USER_MANAGER";
  return null;
}

export function checkChangeRole(
  actor: UserFacts,
  target: TargetFacts,
  newRole: StudioRoleName,
  activeUserManagerCount: number
): UserManagementRefusal | null {
  if (actor.status !== "ACTIVE") return "ACTOR_NOT_ACTIVE";
  if (actor.id === target.id) return "SELF_ROLE_CHANGE";
  if (target.role === "FOUNDER") return "FOUNDER_PROTECTED";
  if (newRole === "FOUNDER") return "FOUNDER_ROLE_NOT_ASSIGNABLE";
  if (RANK[target.role] >= RANK[actor.role]) return "TARGET_RANK_TOO_HIGH";
  if (RANK[newRole] >= RANK[actor.role]) return "ROLE_RANK_TOO_HIGH";
  if (newRole === target.role) return "NO_CHANGE";
  if (target.status === "ACTIVE" && holdsUserManage(target.role) && !holdsUserManage(newRole) && activeUserManagerCount <= 1) {
    return "LAST_USER_MANAGER";
  }
  return null;
}

export function checkReactivate(actor: UserFacts, target: TargetFacts): UserManagementRefusal | null {
  if (actor.status !== "ACTIVE") return "ACTOR_NOT_ACTIVE";
  if (target.status === "INVITED") return "MUST_ACCEPT_INVITATION";
  if (target.status === "ACTIVE") return "ALREADY_ACTIVE";
  if (RANK[target.role] >= RANK[actor.role]) return "TARGET_RANK_TOO_HIGH";
  if (!target.hasPassword) return "NO_PASSWORD";
  return null;
}
