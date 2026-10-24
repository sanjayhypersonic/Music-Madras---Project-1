import { EXPECTED_MIGRATIONS } from "../../../modules/config/expectedMigrations";
import { loadReadinessFacts } from "../../../modules/db/repositories/readinessRepository";
import { assessReadiness, readinessLogLine } from "../../../modules/ops/readiness";

// READINESS probe (launch readiness; docs/deployment-readiness-gate.md §3-§4). /api/health only says the process is up; this says the deployment can serve real
// traffic: the database answers AND it has applied every migration this release was built for (modules/config/expectedMigrations.ts). A host's readiness check,
// an uptime monitor and the post-deploy smoke test (npm run ops:smoke) should probe BOTH routes.
//
//   200 {"status":"ready"}       serve traffic.
//   503 {"status":"not-ready"}   do not. The reason is a CODE written to the server log as one JSON line ({"event":"readiness",...}); it is never in the response,
//                                so an unauthenticated caller learns nothing about the database or the schema.
//
// Never cached by the response, and the database check is memoised for a few seconds per instance so that polling (or a hostile caller) cannot become load on the
// database. A "not ready" answer is remembered for a shorter time than a "ready" one so recovery is noticed quickly.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const READY_TTL_MS = 5_000;
const NOT_READY_TTL_MS = 1_000;
const NO_STORE = { "Cache-Control": "no-store" };

let memo: { at: number; ready: boolean } | null = null;

export async function GET() {
  const now = Date.now();
  if (memo && now - memo.at < (memo.ready ? READY_TTL_MS : NOT_READY_TTL_MS)) {
    return Response.json({ status: memo.ready ? "ready" : "not-ready" }, { status: memo.ready ? 200 : 503, headers: NO_STORE });
  }
  const result = assessReadiness(EXPECTED_MIGRATIONS, await loadReadinessFacts());
  memo = { at: now, ready: result.ready };
  if (!result.ready) console.error(readinessLogLine(result));
  return Response.json({ status: result.ready ? "ready" : "not-ready" }, { status: result.ready ? 200 : 503, headers: NO_STORE });
}
