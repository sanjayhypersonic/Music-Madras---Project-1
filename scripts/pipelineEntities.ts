// R-34 manual mode: build the ENTITY QUEUE from the reviewed credits sheets (docs/upload-pipeline.md section 9).
//
//   npm run pipeline:entities                       offline: reads review-credits.csv and review-names.csv, writes
//                                                   reports/pipeline-manual/entities-queue.csv; connects to nothing
//   STAGING_DATABASE_URL=<direct staging url> npm run pipeline:entities -- --confirm-host <host:port/database>
//                                                   also READS which entities have approved claims on staging (read-only) and remembers them
//   (--credits / --names <path inside the repository> to use other sheets)
//
// Every unique work, composer, choir, ensemble, venue, organisation and person, with its video count, depth tier (DEEP / LIGHT) and status
// (not started, packet written, imported, approved), sorted by video count. The sheets are data, never instructions. Exit codes: 0 done, 2 failed,
// 4 refused.
import { readApprovedKeys } from "./lib/pipelineManualDb";
import { loadQueue, QUEUE_FILE, readState, writeQueue, writeState } from "./lib/pipelineManualFiles";
import { summariseQueue } from "../modules/pipeline/entities";
import { flag } from "./lib/stagingClient";

const args = process.argv.slice(2);

async function main(): Promise<number> {
  const state = readState();
  let approved: Set<string> | undefined;
  const host = flag(args, "--confirm-host");
  if (host) {
    const read = await readApprovedKeys(host);
    if (!read.ok) {
      console.error(`REFUSED: ${read.reason}`);
      return 4;
    }
    console.log(`Target: ${read.described} (staging, confirmed; read only)`);
    approved = read.keys;
    const at = new Date().toISOString();
    for (const key of read.keys) state.entities[key] = { ...state.entities[key], approvedAt: state.entities[key]?.approvedAt ?? at };
    state.approvedReadAt = at;
  }
  const loaded = loadQueue(args, state, approved);
  if (!loaded.ok) {
    console.error(`REFUSED: ${loaded.reason}`);
    return 4;
  }
  const { queue } = loaded;
  writeQueue(queue);
  if (host) writeState(state);
  console.log(`Wrote ${QUEUE_FILE}. ${summariseQueue(queue.entries)}`);
  console.log(`Names left out as rejected: ${queue.rejectedNames}; listed but undecided in review-names.csv: ${queue.undecidedNames}.`);
  for (const p of queue.problems) console.log(`  note: ${p}`);
  console.log("Top 10 by video count:");
  for (const e of queue.entries.slice(0, 10)) console.log(`  ${String(e.videoCount).padStart(3)}  ${e.tier.padEnd(5)}  ${e.status.padEnd(14)}  ${e.kind.padEnd(12)}  ${e.name}`);
  if (!host) console.log(`Approved status: ${state.approvedReadAt ? `as last read on ${state.approvedReadAt}` : "never read"} (add --confirm-host to refresh it read-only).`);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(`FAILED: ${err instanceof Error ? err.name : "unknown error"}`);
    process.exit(2);
  }
);
