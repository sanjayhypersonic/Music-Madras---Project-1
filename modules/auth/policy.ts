import type { StudioRoleName } from "./types";

// Server-side authorization (ADR §7.9, brief §3: "UI permissions + server
// authorization must agree" and "do not rely on hiding buttons"). This is
// a deliberately small, explicit permission matrix, not a general-purpose
// policy engine — six roles, seven actions, one lookup table. Every
// Server Action that mutates data calls `can()` before touching a
// repository; a hidden/disabled button in the UI is a courtesy, never the
// actual gate.

export type StudioAction =
  | "CATALOGUE_WRITE" // create/edit Composer, MusicalWork, Artist, Choir, Conductor, Venue, Organisation, Collection
  | "RECORDING_WRITE" // create/edit a Recording draft revision
  | "EDITORIAL_REVIEW" // move a recording through DRAFT -> ENRICHMENT -> EDITORIAL_REVIEW -> APPROVED
  | "RECORDING_PUBLISH" // move an APPROVED recording to PUBLISHED, or unpublish/archive
  | "USER_MANAGE" // invite, disable, change roles
  | "SETTINGS_MANAGE" // Studio-wide settings
  | "AUDIT_VIEW"; // read the audit log

// Roles ordered as the ADR/legacy prototype's own RoleManagement screen
// described them (docs/phase-2-gais-functionality-map.md): Founder (root
// ownership), Super Administrator / Administrator (publishing + user
// administration), Editor (relational entity mapping, metadata drafts),
// Reviewer (audit and correction of drafts), Contributor (ingestion/
// draft-creation only). Brief §22 explicitly requires that Contributors
// cannot publish unless the model says so — they don't, here.
const ROLE_PERMISSIONS: Record<StudioRoleName, ReadonlySet<StudioAction>> = {
  CONTRIBUTOR: new Set<StudioAction>(["RECORDING_WRITE"]),
  EDITOR: new Set<StudioAction>(["RECORDING_WRITE", "CATALOGUE_WRITE", "EDITORIAL_REVIEW"]),
  REVIEWER: new Set<StudioAction>(["RECORDING_WRITE", "CATALOGUE_WRITE", "EDITORIAL_REVIEW"]),
  ADMINISTRATOR: new Set<StudioAction>([
    "RECORDING_WRITE",
    "CATALOGUE_WRITE",
    "EDITORIAL_REVIEW",
    "RECORDING_PUBLISH",
    "AUDIT_VIEW",
  ]),
  SUPER_ADMINISTRATOR: new Set<StudioAction>([
    "RECORDING_WRITE",
    "CATALOGUE_WRITE",
    "EDITORIAL_REVIEW",
    "RECORDING_PUBLISH",
    "AUDIT_VIEW",
    "USER_MANAGE",
    "SETTINGS_MANAGE",
  ]),
  FOUNDER: new Set<StudioAction>([
    "RECORDING_WRITE",
    "CATALOGUE_WRITE",
    "EDITORIAL_REVIEW",
    "RECORDING_PUBLISH",
    "AUDIT_VIEW",
    "USER_MANAGE",
    "SETTINGS_MANAGE",
  ]),
};

export function can(role: StudioRoleName, action: StudioAction): boolean {
  return ROLE_PERMISSIONS[role].has(action);
}

/**
 * Role management itself is restricted to Founder/Super Administrator
 * (ADR §7.6) — a Founder account is never revocable via this check, which
 * callers should enforce separately (never depend on this function alone
 * to protect the last Founder account).
 */
export function canManageUsers(role: StudioRoleName): boolean {
  return can(role, "USER_MANAGE");
}
