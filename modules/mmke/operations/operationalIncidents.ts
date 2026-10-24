import { createHash } from "crypto";

// Operational incidents (project register R-15, first slice) — the PURE rules: what may be stored, how a problem is identified, and what the
// administrator notification says. No Prisma, no I/O (ADR §3 boundary rule).
//
// The one invariant that matters: NOTHING FREE-FORM IS EVER STORED OR SHOWN. An incident is a kind (a closed list), a reason CODE (upper-case words
// and underscores, bounded), and optionally a subject (an entity type code and the entity's internal id, in a strict alphabet). Exception messages,
// stack traces, URLs, titles, names and addresses cannot be recorded: input that does not fit the alphabet is replaced by a fixed code or dropped,
// never truncated-and-kept.

export const OPERATIONAL_INCIDENT_KINDS = {
  ORGANISATION_PAGE_RECORDING_OMITTED: {
    label: "A recording's relationships were left off an Organisation page",
    meaning: "Its revision data was inconsistent, so its sources, rights and occasions were omitted (never shown unverified, never taken from legacy rows). Other recordings on the page were unaffected.",
  },
  UNHANDLED_SERVER_ERROR: {
    label: "A page or action failed with an unhandled server error",
    meaning: "Recorded by the framework's error hook with only the kind of error and the route pattern (never the message, the URL or any data). The same failure on the same route is counted, not repeated. Check the server log line {event: unhandled_server_error} for the error digest.",
  },
} as const;

export type OperationalIncidentKindName = keyof typeof OPERATIONAL_INCIDENT_KINDS;

export function isOperationalIncidentKind(value: string): value is OperationalIncidentKindName {
  return Object.prototype.hasOwnProperty.call(OPERATIONAL_INCIDENT_KINDS, value);
}

/** Bounds, as technical limits (not product settings). */
export const INCIDENT_LIMITS = { reasonCode: 64, subjectType: 32, subjectId: 64 } as const;

/** Substituted when a reason code does not fit the alphabet: the incident is still recorded, without the unsafe text. */
export const UNSPECIFIED_REASON = "UNSPECIFIED";

const REASON_CODE = /^[A-Z][A-Z0-9_]*$/;
const SUBJECT_TYPE = /^[A-Za-z][A-Za-z0-9]*$/;
const SUBJECT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export interface IncidentInput {
  kind: string;
  reasonCode: string;
  subject?: { type: string; id: string } | null;
}

export interface CleanIncident {
  kind: OperationalIncidentKindName;
  reasonCode: string;
  subjectType: string | null;
  subjectId: string | null;
}

export class IncidentInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IncidentInputError";
  }
}

/** Reduces input to what may be stored. Unknown kinds are refused; anything else that does not fit is replaced or dropped, never kept as text. */
export function cleanIncident(input: IncidentInput): CleanIncident {
  if (!isOperationalIncidentKind(input.kind)) throw new IncidentInputError("Unknown operational incident kind.");
  const reasonCode = input.reasonCode.length <= INCIDENT_LIMITS.reasonCode && REASON_CODE.test(input.reasonCode) ? input.reasonCode : UNSPECIFIED_REASON;
  const subject = input.subject ?? null;
  const subjectOk =
    subject !== null &&
    subject.type.length <= INCIDENT_LIMITS.subjectType &&
    SUBJECT_TYPE.test(subject.type) &&
    subject.id.length <= INCIDENT_LIMITS.subjectId &&
    SUBJECT_ID.test(subject.id);
  return { kind: input.kind, reasonCode, subjectType: subjectOk ? subject.type : null, subjectId: subjectOk ? subject.id : null };
}

/** The same problem always maps to the same fingerprint, so a repeat updates a count instead of creating a row. */
export function incidentFingerprint(incident: CleanIncident): string {
  return createHash("sha256").update([incident.kind, incident.reasonCode, incident.subjectType ?? "", incident.subjectId ?? ""].join("\u0000")).digest("hex").slice(0, 32);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The administrator notification for RECURRING incidents
// ---------------------------------------------------------------------------------------------------------------------------------

/** An incident counts as RECURRING once it has happened more than once; a single occurrence is recorded but does not interrupt anyone. */
export const RECURRENCE_THRESHOLD = 2;

/** At most one notification evaluation per incident per window: a busy public page cannot flood administrators or the database. A technical bound. */
export const NOTIFY_WINDOW_SECONDS = 60 * 60;

export const incidentNotificationKey = (kind: OperationalIncidentKindName) => `operational-incident-recurring-${kind}`;

export interface RecurringIncidentSummary {
  id: string;
  occurrenceCount: number;
}

/** Identifies WHICH incidents are recurring: the notification is announced again only when this set grows (counts alone never re-announce). */
export function recurringSetFingerprint(incidents: readonly RecurringIncidentSummary[]): string {
  return createHash("sha256").update(incidents.map((i) => i.id).sort().join(",")).digest("hex").slice(0, 32);
}

/** Counts only: no ids, no reason codes beyond the kind's own label, nothing from the data. */
export function buildIncidentNotificationText(kind: OperationalIncidentKindName, incidents: readonly RecurringIncidentSummary[]): { title: string; body: string } {
  const total = incidents.reduce((sum, i) => sum + i.occurrenceCount, 0);
  const problems = incidents.length === 1 ? "1 distinct problem is" : `${incidents.length} distinct problems are`;
  return {
    title: "An operational problem keeps recurring",
    body: `${OPERATIONAL_INCIDENT_KINDS[kind].label}: ${problems} open, with ${total} occurrences when this was last updated. ${OPERATIONAL_INCIDENT_KINDS[kind].meaning} Open Studio → Health for the live counts, and mark each one resolved once it has been looked at.`,
  };
}
