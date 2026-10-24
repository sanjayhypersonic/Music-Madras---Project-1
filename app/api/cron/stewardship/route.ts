import { authoriseCronRequest } from "../../../../modules/jobs/cronAuth";
import { runStewardshipJob } from "../../../../modules/jobs/stewardshipJob";
import { describeError } from "../../../../modules/jobs/scrubError";
import { sendOperatorAlert } from "../../../../modules/ops/operatorAlert";

// Phase 6K fix (F7), lifecycle hardening (F10) — the secured, hosting-neutral entry point for scheduled maintenance: lifecycle invariants, metadata
// review, unlisted-video review, live playlist-page checks, and delivery of queued notification emails. Any scheduler may call it (GET or POST) with
// `Authorization: Bearer <CRON_SECRET>`; see docs/runbooks/scheduled-maintenance.md. Without a sufficiently long CRON_SECRET the endpoint is disabled
// (503) and runs nothing. It is excluded from crawling (robots.ts disallows /api), is never cached, and returns counts only.
//
// What the response means:
//   200 {ok:true,  ran:true}                      every step succeeded.
//   200 {ok:true,  ran:false, skipped:"ALREADY_RUNNING"}   another invocation holds the lease; nothing was done, and nothing is wrong.
//   500 {ok:false, ran:true, status:"PARTIAL"|"FAILED"}    at least one step did not succeed; the run is recorded (Studio → Health) and the next run retries.
//   500 {ok:false, ran:false}                     the run could not even be recorded (a database problem).
// A completed request is never reported as success unless every step succeeded.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// A run may keep starting sweep batches for 40 seconds and then still sends email (docs/runbooks/scheduled-maintenance.md "Duration"), so the platform must allow at
// least a minute. Hosts that honour this setting (Vercel does) get it from here; any other host must be configured to allow the same.
export const maxDuration = 60;

const NO_STORE = { "Cache-Control": "no-store" };

async function handle(request: Request): Promise<Response> {
  const auth = authoriseCronRequest(request.headers.get("authorization"));
  if (!auth.ok) {
    return Response.json({ error: auth.status === 503 ? "Scheduled maintenance is not configured." : "Unauthorized." }, { status: auth.status, headers: NO_STORE });
  }
  try {
    const result = await runStewardshipJob({ trigger: "HTTP" });
    // A run that did not fully succeed also tells the operator (once per cooldown per instance); the scheduler's own alert on non-2xx remains the first line.
    if (!result.ok) await sendOperatorAlert({ kind: "MAINTENANCE_FAILED", code: "STEWARDSHIP_NOT_SUCCEEDED", route: "/api/cron/stewardship", dedupeKey: "maintenance:not-succeeded" });
    return Response.json(result, { status: result.ok ? 200 : 500, headers: NO_STORE });
  } catch (err) {
    await sendOperatorAlert({ kind: "MAINTENANCE_FAILED", code: "STEWARDSHIP_NOT_RECORDED", route: "/api/cron/stewardship", dedupeKey: "maintenance:not-recorded" });
    // The kind of failure only: never the message, which could name internals.
    return Response.json({ ok: false, ran: false, error: "The maintenance run could not be recorded.", kind: describeError(err).kind }, { status: 500, headers: NO_STORE });
  }
}

export const GET = handle;
export const POST = handle;
