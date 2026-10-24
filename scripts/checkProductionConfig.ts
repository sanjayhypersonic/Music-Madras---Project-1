// Operator script (launch readiness): validate a deployment's environment BEFORE anything is deployed or started.
//
//   npm run ops:check-config                         checks the variables in the current shell environment (what a CI job or host build would see)
//   npm run ops:check-config -- --env-file path      checks a dotenv-format file instead (e.g. a staging file kept outside the repository). The file is PARSED ONLY:
//                                                    nothing is loaded into the environment, nothing is sent anywhere, and the repository's own .env is never read.
//
// It applies the runtime start-up rules (modules/config/productionConfig.ts) PLUS the deployment rules (modules/config/deploymentConfig.ts: direct connection string
// present, no test-named database, pooled vs direct, origins agree, SMTP URL valid). Output names variables and reasons ONLY; a value is never printed, so the output
// is safe to paste into a ticket. It opens no connection and makes no network call.
// Exit codes: 0 no problems (warnings may remain), 1 problems found, 4 bad usage.
import { readFileSync } from "fs";
import { parse } from "dotenv";
import { assessDeploymentConfig } from "../modules/config/deploymentConfig";

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const file = flag("--env-file");
let env: Record<string, string | undefined>;
if (file) {
  try {
    env = parse(readFileSync(file));
  } catch {
    console.error("REFUSED: the --env-file could not be read.");
    process.exit(4);
  }
} else {
  env = process.env;
}

const report = assessDeploymentConfig(env);
console.log(`Deployment configuration check (${file ? "env file" : "shell environment"}); values are never printed.`);
for (const p of report.problems) console.log(`  PROBLEM  ${p.variable}: ${p.problem}`);
for (const w of report.warnings) console.log(`  warning  ${w.variable}: ${w.problem}`);
console.log(report.problems.length === 0 ? `RESULT: no problems (${report.warnings.length} warning(s) to read).` : `RESULT: ${report.problems.length} problem(s). Fix them before deploying.`);
process.exit(report.problems.length === 0 ? 0 : 1);
