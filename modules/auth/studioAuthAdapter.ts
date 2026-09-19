import type { Adapter, AdapterAccount, AdapterSession, AdapterUser } from "@auth/core/adapters";
import {
  createStudioSession,
  deleteStudioSession,
  findStudioUserByAccount,
  findStudioUserByEmail,
  findStudioUserById,
  getStudioSessionWithUser,
  linkStudioAccount,
  unlinkStudioAccount,
  updateStudioSessionExpiry,
  updateStudioUserProfile,
} from "../db/repositories/studioAuthRepository";
import type { StudioUser } from "@prisma/client";

// Custom Auth.js Adapter (an officially-documented extension point, see
// https://authjs.dev/guides/creating-a-database-adapter) targeting the
// existing StudioUser table plus the new StudioSession/StudioAccount
// tables, instead of @auth/prisma-adapter's generic User/Session/Account
// models. This is the ONLY file in the application that translates
// between Auth.js's Adapter contract and Music Madras's own schema — see
// docs/phase-4-studio.md for the full reasoning.
//
// `createUser` deliberately always throws: Studio is invite-only (ADR
// §7.1) — there is no path, OAuth or otherwise, by which Auth.js should
// ever be allowed to create a brand-new StudioUser on its own. Every
// account is created only through modules/auth's invitation-acceptance
// flow, which writes to StudioUser directly via its own repository
// function, never through this adapter.

function toAdapterUser(user: StudioUser): AdapterUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    emailVerified: null, // Studio has no email-verification flow (no Email/magic-link provider is used)
  };
}

export const studioAuthAdapter: Adapter = {
  async createUser(): Promise<AdapterUser> {
    throw new Error(
      "Studio does not support self-registration. Accounts are created only via invitation acceptance."
    );
  },

  async getUser(id: string): Promise<AdapterUser | null> {
    const user = await findStudioUserById(id);
    return user ? toAdapterUser(user) : null;
  },

  async getUserByEmail(email: string): Promise<AdapterUser | null> {
    const user = await findStudioUserByEmail(email);
    return user ? toAdapterUser(user) : null;
  },

  async getUserByAccount(
    providerAccountId: Pick<AdapterAccount, "provider" | "providerAccountId">
  ): Promise<AdapterUser | null> {
    const user = await findStudioUserByAccount(providerAccountId.provider, providerAccountId.providerAccountId);
    return user ? toAdapterUser(user) : null;
  },

  async updateUser(user: Partial<AdapterUser> & Pick<AdapterUser, "id">): Promise<AdapterUser> {
    const updated = await updateStudioUserProfile(user.id, {
      name: user.name ?? undefined,
      email: user.email ?? undefined,
    });
    return toAdapterUser(updated);
  },

  async linkAccount(account: AdapterAccount): Promise<void> {
    await linkStudioAccount({
      studioUserId: account.userId,
      type: account.type,
      provider: account.provider,
      providerAccountId: account.providerAccountId,
      refreshToken: account.refresh_token ?? null,
      accessToken: account.access_token ?? null,
      expiresAt: account.expires_at ?? null,
      tokenType: account.token_type ?? null,
      scope: account.scope ?? null,
      idToken: account.id_token ?? null,
      sessionState: typeof account.session_state === "string" ? account.session_state : null,
    });
  },

  async unlinkAccount(providerAccountId: Pick<AdapterAccount, "provider" | "providerAccountId">): Promise<void> {
    await unlinkStudioAccount(providerAccountId.provider, providerAccountId.providerAccountId);
  },

  async createSession(session: { sessionToken: string; userId: string; expires: Date }): Promise<AdapterSession> {
    const created = await createStudioSession({
      sessionToken: session.sessionToken,
      studioUserId: session.userId,
      expires: session.expires,
    });
    return { sessionToken: created.sessionToken, userId: created.studioUserId, expires: created.expires };
  },

  async getSessionAndUser(
    sessionToken: string
  ): Promise<{ session: AdapterSession; user: AdapterUser } | null> {
    const result = await getStudioSessionWithUser(sessionToken);
    if (!result) return null;
    return {
      session: {
        sessionToken: result.session.sessionToken,
        userId: result.session.studioUserId,
        expires: result.session.expires,
      },
      user: toAdapterUser(result.user),
    };
  },

  async updateSession(
    session: Partial<AdapterSession> & Pick<AdapterSession, "sessionToken">
  ): Promise<AdapterSession | null> {
    if (!session.expires) return null;
    const updated = await updateStudioSessionExpiry(session.sessionToken, session.expires);
    return { sessionToken: updated.sessionToken, userId: updated.studioUserId, expires: updated.expires };
  },

  async deleteSession(sessionToken: string): Promise<void> {
    await deleteStudioSession(sessionToken);
  },
};
