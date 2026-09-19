import NextAuth from "next-auth";
import { authConfig } from "./modules/auth/authConfig";

// The one place Next.js/Auth.js's own file-location convention requires
// touching the repository root. Everything Auth.js-specific (providers,
// adapter, callbacks) lives in modules/auth/authConfig.ts — this file is
// pure wiring. Application code never imports from here directly; see
// modules/auth/authService.ts.
export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
