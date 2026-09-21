import { cookies } from "next/headers";
import { randomUUID } from "crypto";
import { findStudioUserByEmail } from "../db/repositories/studioAuthRepository";
import { createStudioSession } from "../db/repositories/studioAuthRepository";
import { verifyPassword } from "./passwordHashing";
import { SESSION_COOKIE_NAME, SESSION_COOKIE_OPTIONS, SESSION_MAX_AGE_SECONDS } from "./sessionCookie";

// Verifies Studio credentials and creates a database-backed session
// directly, bypassing Auth.js's own Credentials provider entirely.
//
// Why: Auth.js's Credentials provider always issues a JWT for its
// session cookie, regardless of the configured session strategy — its
// sign-in handler never calls an adapter's createSession. Combined with
// `session: { strategy: "database" }` (required by the ADR for immediate
// revocation on disable/role-change), Auth.js refuses to even start
// ("UnsupportedStrategy: Signing in with credentials only supported if
// JWT strategy is enabled"). See docs/phase-4-studio.md for the full
// investigation.
//
// This reuses exactly the same verification logic the Credentials
// provider's authorize() used to run (findStudioUserByEmail +
// verifyPassword + the same StudioUser status checks), and the exact
// same session-creation mechanism the custom adapter itself uses for
// Google sign-in (studioAuthRepository.createStudioSession) — a session
// created here is indistinguishable from one Auth.js created. Auth.js's
// own database-session read path (modules/auth/authConfig.ts's `session`
// callback, next-auth's `auth()`) and sign-out both keep working
// unchanged, because they only care that a real StudioSession row exists
// and that the cookie carrying its token has the name/attributes in
// modules/auth/sessionCookie.ts — never how the row was created.
//
// No StudioAccount row is created here: StudioAccount exists for
// OAuth-linked identities (ADR §7), and a password sign-in has no
// external account to link.

export interface CredentialsSignInResult {
  success: boolean;
  error?: string;
}

const GENERIC_FAILURE: CredentialsSignInResult = {
  success: false,
  error: "Incorrect email or password.",
};

export async function signInWithStudioCredentials(
  email: string,
  password: string
): Promise<CredentialsSignInResult> {
  // Deliberately the same generic failure for "no such user," "no
  // password set yet," "account not ACTIVE," and "wrong password" —
  // never reveal which case it was (matches the previous authorize()
  // in modules/auth/authConfig.ts before this change).
  const user = await findStudioUserByEmail(email);
  if (!user || user.status !== "ACTIVE" || !user.passwordHash) {
    return GENERIC_FAILURE;
  }

  const passwordMatches = await verifyPassword(user.passwordHash, password);
  if (!passwordMatches) {
    return GENERIC_FAILURE;
  }

  // crypto.randomUUID() matches Auth.js's own default
  // generateSessionToken (@auth/core's lib/init.ts) — the same
  // unpredictability guarantee, just invoked directly instead of through
  // the Credentials provider that can't reach this code path.
  const sessionToken = randomUUID();
  await createStudioSession({
    sessionToken,
    studioUserId: user.id,
    expires: new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000),
  });

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, sessionToken, SESSION_COOKIE_OPTIONS);

  return { success: true };
}
