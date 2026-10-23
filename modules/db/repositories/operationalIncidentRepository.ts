import { writeAuditLog } from "../../audit/writeAuditLog";
import { prisma } from "../client";
import {
  NOTIFY_WINDOW_SECONDS,
  OPERATIONAL_INCIDENT_KINDS,
  RECURRENCE_THRESHOLD,
  buildIncidentNotificationText,
  cleanIncident,
  incidentFingerprint,
  incidentNotificationKey,
  recurringSetFingerprint,
  type IncidentInput,
  type OperationalIncidentKindName,
} from "../../mmke/operations/operationalIncidents";
import { raiseNotification, refreshOpenNotificationText, resolveNotification } from "./studioNotificationRepository";

// Operational incidents (project register R-15, first slice) — the durable, deduplicated record of integrity problems the platform detects and works
// around, and the administrator notification when one RECURS.
//
//   recordOperationalIncident        atomic upsert on (kind, fingerprint): the first occurrence inserts, every repeat counts and re-timestamps the SAME
//                                    row, a resolved incident that recurs is REOPENED. One statement, so concurrent page requests cannot create duplicates
//                                    or lose a count. What may be stored is decided in modules/mmke/operations/operationalIncidents.ts (no free text).
//   recordOperationalIncidentSafely  the same, for callers that must never fail because of it (a public page): it swallows and logs its own failure.
//   notification                     ONE Studio notification per incident KIND (not per incident or occurrence), raised through the existing notification
//                                    machinery (raiseNotification: audience SETTINGS_MANAGE, optional email channel unchanged). It is announced again only when
//                                    the SET of recurring incidents grows or after it was resolved; counts that merely rise update its text silently.
//                                    A per-incident claim (lastNotifiedAt) limits evaluation to once per window however busy the page is.
//
// KNOWN LIMITATION (documented, not hidden): the notification is evaluated when an incident recurs and again when an administrator resolves one. If the
// process dies between claiming the evaluation and raising the notification, the next evaluation happens at the next recurrence after the window; there is
// no scheduler-driven retry in this slice. Email delivery is the existing at-least-once channel and still needs the scheduler (scheduled-maintenance runbook).

export interface RecordOutcome {
  id: string;
  /** True when this call created the incident. */
  created: boolean;
  occurrenceCount: number;
  /** True when this call claimed the right to evaluate the notification (and did so). */
  notificationEvaluated: boolean;
}

interface UpsertRow {
  id: string;
  inserted: boolean;
  occurrenceCount: number;
}

export async function recordOperationalIncident(input: IncidentInput, now: Date = new Date()): Promise<RecordOutcome> {
  const incident = cleanIncident(input);
  const fingerprint = incidentFingerprint(incident);

  const rows = await prisma.$queryRaw<UpsertRow[]>`
    insert into operational_incidents ("id", "kind", "fingerprint", "status", "reasonCode", "subjectType", "subjectId", "occurrenceCount", "firstSeenAt", "lastSeenAt")
    values (gen_random_uuid()::text, ${incident.kind}::"OperationalIncidentKind", ${fingerprint}, 'OPEN'::"OperationalIncidentStatus", ${incident.reasonCode}, ${incident.subjectType}, ${incident.subjectId}, 1, ${now}, ${now})
    on conflict ("kind", "fingerprint") do update set
      "occurrenceCount" = operational_incidents."occurrenceCount" + 1,
      "lastSeenAt" = ${now},
      "lastNotifiedAt" = case when operational_incidents."status" = 'RESOLVED' then null else operational_incidents."lastNotifiedAt" end,
      "status" = 'OPEN'::"OperationalIncidentStatus",
      "resolvedAt" = null,
      "resolvedById" = null,
      "resolvedReason" = null
    returning "id", (xmax = 0) as "inserted", "occurrenceCount"`;
  const row = rows[0];
  const outcome: RecordOutcome = { id: row.id, created: row.inserted, occurrenceCount: Number(row.occurrenceCount), notificationEvaluated: false };

  if (outcome.occurrenceCount >= RECURRENCE_THRESHOLD) {
    // The claim: exactly one caller per window wins, so a busy page evaluates the notification once, not once per request.
    const cutoff = new Date(now.getTime() - NOTIFY_WINDOW_SECONDS * 1000);
    const claimed = await prisma.$executeRaw`
      update operational_incidents set "lastNotifiedAt" = ${now}
      where "id" = ${row.id} and "status" = 'OPEN'::"OperationalIncidentStatus" and "occurrenceCount" >= ${RECURRENCE_THRESHOLD}
        and ("lastNotifiedAt" is null or "lastNotifiedAt" < ${cutoff})`;
    if (claimed === 1) {
      try {
        await syncIncidentNotification(incident.kind);
        outcome.notificationEvaluated = true;
      } catch (err) {
        // The notification could not be raised: hand the claim back so the NEXT recurrence tries again instead of waiting out the window. The incident
        // itself is already recorded; failing here must not lose it. (If even this release fails, the retry waits for the window: see the limitation.)
        console.error("Operational incident notification could not be raised:", err instanceof Error ? err.name : "unknown error");
        await prisma.$executeRaw`update operational_incidents set "lastNotifiedAt" = null where "id" = ${row.id}`.catch(() => undefined);
      }
    }
  }
  return outcome;
}

