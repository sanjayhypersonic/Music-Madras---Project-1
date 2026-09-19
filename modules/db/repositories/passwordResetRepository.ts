import { prisma } from "../client";
import { writeAuditLog } from "../../audit/writeAuditLog";
import { deleteAllSessionsForUser } from "./studioAuthRepository";
import { generateRawToken, hashToken } from "../../auth/tokens";
import type { PasswordResetToken, StudioUser } from "@prisma/client";

const RESET_TOKEN_EXPIRY_MINUTES = 30;

export class PasswordResetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PasswordResetError";
  }
}

export interface CreatePasswordResetResult {
  token: PasswordResetToken;
  rawToken: string;
}

/**
 * Always succeeds from the caller's perspective even if no matching
 * ACTIVE account exists (the Server Action calling this should show the
 * same "if an account exists, a reset link has been sent" message either
 * way) — this function itself returns null in that case so the call site
 * can decide, without ever revealing account existence through timing or
 * response differences beyond what it explicitly chooses to reveal.
 */
export async function requestPasswordReset(email: string): Promise<CreatePasswordResetResult | null> {
  const user = await prisma.studioUser.findUnique({ where: { email } });
  if (!user || user.status !== "ACTIVE") {
    return null;
  }

  const rawToken = generateRawToken();
  const token = await prisma.passwordResetToken.create({
    data: {
      studioUserId: user.id,
      tokenHash: hashToken(rawToken),
      expiresAt: new Date(Date.now() + RESET_TOKEN_EXPIRY_MINUTES * 60 * 1000),
    },
  });

  return { token, rawToken };
}

export async function findValidPasswordResetToken(rawToken: string): Promise<{ token: PasswordResetToken; user: StudioUser } | null> {
  const token = await prisma.passwordResetToken.findUnique({ where: { tokenHash: hashToken(rawToken) } });
  if (!token || token.usedAt || token.expiresAt.getTime() < Date.now()) {
    return null;
  }
  const user = await prisma.studioUser.findUnique({ where: { id: token.studioUserId } });
  if (!user || user.status !== "ACTIVE") {
    return null;
  }
  return { token, user };
}

/**
 * Completing a reset also revokes every existing session for the account
 * (a stolen/abandoned session should not survive a password reset).
 */
export async function completePasswordReset(rawToken: string, newPasswordHash: string): Promise<StudioUser> {
  const valid = await findValidPasswordResetToken(rawToken);
  if (!valid) {
    throw new PasswordResetError("This password reset link is invalid, expired, or already used.");
  }

  const updated = await prisma.$transaction(async (tx) => {
    const user = await tx.studioUser.update({
      where: { id: valid.user.id },
      data: { passwordHash: newPasswordHash },
    });
    await tx.passwordResetToken.update({ where: { id: valid.token.id }, data: { usedAt: new Date() } });

    await writeAuditLog(
      { actorId: user.id, action: "STUDIO_USER_PASSWORD_RESET", entityType: "StudioUser", entityId: user.id },
      tx
    );

    return user;
  });

  await deleteAllSessionsForUser(updated.id);

  return updated;
}
