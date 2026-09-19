import { AuthError } from "next-auth";
import { auth, signIn, signOut } from "../../auth";
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

export interface CredentialsSignInResult {
  success: boolean;
  error?: string;
}

export async function signInWithCredentials(email: string, password: string): Promise<CredentialsSignInResult> {
  try {
    await signIn("credentials", { email, password, redirect: false });
    return { success: true };
  } catch (error) {
    if (error instanceof AuthError) {
      return { success: false, error: "Incorrect email or password." };
    }
    throw error;
  }
}

export async function signOutCurrentUser(): Promise<void> {
  await signOut({ redirect: false });
}
