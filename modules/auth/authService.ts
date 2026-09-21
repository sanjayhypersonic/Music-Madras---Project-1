import { auth, signOut } from "../../auth";
import { signInWithStudioCredentials, type CredentialsSignInResult } from "./credentialsSignIn";
import type { StudioSession } from "./types";

// The boundary the rest of the application depends on (Phase 4 brief:
// "the rest of the application should depend on Music Madras auth
// interfaces/services rather than importing Auth.js throughout the
// application"). Studio pages, layouts, and Server Actions import from
// here — never from "next-auth" or the root auth.ts directly. Swapping
// or upgrading the underlying provider later means changing this file
// (and modules/auth/authConfig.ts, modules/auth/studioAuthAdapter.ts),
// not every call site across Studio/MMKE/repositories.

export async function getCurrentStudioSession(): Promise<StudioSession | null> {
  const session = await auth();
  return session as StudioSession | null;
}

export type { CredentialsSignInResult };

// Delegates to modules/auth/credentialsSignIn.ts rather than Auth.js's
// own signIn("credentials", ...) — see that file and
// modules/auth/authConfig.ts for why the Credentials provider isn't used
// for Studio's password sign-in. Any error thrown here (e.g. a database
// failure) is a genuine unexpected failure, not a credentials rejection
// (those are reported via the returned `{ success: false }`, never a
// thrown error) — it is intentionally left to propagate and be logged
// normally rather than being masked as "Incorrect email or password."
export async function signInWithCredentials(email: string, password: string): Promise<CredentialsSignInResult> {
  return signInWithStudioCredentials(email, password);
}

export async function signOutCurrentUser(): Promise<void> {
  await signOut({ redirect: false });
}
