import { authoriseCronRequest } from "../../../../modules/jobs/cronAuth";
import { runPipelineJob } from "../../../../modules/jobs/pipelineJob";
import { describeError } from "../../../../modules/jobs/scrubError";
import { sendOperatorAlert } from "../../../../modules/ops/operatorAlert";

// R-34 — the upload-to-draft pipeline's scheduled entry point (docs/upload-pipeline.md). The same pattern and the same CRON_SECRET as
// /api/cron/stewardship: `Authorization: Bearer <CRON_SECRET>`, GET or POST; without a sufficiently long CRON_SECRET it is disabled (503). It is
// excluded from crawling (robots.ts disallows /api), never cached, and returns counts only (no video text, no AI output, no secrets).
//
// It does nothing unless PIPELINE_ENABLED=true, and stays a DRY RUN (no AI call, no sync, no writes but the run record) unless PIPELINE_DRY_RUN=false.
// It is NOT in vercel.json yet: scheduling it is a deliberate switch-on step (docs/upload-pipeline.md, "Switching it on").
//   200 {ok:true, ran:false, skipped:"DISABLED"|"ALREADY_RUNNING"}   nothing to do, nothing wrong
//   200 {ok:true, ran:true, ...}                                     the run completed (a cost-cap stop is a normal completion)
//   500 {ok:false, ...}                                              some videos failed a stage (they are retried next run), or the run failed

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// The sync plus a few videos' AI calls (each up to minutes with web search) need the platform's longest allowance; a run that is cut off resumes
// from its last saved stage next time.
export const maxDuration = 300;

const NO_STORE = { "Cache-Control": "no-store" };

async function handle(request: Request): Promise<Response> {
  const auth = authoriseCronRequest(request.headers.get("authorization"));
  if (!auth.ok) {
    return Response.json({ error: auth.status === 503 ? "Scheduled maintenance is not configured." : "Unauthorized." }, { status: auth.status, headers: NO_STORE });
  }
  try {
    const result = await runPipelineJob({ trigger: "HTTP" });
    if (!result.ok) await sendOperatorAlert({ kind: "MAINTENANCE_FAILED", code: "PIPELINE_PARTIAL", route: "/api/cron/pipeline", dedupeKey: "pipeline:partial" });
    return Response.json(result, { status: result.ok ? 200 : 500, headers: NO_STORE });
  } catch (err) {
    await sendOperatorAlert({ kind: "MAINTENANCE_FAILED", code: "PIPELINE_FAILED", route: "/api/cron/pipeline", dedupeKey: "pipeline:failed" });
    return Response.json({ ok: false, ran: false, error: "The pipeline run failed.", kind: describeError(err).kind }, { status: 500, headers: NO_STORE });
  }
}

export const GET = handle;
export const POST = handle;
