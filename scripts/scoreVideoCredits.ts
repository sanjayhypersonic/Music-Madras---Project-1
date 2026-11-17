// Credits extraction, Phase B0: score credit proposals against the editor's verified reference records. LOCAL ONLY: no database, no network.
//
//   npm run ai:video-credits-score -- --proposals reports/video-credits/proposals-v2-....json [more proposals files] [--reference <file>] [--export <file>]
//
// For every video in the reference (default tests/fixtures/videoCreditsReference.json), the NEWEST proposals file (by the timestamp in its name)
// that contains the video is used. Each proposals file is checked against the export written at the same moment (same timestamp, same folder;
// or --export with a single proposals file) by the same validators the checker uses, and only ACCEPTED proposals are scored. Prints per video
// MATCHED / MISSED / MISSED-EDITOR / CONTRADICTS / NOT-IN-REFERENCE, then recall and precision. Prints names and titles, never a description.
// Writes nothing. Exit codes: 0 done, 2 failed, 4 refused.

import { existsSync, readdirSync, readFileSync } from "fs";
import path from "path";
import { validateVideoCreditsOutput } from "../modules/ai/structuredOutput/validateVideoCreditsOutput";
import { parseExportFile } from "../modules/jobs/videoCreditsCheck";
import type { ExportedVideo } from "../modules/jobs/videoCreditsExport";
import { isPathInside } from "../modules/jobs/videoCreditsRunner";
import {
  fileTimestamp,
  formatSummary,
  formatVideoScore,
  pairedExport,
  parseReference,
  parseScoreArgs,
  proposedFacts,
  scoreVideo,
  summariseScores,
  type VideoScore,
} from "../modules/jobs/videoCreditsScore";

const ROOT = path.resolve(__dirname, "..");
const EXIT = { SUCCEEDED: 0, FAILED: 2, REFUSED: 4 } as const;

function refuse(message: string): number {
  console.error(`REFUSED: ${message}`);
  return EXIT.REFUSED;
}

const readJson = (file: string): unknown => JSON.parse(readFileSync(file, "utf8"));

interface Batch {
  proposalsName: string;
  timestamp: string;
  proposals: Map<string, Record<string, unknown>>;
  videos: Map<string, ExportedVideo>;
}

function main(): number {
  const parsed = parseScoreArgs(process.argv.slice(2));
  if (!parsed.ok) return refuse(parsed.error);
  const { args } = parsed;

  for (const p of [...args.proposals, args.reference, ...(args.exportFile ? [args.exportFile] : [])]) {
    if (!isPathInside(ROOT, p)) return refuse(`${p} must be inside this repository.`);
    if (!existsSync(path.resolve(ROOT, p))) return refuse(`${p} does not exist.`);
  }

  const reference = parseReference(readJson(path.resolve(ROOT, args.reference)));
  if (!reference.ok) return refuse(`the reference file is not usable: ${reference.problems.slice(0, 3).join(" ")}`);

  const batches: Batch[] = [];
  for (const p of args.proposals) {
    const abs = path.resolve(ROOT, p);
    const name = path.basename(abs);
    const exportAbs = args.exportFile ? path.resolve(ROOT, args.exportFile) : (() => {
      const found = pairedExport(name, readdirSync(path.dirname(abs)));
      return found ? path.join(path.dirname(abs), found) : null;
    })();
    if (!exportAbs) return refuse(`no export with the same timestamp as ${name} was found next to it; pass --export with a single proposals file.`);
    const exported = parseExportFile(readJson(exportAbs));
    if (!exported.ok) return refuse(`the export for ${name} is not usable.`);
    const raw = readJson(abs);
    if (!Array.isArray(raw)) return refuse(`${name} is not a JSON array.`);
    const proposals = new Map<string, Record<string, unknown>>();
    for (const item of raw) {
      if (typeof item === "object" && item !== null && typeof (item as Record<string, unknown>).youtubeVideoId === "string" && !proposals.has((item as Record<string, string>).youtubeVideoId)) {
        proposals.set((item as Record<string, string>).youtubeVideoId, item as Record<string, unknown>);
      }
    }
    batches.push({ proposalsName: name, timestamp: fileTimestamp(name) ?? "", proposals, videos: new Map(exported.videos.map((v) => [v.youtubeVideoId, v])) });
  }
  batches.sort((a, b) => b.timestamp.localeCompare(a.timestamp)); // newest first

  console.log("Video credits score — accepted proposals against the editor's reference (no database, no network).");
  console.log(`  Reference: ${args.reference} (${reference.videos.length} videos)`);
  console.log(`  Proposals: ${batches.map((b) => b.proposalsName).join(", ")}`);
  console.log("");

  const scores: VideoScore[] = [];
  for (const ref of reference.videos) {
    const batch = batches.find((b) => b.proposals.has(ref.youtubeVideoId) && b.videos.has(ref.youtubeVideoId));
    if (!batch) {
      const score = scoreVideo(ref, []);
      scores.push(score);
      for (const line of formatVideoScore(score, null, null)) console.log(line);
      continue;
    }
    const video = batch.videos.get(ref.youtubeVideoId) as ExportedVideo;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { youtubeVideoId: _id, ...output } = batch.proposals.get(ref.youtubeVideoId) as Record<string, unknown>;
    const checked = validateVideoCreditsOutput(output, video);
    const score = scoreVideo(ref, checked.ok ? proposedFacts(checked) : []);
    scores.push(score);
    for (const line of formatVideoScore(score, video.title, batch.proposalsName)) console.log(line);
    if (!checked.ok) console.log(`  (the proposal is malformed: ${checked.problems.length} problem(s); nothing from it was scored)`);
    else if (checked.rejected.length > 0) console.log(`  (${checked.rejected.length} proposed credit(s) were rejected by the checker and are not scored)`);
    console.log("");
  }

  for (const line of formatSummary(summariseScores(scores))) console.log(line);
  return EXIT.SUCCEEDED;
}

try {
  process.exitCode = main();
} catch (error) {
  console.error(`FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = EXIT.FAILED;
}