/** For callers that must not fail because of this (the public Organisation page). Never throws; failure is logged by error class only. */
export async function recordOperationalIncidentSafely(input: IncidentInput, now: Date = new Date()): Promise<RecordOutcome | null> {
  try {
    return await recordOperationalIncident(input, now);
  } catch (err) {
    console.error("Operational incident could not be recorded:", err instanceof Error ? err.name : "unknown error");
    return null;
  }
}

/**
 * Brings the kind's single notification in line with the incidents that are open AND recurring: raise it (announced only when the set of recurring
 * incidents has changed), keep its text current without announcing, or resolve it when nothing recurring is open any more.
 */
export async function syncIncidentNotification(kind: OperationalIncidentKindName): Promise<"RAISED" | "REFRESHED" | "RESOLVED" | "NONE"> {
  const recurring = await prisma.operationalIncident.findMany({
    where: { kind, status: "OPEN", occurrenceCount: { gte: RECURRENCE_THRESHOLD } },
    select: { id: true, occurrenceCount: true },
    orderBy: { id: "asc" },
  });
  const key = incidentNotificationKey(kind);
  if (recurring.length === 0) return (await resolveNotification(key, "No recurring incident of this kind is open any more.")) ? "RESOLVED" : "NONE";

  const text = buildIncidentNotificationText(kind, recurring);
  const raised = await raiseNotification({ kind: "OPERATIONAL_INCIDENT_RECURRING", dedupeKey: key, title: text.title, body: text.body, href: "/studio/health", contentFingerprint: recurringSetFingerprint(recurring) });
  if (raised.outcome === "UNCHANGED") return (await refreshOpenNotificationText(key, text)) ? "REFRESHED" : "NONE";
  return "RAISED";
}

// ---------------------------------------------------------------------------------------------------------------------------------
// What Studio -> Health shows (administrators only: the page and the action check SETTINGS_MANAGE)
// ---------------------------------------------------------------------------------------------------------------------------------

export interface IncidentView {
  id: string;
  kind: OperationalIncidentKindName;
  kindLabel: string;
  reasonCode: string;
  subjectType: string | null;
  subjectId: string | null;
  occurrenceCount: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
  recurring: boolean;
}

export interface IncidentOverview {
  open: IncidentView[];
  openCount: number;
  resolvedCount: number;
}

export async function loadIncidentOverview(limit = 100): Promise<IncidentOverview> {
  const [open, openCount, resolvedCount] = await Promise.all([
    prisma.operationalIncident.findMany({ where: { status: "OPEN" }, orderBy: [{ lastSeenAt: "desc" }, { id: "asc" }], take: limit }),
    prisma.operationalIncident.count({ where: { status: "OPEN" } }),
    prisma.operationalIncident.count({ where: { status: "RESOLVED" } }),
  ]);
  return {
    open: open.map((i) => ({
      id: i.id,
      kind: i.kind,
      kindLabel: OPERATIONAL_INCIDENT_KINDS[i.kind].label,
      reasonCode: i.reasonCode,
      subjectType: i.subjectType,
      subjectId: i.subjectId,
      occurrenceCount: i.occurrenceCount,
      firstSeenAt: i.firstSeenAt,
      lastSeenAt: i.lastSeenAt,
      recurring: i.occurrenceCount >= RECURRENCE_THRESHOLD,
    })),
    openCount,
    resolvedCount,
  };
}

/**
 * An administrator marks an incident as looked at. The incident stays on record (resolved, with who and when); if the problem happens again it is
 * REOPENED with its count continuing and the administrators are notified afresh. Returns false when there was nothing open to resolve.
 */
export async function resolveIncident(input: { id: string; actorId: string }, now: Date = new Date()): Promise<boolean> {
  const moved = await prisma.operationalIncident.updateMany({
    where: { id: input.id, status: "OPEN" },
    data: { status: "RESOLVED", resolvedAt: now, resolvedById: input.actorId, resolvedReason: "Marked resolved by an administrator." },
  });
  if (moved.count !== 1) return false;
  const incident = await prisma.operationalIncident.findUnique({ where: { id: input.id }, select: { kind: true, reasonCode: true, subjectType: true } });
  await writeAuditLog({ actorId: input.actorId, action: "OPERATIONAL_INCIDENT_RESOLVED", entityType: "OperationalIncident", entityId: input.id, afterSnapshot: { kind: incident?.kind ?? null, reasonCode: incident?.reasonCode ?? null } });
  if (incident) await syncIncidentNotification(incident.kind);
  return true;
}
