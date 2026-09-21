import type { NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";
import { studioAuthAdapter } from "./studioAuthAdapter";
import { findStudioUserByEmail } from "../db/repositories/studioAuthRepository";
import { SESSION_COOKIE_NAME, SESSION_COOKIE_OPTIONS } from "./sessionCookie";
import type { StudioSessionUser } from "./types";

// The one file that assembles the actual next-auth configuration —
// everything Auth.js-specific (providers, adapter wiring, the module
// type-augmentation below) lives here. Application code never imports
// this file directly; it goes through modules/auth/authService.ts
// instead (see docs/phase-4-studio.md).
//
// Session strategy is "database" (ADR §7: "database-backed sessions...
// allows immediate session invalidation on disable/role-change") — every
// request re-checks StudioSession/StudioUser in Postgres via the adapter,
// rather than trusting a signed JWT that could outlive a disable action.
//
// No Credentials provider is registered here. Auth.js's Credentials
// provider always issues a JWT for its session cookie regardless of the
// configured session strategy — it cannot write a database session, and
// with only that provider configured Auth.js refuses to even start
// ("UnsupportedStrategy: Signing in with credentials only supported if
// JWT strategy is enabled"). Music Madras's password sign-in is
// implemented in modules/auth/credentialsSignIn.ts instead: it verifies
// the password itself and creates a StudioSession row directly through
// the same repository the adapter's own createSession uses, then sets
// this exact cookie (name/attributes from modules/auth/sessionCookie.ts,
// the single shared definition both this file and credentialsSignIn.ts
// read from) so Auth.js's database-session read path below resolves it
// exactly as it would a Google-created session. See
// docs/phase-4-studio.md for the full investigation and reasoning.

declare module "next-auth" {
  interface Session {
    user: StudioSessionUser;
  }
}

const providers: NextAuthConfig["providers"] = [];

// Google is genuinely optional (ADR §7.8: "available because some editors
// may prefer it, not because it's required") and is only ever added to
// the provider list when real credentials are configured — never in this
// codebase today. No Google Cloud project/OAuth application has been
// created; GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET are documented as empty
// placeholders in .env.example.
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  providers.push(
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      // Studio's own signIn callback below re-verifies the email belongs
      // to an existing ACTIVE StudioUser before allowing this link —
      // Google itself already verifies the email address, and ADR §7.8
      // explicitly wants sign-in-by-matching-email for an existing
      // invited/active account, not a blanket ban on account linking.
      allowDangerousEmailAccountLinking: true,
    })
  );
}

export const authConfig: NextAuthConfig = {
  adapter: studioAuthAdapter,
  session: { strategy: "database" },
  // Explicit, not left to Auth.js's own default computation, so this
  // file and modules/auth/credentialsSignIn.ts are guaranteed to agree —
  // see modules/auth/sessionCookie.ts.
  cookies: {
    sessionToken: {
      name: SESSION_COOKIE_NAME,
      options: SESSION_COOKIE_OPTIONS,
    },
  },
  providers,
  pages: {
    signIn: "/studio/signin",
  },
  callbacks: {
    async signIn({ user, account }) {
      // Invite-only enforcement for OAuth (ADR §7.8): Google sign-in must
      // match an existing ACTIVE StudioUser by email. Credentials sign-in
      // enforces the equivalent check itself in
      // modules/auth/credentialsSignIn.ts (status !== "ACTIVE" is one of
      // its generic-failure conditions).
      if (account?.provider === "google") {
        if (!user.email) return false;
        const existing = await findStudioUserByEmail(user.email);
        if (!existing || existing.status !== "ACTIVE") return false;
      }
      return true;
    },
    async session({ session, user }) {
      // `user` here is the AdapterUser next-auth loaded via the database
      // strategy — it doesn't carry role/status (those aren't part of
      // Auth.js's own AdapterUser shape), so this looks the full
      // StudioUser back up to build Music Madras's own session shape.
      const studioUser = await findStudioUserByEmail(user.email);
      if (!studioUser) {
        // The account was deleted/disabled between the session lookup and
        // this callback running — fail closed rather than return a
        // half-formed session.
        throw new Error("Studio account no longer exists.");
      }
      // Built as a separately-typed constant, not assigned as an inline
      // object literal. The `declare module "next-auth"` augmentation
      // above correctly types `Session` for external consumers (e.g. a
      // future `useSession()` call), but with no Credentials provider
      // registered, Auth.js's own overload resolution for *this specific
      // callback's* `session` parameter stops threading through that
      // augmentation — it types `session.user` as its own default
      // `AdapterUser & User` instead of `AdapterUser & StudioSessionUser`
      // (confirmed by removing the Credentials provider and re-running
      // tsc; this is a beta-version quirk, not something to design
      // around further). Assigning a literal directly would trip
      // TypeScript's excess-property check on `role`/`status`; assigning
      // through this typed variable does not, while still requiring every
      // field Auth.js's own type demands (id/email/name/emailVerified) to
      // be present and correctly typed. emailVerified is an AdapterUser
      // concept Music Madras doesn't use (StudioUser has no such field;
      // Google sign-in is matched by existing-account email above, not by
      // verification status).
      const studioSessionUser: StudioSessionUser & { emailVerified: null } = {
        id: studioUser.id,
        email: studioUser.email,
        name: studioUser.name,
        role: studioUser.role,
        status: studioUser.status,
        emailVerified: null,
      };
      session.user = studioSessionUser;
      return session;
    },
  },
};
