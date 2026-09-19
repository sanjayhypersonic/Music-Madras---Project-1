import { prisma } from "../client";
import type { StudioUser } from "@prisma/client";

// The Prisma-touching half of the custom Auth.js adapter (ADR §3 boundary
// rule: only modules/db imports Prisma). modules/auth/studioAuthAdapter.ts
// implements Auth.js's Adapter interface shape and delegates its actual
// database work to these plain functions. See
// docs/phase-4-studio.md for why this project uses a custom adapter
// against the existing StudioUser table rather than @auth/prisma-adapter's
// generic User/Session/Account models.

export function findStudioUserById(id: string): Promise<StudioUser | null> {
  return prisma.studioUser.findUnique({ where: { id } });
}

export function findStudioUserByEmail(email: string): Promise<StudioUser | null> {
  return prisma.studioUser.findUnique({ where: { email } });
}

export async function findStudioUserByAccount(provider: string, providerAccountId: string): Promise<StudioUser | null> {
  const account = await prisma.studioAccount.findUnique({
    where: { provider_providerAccountId: { provider, providerAccountId } },
    include: { studioUser: true },
  });
  return account?.studioUser ?? null;
}

export function updateStudioUserProfile(
  id: string,
  data: Partial<Pick<StudioUser, "name" | "email">>
): Promise<StudioUser> {
  return prisma.studioUser.update({ where: { id }, data });
}

export interface LinkStudioAccountInput {
  studioUserId: string;
  type: string;
  provider: string;
  providerAccountId: string;
  refreshToken?: string | null;
  accessToken?: string | null;
  expiresAt?: number | null;
  tokenType?: string | null;
  scope?: string | null;
  idToken?: string | null;
  sessionState?: string | null;
}

export async function linkStudioAccount(input: LinkStudioAccountInput) {
  return prisma.studioAccount.create({ data: input });
}

export async function unlinkStudioAccount(provider: string, providerAccountId: string): Promise<void> {
  await prisma.studioAccount.delete({
    where: { provider_providerAccountId: { provider, providerAccountId } },
  });
}

export interface CreateStudioSessionInput {
  sessionToken: string;
  studioUserId: string;
  expires: Date;
}

export function createStudioSession(input: CreateStudioSessionInput) {
  return prisma.studioSession.create({ data: input });
}

export async function getStudioSessionWithUser(sessionToken: string) {
  const session = await prisma.studioSession.findUnique({
    where: { sessionToken },
    include: { studioUser: true },
  });
  if (!session) return null;
  return { session, user: session.studioUser };
}

export function updateStudioSessionExpiry(sessionToken: string, expires: Date) {
  return prisma.studioSession.update({ where: { sessionToken }, data: { expires } });
}

export async function deleteStudioSession(sessionToken: string): Promise<void> {
  await prisma.studioSession.deleteMany({ where: { sessionToken } });
}

/**
 * Immediate session revocation (ADR §7.5): deletes every session row for a
 * user, so a disabled account's active sessions stop working on their very
 * next request rather than waiting for a token to expire.
 */
export async function deleteAllSessionsForUser(studioUserId: string): Promise<void> {
  await prisma.studioSession.deleteMany({ where: { studioUserId } });
}
