// Operator script (launch readiness): the anonymous post-deploy smoke checks of docs/deployment-readiness-gate.md §3 and §4.
//
//   npm run ops:smoke -- --base-url https://staging.example [--expected-origin https://www.example] [--json]
//
// READ-ONLY: GET requests to public URLs with no credentials and no cookies. Nothing is written to the site or the database, and nothing is triggered (no sync, no email).
// Run it against staging, against a pre-promotion URL, and again straight after cut-over; keep the output as the evidence the gate asks for.
// Exit codes: 0 all checks passed, 2 at least one failed, 4 bad usage.
import { runSmokeChecks, summariseSmoke, type SmokeFetch } from "../modules/ops/smokeChecks";

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<number> {
  const baseUrl = flag("--base-url");
  if (!baseUrl || !/^https?:\/\//.test(baseUrl)) {
    console.error("REFUSED: pass --base-url http(s)://host (the deployment to check).");
    return 4;
  }
  const fetchFn: SmokeFetch = async (url) => {
    const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(30_000), headers: { "user-agent": "music-madras-smoke/1" } });
    return { status: res.status, headers: res.headers, text: () => res.text() };
  };
  const checks = await runSmokeChecks({ baseUrl, expectedOrigin: flag("--expected-origin"), fetchFn });
  const summary = summariseSmoke(checks);
  if (process.argv.includes("--json")) console.log(JSON.stringify({ baseUrl, at: new Date().toISOString(), ...summary, checks }, null, 2));
  else {
    console.log(`Smoke test of ${baseUrl} at ${new Date().toISOString()}`);
    for (const c of checks) console.log(`  ${c.ok ? "PASS" : "FAIL"}  ${c.name}  [${c.detail}]`);
    console.log(summary.ok ? `RESULT: all ${summary.passed} checks passed.` : `RESULT: ${summary.failed} check(s) FAILED. Do not promote.`);
  }
  return summary.ok ? 0 : 2;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(`FAILED: ${err instanceof Error ? err.name : "unknown error"}`);
    process.exit(2);
  }
);
