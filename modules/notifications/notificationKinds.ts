import type { StudioAction } from "../auth/policy";
import type { NotificationSeverity } from "@prisma/client";

// Phase 6K-1 — the kinds of Studio notification the platform raises. A kind fixes WHO may see it (the StudioAction required — RBAC
// applies to notifications too) and its default severity; the text of each notification is produced by the code that raises it, from
// current data. Kinds are application logic (they name the conditions the code detects), so they live here; the notifications themselves
// are data.

export interface NotificationKindDefinition {
  label: string;
  audienceAction: StudioAction;
  severity: NotificationSeverity;
}

export const NOTIFICATION_KINDS = {
  UNLISTED_REVIEW_PENDING: { label: "Unlisted videos awaiting a decision", audienceAction: "RECORDING_PUBLISH", severity: "ACTION_REQUIRED" },
  CARRIED_OVER_APPROVALS: { label: "Earlier public approvals waiting to be reconsidered", audienceAction: "RECORDING_PUBLISH", severity: "INFO" },
  METADATA_REVIEW_PENDING: { label: "Approved videos whose metadata changed after review", audienceAction: "RECORDING_PUBLISH", severity: "WARNING" },
  STEWARDSHIP_JOB_PROBLEM: { label: "Scheduled maintenance needs attention", audienceAction: "SETTINGS_MANAGE", severity: "WARNING" },
  PLAYLIST_QUALITY_FAILED: { label: "A playlist page needs more before it can be published", audienceAction: "CATALOGUE_WRITE", severity: "ACTION_REQUIRED" },
  PLAYLIST_QUALITY_REGRESSION: { label: "A playlist page no longer meets the publication checks", audienceAction: "CATALOGUE_WRITE", severity: "WARNING" },
  NOTIFICATION_DELIVERY_PROBLEM: { label: "Notification delivery needs attention", audienceAction: "SETTINGS_MANAGE", severity: "WARNING" },
  OPERATIONAL_INCIDENT_RECURRING: { label: "An operational problem keeps recurring", audienceAction: "SETTINGS_MANAGE", severity: "WARNING" },
} as const satisfies Record<string, NotificationKindDefinition>;

export type NotificationKind = keyof typeof NOTIFICATION_KINDS;

export function isNotificationKind(value: string): value is NotificationKind {
  return Object.prototype.hasOwnProperty.call(NOTIFICATION_KINDS, value);
}

export const NOTIFICATION_LIMITS = { title: 160, body: 2000, dedupeKey: 200, href: 200 } as const;

/** An internal Studio path only: never a URL, protocol-relative or off-site target. */
export function isSafeStudioHref(href: string): boolean {
  return href.startsWith("/studio/") && !href.startsWith("//") && !href.includes("://") && !/[\s\\<>"']/.test(href) && href.length <= NOTIFICATION_LIMITS.href;
}
