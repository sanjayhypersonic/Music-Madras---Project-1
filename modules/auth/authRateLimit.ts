import { createHash } from "crypto";

// Phase 6J-1 — basic brute-force protection for Studio sign-in and password
// reset. The V1 audit found no limits at all. This is deliberately small:
//
//   - keyed by the SHA-256 of the normalised email, so it applies identically to
//     real and non-existent accounts (a lockout reveals nothing about whether an
//     account exists) and never stores a raw email;
//   - counted from the append-only audit log (no new table, no migration, and it
//     works across serverless instances, unlike an in-memory counter);
//   - sign-in: 5 failures in 15 minutes locks that email out for the remainder of
//     the window; a successful sign-in resets the count;
//   - reset requests: 5 per hour per email; beyond that the request is quietly not
//     acted on (the response is identical, so it cannot be used to enumerate).
//
// Invitation and reset TOKENS are 256-bit random values; guessing them is not
// feasible, so they are not rate limited here.
//
// Pure: no database. authAttemptRepository.ts supplies the counts.

export const SIGN_IN_MAX_FAILURES = 5;
export const SIGN_IN_WINDOW_MS = 15 * 60 * 1000;
export const RESET_REQUEST_MAX = 5;
export const RESET_REQUEST_WINDOW_MS = 60 * 60 * 1000;

export const AUTH_ATTEMPT_ENTITY_TYPE = "AuthAttempt";
export const AUTH_AUDIT_ACTIONS = {
  signInFailed: "AUTH_SIGN_IN_FAILED",
  signInSucceeded: "AUTH_SIGN_IN_SUCCEEDED",
  resetRequested: "AUTH_PASSWORD_RESET_REQUESTED",
} as const;

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** The audit entityId for an email's attempts: a hash, never the address. */
export function attemptKey(email: string): string {
  return createHash("sha256").update(normaliseEmail(email)).digest("hex");
}

export function isSignInLockedOut(failuresInWindow: number): boolean {
  return failuresInWindow >= SIGN_IN_MAX_FAILURES;
}

export function isResetRequestLimited(requestsInWindow: number): boolean {
  return requestsInWindow >= RESET_REQUEST_MAX;
}

export const SIGN_IN_LOCKED_MESSAGE = "Too many unsuccessful sign-in attempts. Please wait a few minutes and try again.";
