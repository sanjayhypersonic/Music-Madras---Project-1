import { prisma } from "../client";
import { writeAuditLog } from "../../audit/writeAuditLog";
import { generateRawToken, hashToken } from "../../auth/tokens";
import type { StudioRoleName } from "../../auth/types";
import type { Invitation, StudioUser } from "@prisma/client";

const INVITATION_EXPIRY_HOURS = 72;

export class InvitationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvitationError";
  }
}

export interface CreateInvitationResult {
  invitation: Invitation;
  studioUser: StudioUser;
  rawToken: string; // exists only here — never persisted, never logged elsewhere
}

/**
 * Invite-only account creation (ADR §7.1-7.2): creates the StudioUser row
 * (status INVITED, no password yet) together with the Invitation record
 * in one transaction, or issues a fresh invitation token for an
 * already-INVITED (not yet activated) user. Rejects re-inviting an
 * ACTIVE or DISABLED account — that's a different admin action (role
 * change / reactivation), not an invitation.
 */
export async function createInvitation(
  email: string,
  role: StudioRoleName,
  invitedById: string,
  name: string
): Promise<CreateInvitationResult> {
  return prisma.$transaction(async (tx) => {
    let studioUser = await tx.studioUser.findUnique({ where: { email } });

    if (studioUser && studioUser.status !== "INVITED") {
      throw new InvitationError(
        `${email} already has an ${studioUser.status.toLowerCase()} Studio account — invitation is only for new accounts.`
      );
    }

    if (!studioUser) {
      studioUser = await tx.studioUser.create({
        data: { email, name, role, status: "INVITED" },
      });
    } else if (studioUser.role !== role) {
      studioUser = await tx.studioUser.update({
        where: { id: studioUser.id },
        data: { role },
      });
    }

    const rawToken = generateRawToken();
    const invitation = await tx.invitation.create({
      data: {
        email,
        role,
        invitedById,
        tokenHash: hashToken(rawToken),
        expiresAt: new Date(Date.now() + INVITATION_EXPIRY_HOURS * 60 * 60 * 1000),
      },
    });

    await writeAuditLog(
      {
        actorId: invitedById,
        action: "STUDIO_USER_INVITED",
        entityType: "StudioUser",
        entityId: studioUser.id,
        afterSnapshot: { email, role },
      },
      tx
    );

    return { invitation, studioUser, rawToken };
  });
}

export interface ValidInvitation {
  invitation: Invitation;
  studioUser: StudioUser;
}

export async function findValidInvitationByRawToken(rawToken: string): Promise<ValidInvitation | null> {
  const invitation = await prisma.invitation.findUnique({ where: { tokenHash: hashToken(rawToken) } });
  if (!invitation || invitation.acceptedAt || invitation.expiresAt.getTime() < Date.now()) {
    return null;
  }

  const studioUser = await prisma.studioUser.findUnique({ where: { email: invitation.email } });
  if (!studioUser || studioUser.status !== "INVITED") {
    return null;
  }

  return { invitation, studioUser };
}

/**
 * Activation (ADR §7.3): sets the password and flips status
 * INVITED -> ACTIVE. This is the only place a StudioUser transitions to
 * ACTIVE for the first time.
 */
export async function acceptInvitation(
  rawToken: string,
  passwordHash: string
): Promise<StudioUser> {
  const valid = await findValidInvitationByRawToken(rawToken);
  if (!valid) {
    throw new InvitationError("This invitation link is invalid, expired, or already used.");
  }

  return prisma.$transaction(async (tx) => {
    const activated = await tx.studioUser.update({
      where: { id: valid.studioUser.id },
      data: { status: "ACTIVE", passwordHash },
    });

    await tx.invitation.update({ where: { id: valid.invitation.id }, data: { acceptedAt: new Date() } });

    await writeAuditLog(
      {
        actorId: activated.id,
        action: "STUDIO_USER_ACTIVATED",
        entityType: "StudioUser",
        entityId: activated.id,
      },
      tx
    );

    return activated;
  });
}
