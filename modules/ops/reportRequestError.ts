import { recordOperationalIncidentSafely } from "../db/repositories/operationalIncidentRepository";
import { sendOperatorAlert } from "./operatorAlert";
import { createWriteLimiter, describeRequestError, routeSubjectId, shouldReportRequestError, type RequestErrorContext } from "./requestErrorReport";

// The framework's error hook (instrumentation.ts -> onRequestError) lands here. Two outputs, both from the SAFE description only (requestErrorReport.ts):
//   1. ONE structured JSON line on stderr, {event:"unhandled_server_error", errorName, reasonCode, routeType, route, digest}: what a host's log drain, an alert rule
//      or an on-call person searches for. Always written.
//   2. A deduplicated operational incident (kind UNHANDLED_SERVER_ERROR; Studio -> Health; an administrator is notified when it recurs). Best-effort and bounded:
//      recordOperationalIncidentSafely never throws, and a per-instance limiter caps how many writes an error storm can cause.
//   3. An operator alert (modules/ops/operatorAlert.ts) to ALERT_WEBHOOK_URL when one is configured: on the first occurrence, and when the incident cannot be recorded.
// It must never throw (the hook runs on the error path) and it never includes the message, stack, URL, headers or request data.

const allowWrite = createWriteLimiter(30, 60_000);

export async function reportRequestError(error: unknown, context: RequestErrorContext): Promise<void> {
  try {
    if (!shouldReportRequestError(error)) return;
    const safe = describeRequestError(error, context);
    console.error(JSON.stringify({ level: "error", ...safe }));
    const alert = { kind: "UNHANDLED_SERVER_ERROR" as const, code: safe.reasonCode, route: safe.route, dedupeKey: `error:${safe.reasonCode}:${safe.route ?? "-"}` };
    if (!allowWrite()) {
      await sendOperatorAlert(alert); // an error storm: the incident write is skipped, but a person still hears about it (once per cooldown per instance)
      return;
    }
    const subjectId = routeSubjectId(context.routePath);
    const recorded = await recordOperationalIncidentSafely({ kind: "UNHANDLED_SERVER_ERROR", reasonCode: safe.reasonCode, subject: subjectId ? { type: "Route", id: subjectId } : null });
    // Alert the operator the FIRST time this kind of error appears on this route (the incident row is the cross-instance memory), and whenever the incident cannot be
    // recorded at all (a database problem is exactly when nobody would otherwise be told). Repeats are counted on the incident, which alerts again when it recurs.
    if (recorded === null || recorded.created) await sendOperatorAlert(alert);
  } catch {
    // The error hook must not raise a second error.
  }
}
