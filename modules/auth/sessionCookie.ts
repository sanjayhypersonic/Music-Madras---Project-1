// Single source of truth for the database-session cookie's name and
// attributes (Phase 5C). Shared by modules/auth/authConfig.ts (which
// tells Auth.js's own session-reading/sign-out code what to look for)
// and modules/auth/credentialsSignIn.ts (which sets this cookie by hand
// after verifying a password, since Auth.js's Credentials provider
// cannot write a database session — see docs/phase-4-studio.md for why).
// One definition here means the two sides can never drift apart.
//
// Values mirror Auth.js's own defaults for the "database" session
// strategy exactly (@auth/core's defaultCookies in lib/utils/cookie.ts),
// so nothing about how Auth.js itself sets or reads this cookie for the
// optional Google OAuth path changes.

const useSecureCookies = (process.env.AUTH_URL ?? "").startsWith("https://");

export const SESSION_COOKIE_NAME = `${useSecureCookies ? "__Secure-" : ""}authjs.session-token`;

export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  secure: useSecureCookies,
};

// Matches Auth.js's own default session maxAge (30 days — see
// @auth/core's lib/init.ts). modules/auth/authConfig.ts does not
// override session.maxAge, so this stays the effective value for every
// sign-in path, Credentials and Google alike.
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
