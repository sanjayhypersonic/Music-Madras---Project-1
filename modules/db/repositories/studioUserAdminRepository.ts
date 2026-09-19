import { prisma } from "../client";
import { writeAuditLog } from "../../audit/writeAuditLog";
import { deleteAllSessionsForUser } from "./studioAuthRepository";
import type { StudioRoleName } from "../../auth/types";
import type { StudioUser } from "@prisma/client";

// User administration (ADR §7.5-7.6, brief §26). Disabling immediately
// revokes sessions rather than waiting for a token to expire — this is
// what "database sessions" (ADR §7) actually buys over a JWT strategy.

export function listStudioUsers(): Promise<StudioUser[]> {
  return prisma.studioUser.findMany({ orderBy: { createdAt: "asc" } });
}

export async function disableStudioUser(targetUserId: string, actorId: string): Promise<StudioUser> {
  const updated = await prisma.studioUser.update({
    where: { id: targetUserId },
    data: { status: "DISABLED" },
  });

  await deleteAllSessionsForUser(targetUserId);

  await writeAuditLog({
    actorId,
    action: "STUDIO_USER_DISABLED",
    entityType: "StudioUser",
    entityId: targetUserId,
  });

  return updated;
}

export async function reactivateStudioUser(targetUserId: string, actorId: string): Promise<StudioUser> {
  const updated = await prisma.studioUser.update({
    where: { id: targetUserId },
    data: { status: "ACTIVE" },
  });

  await writeAuditLog({
    actorId,
    action: "STUDIO_USER_REACTIVATED",
    entityType: "StudioUser",
    entityId: targetUserId,
  });

  return updated;
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
  const before = await prisma.studioUser.findUnique({ where: { id: targetUserId } });

  const updated = await prisma.studioUser.update({
    where: { id: targetUserId },
    data: { role: newRole },
  });

  await writeAuditLog({
    actorId,
    action: "STUDIO_USER_ROLE_CHANGED",
    entityType: "StudioUser",
    entityId: targetUserId,
    beforeSnapshot: { role: before?.role },
    afterSnapshot: { role: newRole },
  });

  return updated;
}
