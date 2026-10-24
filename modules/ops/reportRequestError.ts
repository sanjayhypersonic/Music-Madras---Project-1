import { recordOperationalIncidentSafely } from "../db/repositories/operationalIncidentRepository";
import { createWriteLimiter, describeRequestError, routeSubjectId, shouldReportRequestError, type RequestErrorContext } from "./requestErrorReport";

// The framework's error hook (instrumentation.ts -> onRequestError) lands here. Two outputs, both from the SAFE description only (requestErrorReport.ts):
//   1. ONE structured JSON line on stderr, {event:"unhandled_server_error", errorName, reasonCode, routeType, route, digest}: what a host's log drain, an alert rule
//      or an on-call person searches for. Always written.
//   2. A deduplicated operational incident (kind UNHANDLED_SERVER_ERROR; Studio -> Health; an administrator is notified when it recurs). Best-effort and bounded:
//      recordOperationalIncidentSafely never throws, and a per-instance limiter caps how many writes an error storm can cause.
// It must never throw (the hook runs on the error path) and it never includes the message, stack, URL, headers or request data.

const allowWrite = createWriteLimiter(30, 60_000);

export async function reportRequestError(error: unknown, context: RequestErrorContext): Promise<void> {
  try {
    if (!shouldReportRequestError(error)) return;
    const safe = describeRequestError(error, context);
    console.error(JSON.stringify({ level: "error", ...safe }));
    if (!allowWrite()) return;
    const subjectId = routeSubjectId(context.routePath);
    await recordOperationalIncidentSafely({ kind: "UNHANDLED_SERVER_ERROR", reasonCode: safe.reasonCode, subject: subjectId ? { type: "Route", id: subjectId } : null });
  } catch {
    // The error hook must not raise a second error.
  }
}
