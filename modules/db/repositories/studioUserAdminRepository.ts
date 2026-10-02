import { prisma } from "../client";
import { writeAuditLog } from "../../audit/writeAuditLog";
import { deleteAllSessionsForUser } from "./studioAuthRepository";
import {
  USER_MANAGER_ROLES,
  checkChangeRole,
  checkDisable,
  checkReactivate,
  describeUserManagementRefusal,
  type UserManagementRefusal,
} from "../../auth/userManagementRules";
import type { StudioRoleName } from "../../auth/types";
import type { Prisma, StudioUser } from "@prisma/client";

// User administration (ADR §7.5-7.6, brief §26). Disabling immediately
// revokes sessions rather than waiting for a token to expire — this is
// what "database sessions" (ADR §7) actually buys over a JWT strategy.
//
// Phase 6J-1: every change is checked against the pure rules in
// modules/auth/userManagementRules.ts INSIDE the repository, under one advisory
// lock, so the Founder is protected, nobody can lock themselves out or rank
// themselves up, and an invited account cannot be "reactivated" into existence
// — whichever caller (Server Action, script, test) makes the change, and even
// when two administrators act at once.

export class UserManagementError extends Error {
  constructor(public readonly reason: UserManagementRefusal) {
    super(describeUserManagementRefusal(reason));
    this.name = "UserManagementError";
  }
}

export function listStudioUsers(): Promise<StudioUser[]> {
  return prisma.studioUser.findMany({ orderBy: { createdAt: "asc" } });
}

interface Loaded {
  actor: StudioUser;
  target: StudioUser;
  activeUserManagerCount: number;
}

/** Serializes user-management changes and hands the callback the facts the rules need. */
async function underUserManagementLock<T>(
  targetUserId: string,
  actorId: string,
  run: (tx: Prisma.TransactionClient, facts: Loaded) => Promise<T>
): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('studio-user-management'))`;
      const [actor, target, activeUserManagerCount] = await Promise.all([
        tx.studioUser.findUnique({ where: { id: actorId } }),
        tx.studioUser.findUnique({ where: { id: targetUserId } }),
        tx.studioUser.count({ where: { status: "ACTIVE", role: { in: USER_MANAGER_ROLES } } }),
      ]);
      if (!actor) throw new UserManagementError("ACTOR_NOT_ACTIVE");
      if (!target) throw new Error(`StudioUser ${targetUserId} does not exist.`);
      return run(tx, { actor, target, activeUserManagerCount });
    },
    { timeout: 30000, maxWait: 10000 }
  );
}

const asFacts = (user: StudioUser) => ({ id: user.id, role: user.role as StudioRoleName, status: user.status });
const asTarget = (user: StudioUser) => ({ ...asFacts(user), hasPassword: user.passwordHash !== null });

export async function disableStudioUser(targetUserId: string, actorId: string): Promise<StudioUser> {
  const updated = await underUserManagementLock(targetUserId, actorId, async (tx, { actor, target, activeUserManagerCount }) => {
    const refusal = checkDisable(asFacts(actor), asTarget(target), activeUserManagerCount);
    if (refusal) throw new UserManagementError(refusal);

    const result = await tx.studioUser.update({ where: { id: targetUserId }, data: { status: "DISABLED" } });
    await writeAuditLog(
      {
        actorId,
        action: "STUDIO_USER_DISABLED",
        entityType: "StudioUser",
        entityId: targetUserId,
        beforeSnapshot: { status: target.status },
        afterSnapshot: { status: "DISABLED" },
      },
      tx
    );
    return result;
  });

  await deleteAllSessionsForUser(targetUserId);
  return updated;
}

export async function reactivateStudioUser(targetUserId: string, actorId: string): Promise<StudioUser> {
  return underUserManagementLock(targetUserId, actorId, async (tx, { actor, target }) => {
    const refusal = checkReactivate(asFacts(actor), asTarget(target));
    if (refusal) throw new UserManagementError(refusal);

    const result = await tx.studioUser.update({ where: { id: targetUserId }, data: { status: "ACTIVE" } });
    await writeAuditLog(
      {
        actorId,
        action: "STUDIO_USER_REACTIVATED",
        entityType: "StudioUser",
        entityId: targetUserId,
        beforeSnapshot: { status: target.status },
        afterSnapshot: { status: "ACTIVE" },
      },
      tx
    );
    return result;
  });
}

/**
 * Self-service password change (distinct from the invitation/reset-token
 * flows in invitationRepository/passwordResetRepository, which don't
 * require knowing the current password). The caller is responsible for
 * verifying the current password before calling this — see
 * app/(studio)/studio/(protected)/settings/actions.ts.
 */
export async function updateStudioUserPassword(userId: string, newPasswordHash: string): Promise<StudioUser> {
  const updated = await prisma.studioUser.update({
    where: { id: userId },
    data: { passwordHash: newPasswordHash },
  });

  await writeAuditLog({
    actorId: userId,
    action: "STUDIO_USER_PASSWORD_CHANGED",
    entityType: "StudioUser",
    entityId: userId,
  });

  await deleteAllSessionsForUser(userId);

  return updated;
}

export async function changeStudioUserRole(
  targetUserId: string,
  newRole: StudioRoleName,
  actorId: string
): Promise<StudioUser> {
  return underUserManagementLock(targetUserId, actorId, async (tx, { actor, target, activeUserManagerCount }) => {
    const refusal = checkChangeRole(asFacts(actor), asTarget(target), newRole, activeUserManagerCount);
    if (refusal) throw new UserManagementError(refusal);

    const result = await tx.studioUser.update({ where: { id: targetUserId }, data: { role: newRole } });
    await writeAuditLog(
      {
        actorId,
        action: "STUDIO_USER_ROLE_CHANGED",
        entityType: "StudioUser",
        entityId: targetUserId,
        beforeSnapshot: { role: target.role },
        afterSnapshot: { role: newRole },
      },
      tx
    );
    return result;
  });
}
