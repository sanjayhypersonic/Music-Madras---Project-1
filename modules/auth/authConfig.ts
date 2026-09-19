import type { NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { studioAuthAdapter } from "./studioAuthAdapter";
import { verifyPassword } from "./passwordHashing";
import { findStudioUserByEmail } from "../db/repositories/studioAuthRepository";
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

declare module "next-auth" {
  interface Session {
    user: StudioSessionUser;
  }
}

const providers: NextAuthConfig["providers"] = [
  Credentials({
    credentials: {
      email: { label: "Email", type: "email" },
      password: { label: "Password", type: "password" },
    },
    async authorize(credentials) {
      const email = typeof credentials?.email === "string" ? credentials.email : null;
      const password = typeof credentials?.password === "string" ? credentials.password : null;
      if (!email || !password) return null;

      const user = await findStudioUserByEmail(email);
      // Deliberately the same generic failure for "no such user," "no
      // password set yet," and "wrong password" — never reveal which
      // case it was.
      if (!user || user.status !== "ACTIVE" || !user.passwordHash) return null;

      const passwordMatches = await verifyPassword(user.passwordHash, password);
      if (!passwordMatches) return null;

      return { id: user.id, email: user.email, name: user.name };
    },
  }),
];

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
  providers,
  pages: {
    signIn: "/studio/signin",
  },
  callbacks: {
    async signIn({ user, account }) {
      // Invite-only enforcement for OAuth (ADR §7.8): Google sign-in must
      // match an existing ACTIVE StudioUser by email. Credentials sign-in
      // already enforces this inside `authorize` above.
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
      session.user = {
        id: studioUser.id,
        email: studioUser.email,
        name: studioUser.name,
        role: studioUser.role,
        status: studioUser.status,
        // Auth.js's own Session.user type is `AdapterUser & StudioSessionUser`
        // (declaration merging with Auth.js's built-in Session interface) —
        // emailVerified is an AdapterUser concept Music Madras doesn't use
        // (StudioUser has no such field; Google sign-in is matched by
        // existing-account email above, not by verification status).
        emailVerified: null,
      };
      return session;
    },
  },
};
