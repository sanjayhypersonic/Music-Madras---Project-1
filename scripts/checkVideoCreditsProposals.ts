// Credits extraction, route 2: check a proposals file against the export it was written from. NO database, NO network.
//
//   npm run ai:video-credits-check -- --export reports/video-credits/export-….json --proposals reports/video-credits/proposals-….json [--report <file>]
//
// Every proposal is checked with the same validators the API route uses (verbatim quotation in the cited field, name inside the quotation, venue-type
// word, date year, duplicates, hashtags) against the title and description in the EXPORT. Proposals for videos not in the export are rejected.
// Writes one local report (default reports/video-credits/check-<timestamp>.json) with accepted and rejected credits and their reasons, a per-role
// summary, and the unique proposed names for a later names-first review. Every path must be inside this repository.
// Exit codes: 0 done, 2 failed, 4 refused.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import {
  VIDEO_CREDITS_CHECK_EXIT_CODES,
  buildVideoCreditsCheckReport,
  checkVideoCreditsProposals,
  defaultCheckReportPath,
  formatCheckSummary,
  parseExportFile,
  parseVideoCreditsCheckArgs,
} from "../modules/jobs/videoCreditsCheck";
import { formatOutcome, formatTotals, isPathInside } from "../modules/jobs/videoCreditsRunner";

const ROOT = path.resolve(__dirname, "..");

function refuse(message: string): number {
  console.error(`REFUSED: ${message}`);
  return VIDEO_CREDITS_CHECK_EXIT_CODES.REFUSED;
}

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, "utf8"));
}

async function main(): Promise<number> {
  const parsed = parseVideoCreditsCheckArgs(process.argv.slice(2));
  if (!parsed.ok) return refuse(parsed.error);
  const { args } = parsed;

  const generatedAt = new Date();
  const reportRelative = args.reportFile ?? defaultCheckReportPath(generatedAt);
  for (const [label, candidate] of [["--export", args.exportFile], ["--proposals", args.proposalsFile], ["--report", reportRelative]] as const) {
    if (!isPathInside(ROOT, candidate)) return refuse(`${label} must be a path inside this repository.`);
  }
  const exportPath = path.resolve(ROOT, args.exportFile);
  const proposalsPath = path.resolve(ROOT, args.proposalsFile);
  const reportPath = path.resolve(ROOT, reportRelative);
  if (!existsSync(exportPath)) return refuse(`the export file ${args.exportFile} does not exist.`);
  if (!existsSync(proposalsPath)) return refuse(`the proposals file ${args.proposalsFile} does not exist.`);

  let exportRaw: unknown;
  let proposalsRaw: unknown;
  try {
    exportRaw = readJson(exportPath);
  } catch {
    return refuse("the export file is not valid JSON.");
  }
  try {
    proposalsRaw = readJson(proposalsPath);
  } catch {
    return refuse("the proposals file is not valid JSON.");
  }

  const exported = parseExportFile(exportRaw);
  if (!exported.ok) return refuse(`the export file is not usable: ${exported.problems.slice(0, 5).join(" ")}`);
  const checked = checkVideoCreditsProposals(exported.videos, proposalsRaw);
  if (!checked.ok) return refuse(checked.error);

  console.log("Video credits check — proposals against the export (no database, no network).");
  console.log(`  Export:    ${args.exportFile} (${exported.videos.length} videos)`);
  console.log(`  Proposals: ${args.proposalsFile} (${(proposalsRaw as unknown[]).length} entries)`);
  console.log("");
  console.log("Per video:");
  for (const outcome of checked.result.outcomes) for (const line of formatOutcome(outcome)) console.log(line);
  console.log("");

  const report = buildVideoCreditsCheckReport({ generatedAt, args, videosInExport: exported.videos.length, proposals: (proposalsRaw as unknown[]).length, result: checked.result });
  for (const line of formatTotals(report.totals)) console.log(line);
  console.log(`Proposals not checked: ${report.totals.proposalsRejected}; export videos without a proposal: ${report.totals.videosWithoutProposal}`);
  console.log("");
  for (const line of formatCheckSummary(report)) console.log(line);
  console.log("");
  mkdirSync(path.dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Report written: ${path.relative(ROOT, reportPath)}`);
  return VIDEO_CREDITS_CHECK_EXIT_CODES.SUCCEEDED;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    console.error(`FAILED: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = VIDEO_CREDITS_CHECK_EXIT_CODES.FAILED;
  }
);
