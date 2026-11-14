// Operator script for the video-credits extraction, MILESTONE 1 (dry run only).
//
//   npm run ai:video-credits -- --videos tests/fixtures/realYouTubeVideos.json [--fake-responses <file>] [--model claude-opus-5-5] [--limit N] [--report <file>]
//
// What it does: reads a LOCAL JSON export of videos, prints the token and cost estimate for the chosen model, runs every eligible video (public,
// observed, with a description) through the video-credits-v1 checks using the deterministic FAKE provider (canned answers from --fake-responses,
// keyed by YouTube id; a video without one gets an empty answer), prints what was accepted and rejected, and writes one local JSON report.
//
// What it never does in this milestone: read or write any database, create catalogue records, call the real Anthropic API (--execute is refused),
// read environment files, or touch any path outside this repository. It imports no database module and no dotenv.
//
// Exit codes: 0 done, 2 failed, 4 refused (bad arguments, a path outside the repository, --execute).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { FakeAIProvider } from "../modules/ai/providers/fake/fakeAIProvider";
import { extractVideoCredits, type VideoCreditsOutcome, type VideoCreditsSource } from "../modules/ai/gateway/extractVideoCredits";
import { VIDEO_CREDITS_PROMPT_V1 } from "../modules/ai/prompts/videoCredits/videoCreditsPromptV1";
import {
  VIDEO_CREDITS_EXIT_CODES,
  buildVideoCreditsReport,
  defaultReportPath,
  estimateVideoCreditsCost,
  formatEstimate,
  formatOutcome,
  formatTotals,
  isPathInside,
  parseVideoCreditsRunnerArgs,
} from "../modules/jobs/videoCreditsRunner";

const ROOT = path.resolve(__dirname, "..");

function refuse(message: string): number {
  console.error(`REFUSED: ${message}`);
  return VIDEO_CREDITS_EXIT_CODES.REFUSED;
}

/** Resolves a user-given path against the repository root, refusing anything outside it. */
function insideRepo(candidate: string): string | null {
  return isPathInside(ROOT, candidate) ? path.resolve(ROOT, candidate) : null;
}

/** The fake provider's answer for a request: the canned output for that video, or an empty answer with a gap. */
function cannedResponder(responses: Record<string, unknown>) {
  return (request: { targetEntityId: string }) =>
    responses[request.targetEntityId] ?? {
      recordingKind: { value: "UNCLEAR", quote: null, field: null },
      credits: [],
      performanceDate: { value: null, quote: null, field: null },
      venueType: { value: null, quote: null, field: null },
      suggestedTitle: { value: null, quote: null, field: null },
      gaps: [{ missing: "all credits", reason: "The fake provider has no canned answer for this video." }],
    };
}

async function main(): Promise<number> {
  const parsed = parseVideoCreditsRunnerArgs(process.argv.slice(2));
  if (!parsed.ok) return refuse(parsed.error);
  const { args } = parsed;

  const videosPath = insideRepo(args.videosFile);
  if (!videosPath) return refuse("--videos must be a file inside this repository.");
  const responsesPath = args.fakeResponsesFile === null ? null : insideRepo(args.fakeResponsesFile);
  if (args.fakeResponsesFile !== null && !responsesPath) return refuse("--fake-responses must be a file inside this repository.");
  const generatedAt = new Date();
  const reportRelative = args.reportFile ?? defaultReportPath(generatedAt);
  const reportPath = insideRepo(reportRelative);
  if (!reportPath) return refuse("--report must be a path inside this repository.");
  if (!existsSync(videosPath)) return refuse(`the videos file ${args.videosFile} does not exist.`);
  if (responsesPath && !existsSync(responsesPath)) return refuse(`the fake responses file ${args.fakeResponsesFile} does not exist.`);

  const exported = JSON.parse(readFileSync(videosPath, "utf8")) as { videos?: VideoCreditsSource[] };
  if (!Array.isArray(exported.videos)) return refuse("the videos file must be an object with a `videos` list.");
  const videos = args.limit === null ? exported.videos : exported.videos.slice(0, args.limit);
  const responses = responsesPath ? (JSON.parse(readFileSync(responsesPath, "utf8")) as Record<string, unknown>) : {};

  console.log(`Video credits extraction (${VIDEO_CREDITS_PROMPT_V1}) — DRY RUN with the FAKE provider: no database, no Anthropic API call, only a local report.`);
  console.log(`  Videos file: ${args.videosFile} (${videos.length} video${videos.length === 1 ? "" : "s"}${args.limit !== null ? `, limited to ${args.limit}` : ""})`);
  console.log(`  Fake answers: ${args.fakeResponsesFile ?? "(none: every video gets an empty answer)"}`);
  console.log("");
  const estimate = estimateVideoCreditsCost(videos, args.model);
  for (const line of formatEstimate(estimate)) console.log(line);
  console.log("");

  const provider = new FakeAIProvider({ respond: cannedResponder(responses) });
  const outcomes: VideoCreditsOutcome[] = [];
  console.log("Per video:");
  for (const video of videos) {
    const outcome = await extractVideoCredits(video, provider, { model: args.model });
    outcomes.push(outcome);
    for (const line of formatOutcome(outcome)) console.log(line);
  }
  console.log("");

  const report = buildVideoCreditsReport({ generatedAt, args, estimate, outcomes });
  for (const line of formatTotals(report.totals)) console.log(line);
  mkdirSync(path.dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Report written: ${path.relative(ROOT, reportPath)}`);
  console.log("Nothing was written to any database and no catalogue record was created.");
  return VIDEO_CREDITS_EXIT_CODES.SUCCEEDED;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    console.error(`FAILED: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = VIDEO_CREDITS_EXIT_CODES.FAILED;
  }
);
