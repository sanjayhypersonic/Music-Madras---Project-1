// R-34 manual mode: write PACKETS for the owner's own Claude account (docs/upload-pipeline.md section 9).
//
//   npm run pipeline:packet -- --batch 5 [--tier DEEP|LIGHT] [--rewrite]
//        offline: research packets for the next 5 entities of the queue that have none yet (highest video count first), under
//        reports/pipeline-manual/packets/; marks them "packet written"; resumable (run it again for the next 5). --rewrite also re-picks entities
//        whose packet is written but not yet approved.
//   STAGING_DATABASE_URL=<direct staging url> npm run pipeline:packet -- --drafts --batch 3 --confirm-host <host:port/database>
//        READ ONLY: draft packets for bundles awaiting approval (their credits and APPROVED claims; the page-prose contract).
//   STAGING_DATABASE_URL=<direct staging url> npm run pipeline:packet -- --extract <youtubeVideoId> --confirm-host <host:port/database>
//        READ ONLY: an extraction packet for one QUEUED video (the video-credits-v2 contract).
// Packets carry YouTube text and sheet text as marked DATA. Nothing is written to any database. Exit codes: 0 done, 2 failed, 4 refused.
import { selectForPackets, packetFileName, PACKETS_DIR, renderBatchIndex, renderExtractionPacket, renderResearchPacket, renderVideoDraftPacket } from "../modules/pipeline/packets";
import { proseContextForBundle } from "../modules/pipeline/manualImport";
import { summariseQueue, type DepthTier } from "../modules/pipeline/entities";
import { connectStaging } from "./lib/pipelineManualDb";
import { loadQueue, readState, writeQueue, writeReport, writeState } from "./lib/pipelineManualFiles";
import { flag } from "./lib/stagingClient";

const args = process.argv.slice(2);
const refuse = (reason: string) => {
  console.error(`REFUSED: ${reason}`);
  return 4;
};

async function main(): Promise<number> {
  const now = new Date();
  const generatedAt = now.toISOString();
  const stamp = generatedAt.replace(/[:.]/g, "-");
  const batchRaw = flag(args, "--batch");
  const batch = batchRaw === undefined ? 5 : Number(batchRaw);
  if (!Number.isInteger(batch) || batch < 1 || batch > 50) return refuse("--batch must be a whole number from 1 to 50");

  if (args.includes("--drafts") || args.includes("--extract")) {
    const host = flag(args, "--confirm-host");
    if (!host) return refuse("--drafts and --extract read the bundle or video from staging: add --confirm-host with STAGING_DATABASE_URL (read only)");
    const c = await connectStaging(host);
    if (!c.ok) return refuse(c.reason);
    console.log(`Target: ${c.described} (staging, confirmed; read only)`);
    try {
      if (args.includes("--extract")) {
        const id = flag(args, "--extract") ?? "";
        const v = await c.repo.findPipelineVideoForImport(id);
        if (!v) return refuse(`${id} has no pipeline row: let a run queue it first (npm run pipeline:run -- --only ${id} --confirm-host <HOST> --execute)`);
        if (v.status !== "QUEUED") return refuse(`${id} is ${v.status}, not QUEUED: its extraction is already in`);
        const file = `extract-${id}.md`;
        writeReport(`${PACKETS_DIR}/${file}`, renderExtractionPacket({ youtubeVideoId: id, ...v }, { file, generatedAt }));
        console.log(`Wrote ${PACKETS_DIR}/${file}.`);
        return 0;
      }
      const bundles = (await c.repo.listPipelineBundles({ status: "AWAITING_APPROVAL" })).slice(0, batch);
      for (const b of bundles) {
        const bundle = await c.repo.loadBundleForApproval(b.id);
        if (!bundle) continue;
        const ctx = proseContextForBundle(bundle);
        const file = `draft-${bundle.youtubeVideoId}.md`;
        writeReport(`${PACKETS_DIR}/${file}`, renderVideoDraftPacket(ctx, { file, generatedAt, youtubeTitle: bundle.youtubeTitle }));
        console.log(`Wrote ${PACKETS_DIR}/${file} (${ctx.credits.length} credit(s), ${ctx.claims.filter((x) => x.status === "ACCEPTED").length} approved claim(s)).`);
      }
      if (bundles.length === 0) console.log("No bundle is awaiting approval.");
      return 0;
    } finally {
      await c.disconnect();
    }
  }

  const tierRaw = flag(args, "--tier");
  if (tierRaw !== undefined && tierRaw !== "DEEP" && tierRaw !== "LIGHT") return refuse("--tier must be DEEP or LIGHT");
  const state = readState();
  const loaded = loadQueue(args, state);
  if (!loaded.ok) return refuse(loaded.reason);
  const picked = selectForPackets(loaded.queue.entries, { batch, tier: tierRaw as DepthTier | undefined, rewrite: args.includes("--rewrite") });
  if (picked.length === 0) {
    console.log(`Nothing to do: no ${tierRaw ? `${tierRaw} ` : ""}entity is waiting for a packet. ${summariseQueue(loaded.queue.entries)}`);
    return 0;
  }
  let seq = Object.values(state.entities).filter((e) => e.packetFile).length;
  const rows: Array<{ file: string; entry: (typeof picked)[number] }> = [];
  for (const entry of picked) {
    const file = state.entities[entry.entityKey]?.packetFile ?? packetFileName(++seq, entry);
    writeReport(`${PACKETS_DIR}/${file}`, renderResearchPacket(entry, { file, generatedAt }));
    state.entities[entry.entityKey] = { ...state.entities[entry.entityKey], packetFile: file, packetWrittenAt: generatedAt };
    rows.push({ file, entry });
    console.log(`  ${file}  ${entry.tier}  ${entry.videoCount} video(s)  ${entry.name}`);
  }
  writeReport(`${PACKETS_DIR}/batch-${stamp}.md`, renderBatchIndex(rows, generatedAt));
  writeState(state);
  const after = loadQueue(args, state);
  if (after.ok) writeQueue(after.queue);
  console.log(`Wrote ${rows.length} packet(s) and ${PACKETS_DIR}/batch-${stamp}.md; the queue now reads: ${after.ok ? summariseQueue(after.queue.entries) : "(not rewritten)"}`);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(`FAILED: ${err instanceof Error ? err.name : "unknown error"}`);
    process.exit(2);
  }
);
