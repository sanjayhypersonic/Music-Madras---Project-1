// Music Madras's own auth-domain types. Application code (Studio pages,
// Server Actions, RBAC checks) imports these — never next-auth's own
// `Session`/`User` types directly — so that upgrading or replacing the
// authentication provider later never requires touching call sites
// throughout Studio/MMKE/repositories/editorial workflows (Phase 4 brief's
// explicit isolation requirement).

export type StudioRoleName =
  | "FOUNDER"
  | "SUPER_ADMINISTRATOR"
  | "ADMINISTRATOR"
  | "EDITOR"
  | "REVIEWER"
  | "CONTRIBUTOR";

export type StudioUserStatusName = "INVITED" | "ACTIVE" | "DISABLED";

/** The authenticated user shape the rest of the application works with. */
export interface StudioSessionUser {
  id: string;
  email: string;
  name: string;
  role: StudioRoleName;
  status: StudioUserStatusName;
}

export interface StudioSession {
  user: StudioSessionUser;
  expires: string; // ISO date string, matching next-auth's own Session.expires shape
}
