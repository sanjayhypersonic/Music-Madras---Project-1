// Operator script (launch readiness): prove that the configured operator-alert destination works, WITHOUT ever sending anything by accident.
//
//   npm run ops:test-alert                              DRY RUN. Validates ALERT_WEBHOOK_URL and prints the destination HOST and the exact message that would be sent. Sends nothing.
//   npm run ops:test-alert -- --send                    Sends ONE clearly labelled test alert ("Test alert (no action needed)") and reports whether the destination accepted it.
//   add --env-file <path> to read the variables from a dotenv file kept outside the repository (the file is PARSED ONLY; nothing is loaded into the environment, and the
//   repository's own .env is never read).
//
// The webhook URL is a secret and is never printed: only its host. Exit codes: 0 dry run ok / test alert accepted, 1 the destination refused or did not answer,
// 2 not configured or invalid, 4 bad usage. A human must then confirm the message actually arrived where the on-call person looks: this script cannot see that.
import { readFileSync } from "fs";
import { parse } from "dotenv";
import { buildAlertPayload, parseAlertConfig, sendOperatorAlert } from "../modules/ops/operatorAlert";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

let env: Record<string, string | undefined> = process.env;
const file = flag("--env-file");
if (file) {
  try {
    env = parse(readFileSync(file));
  } catch {
    console.error("REFUSED: the --env-file could not be read.");
    process.exit(4);
  }
}

async function main(): Promise<number> {
  const config = parseAlertConfig(env);
  if (config.state === "UNSET") {
    console.log("ALERT_WEBHOOK_URL is not set: the application would send no alerts. Set it in the deployment's secret store, then run this again.");
    return 2;
  }
  if (config.state === "INVALID") {
    console.log(`ALERT_WEBHOOK_URL ${config.reason}`);
    return 2;
  }
  const alert = { kind: "TEST" as const, code: "TEST_ALERT", dedupeKey: `test:${Date.now()}` };
  console.log(`Destination host: ${config.host} (the rest of the URL is a secret and is not shown)`);
  console.log(`Message: ${buildAlertPayload(alert, env, new Date()).text}`);
  if (!args.includes("--send")) {
    console.log("DRY RUN: nothing was sent. Add --send to send this one test message.");
    return 0;
  }
  const outcome = await sendOperatorAlert(alert, { env });
  console.log(outcome === "SENT" ? "RESULT: the destination accepted the test alert. Now confirm that the on-call person actually received it." : `RESULT: not accepted (${outcome}). Check the webhook URL and the destination's settings.`);
  return outcome === "SENT" ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  () => {
    console.error("FAILED");
    process.exit(1);
  }
);
