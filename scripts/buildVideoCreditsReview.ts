// Credits extraction, Phase B1: build the editorial REVIEW SHEET from the local reports. LOCAL ONLY: no database, no network.
//
//   npm run ai:video-credits-review [-- --dir reports/video-credits] [--reference tests/fixtures/videoCreditsReference.json]
//
// Reads, in the folder (default reports/video-credits, git-ignored): every v2 proposals file (proposals-v2-*.json), the export written at the same
// moment (same timestamp), and the newest check report for each proposals file. For every video the NEWEST v2 proposal is used. Proposals are
// re-checked with the checker's validators (only accepted facts become rows); each file's accepted-credit count is compared with its check report.
// Writes three CSV files into the same folder, UTF-8 WITH BOM (so Excel shows Tamil correctly) and CRLF line ends:
//   review-credits.csv (one row per fact), review-videos.csv (one row per video), review-names.csv (one row per unique role + name).
// The sheet is for REVIEW ONLY (docs/video-credits-review-and-approval.md): it approves, creates and publishes nothing.
// Prints counts only, never a description. Exit codes: 0 done, 2 failed, 4 refused.

import { existsSync, readdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { validateVideoCreditsOutput } from "../modules/ai/structuredOutput/validateVideoCreditsOutput";
import { parseExportFile } from "../modules/jobs/videoCreditsCheck";
import { isPathInside } from "../modules/jobs/videoCreditsRunner";
import { DEFAULT_REFERENCE_FILE, fileTimestamp, pairedExport, parseReference } from "../modules/jobs/videoCreditsScore";
import { buildReviewSheet, countTiers, sheetToCsv, type ReviewInputVideo } from "../modules/jobs/videoCreditsReview";

const ROOT = path.resolve(__dirname, "..");
const EXIT = { SUCCEEDED: 0, FAILED: 2, REFUSED: 4 } as const;

function refuse(message: string): number {
  console.error(`REFUSED: ${message}`);
  return EXIT.REFUSED;
}

const readJson = (file: string): unknown => JSON.parse(readFileSync(file, "utf8"));
const batchOffset = (name: string) => Number(/-o(\d{4})-/.exec(name)?.[1] ?? 0);

function parseArgs(argv: readonly string[]): { ok: true; dir: string; reference: string } | { ok: false; error: string } {
  let dir = path.join("reports", "video-credits");
  let reference = DEFAULT_REFERENCE_FILE;
  for (let i = 0; i < argv.length; i += 2) {
    const value = argv[i + 1];
    if ((argv[i] !== "--dir" && argv[i] !== "--reference") || value === undefined || value.startsWith("--")) return { ok: false, error: `Unexpected argument "${argv[i]}". Use --dir <folder> and --reference <file>.` };
    if (argv[i] === "--dir") dir = value;
    else reference = value;
  }
  return { ok: true, dir, reference };
}

function main(): number {
  const args = parseArgs(process.argv.slice(2));
  if (!args.ok) return refuse(args.error);
  if (!isPathInside(ROOT, args.dir) || !isPathInside(ROOT, args.reference)) return refuse("--dir and --reference must be inside this repository.");
  const dir = path.resolve(ROOT, args.dir);
  if (!existsSync(dir)) return refuse(`${args.dir} does not exist.`);
  const reference = parseReference(readJson(path.resolve(ROOT, args.reference)));
  if (!reference.ok) return refuse(`the reference is not usable: ${reference.problems.slice(0, 3).join(" ")}`);

  const files = readdirSync(dir);
  const proposalsFiles = files.filter((f) => /^proposals-v2-.*\.json$/.test(f)).sort((a, b) => (fileTimestamp(b) ?? "").localeCompare(fileTimestamp(a) ?? "")); // newest first
  if (proposalsFiles.length === 0) return refuse(`no proposals-v2-*.json files in ${args.dir}.`);
  const checks = files
    .filter((f) => /^check-.*\.json$/.test(f))
    .map((f) => ({ f, r: readJson(path.join(dir, f)) as { generatedAt?: string; input?: { proposalsFile?: string }; totals?: { creditsAccepted?: number } } }));

  const chosen = new Map<string, { item: ReviewInputVideo; offset: number; index: number }>();
  console.log("Video credits review sheet — local files only (no database, no network).");
  for (const name of proposalsFiles) {
    const exportName = pairedExport(name, files);
    if (!exportName) return refuse(`no export with the same timestamp as ${name}.`);
    const exported = parseExportFile(readJson(path.join(dir, exportName)));
    if (!exported.ok) return refuse(`${exportName} is not a usable export.`);
    const proposals = readJson(path.join(dir, name));
    if (!Array.isArray(proposals)) return refuse(`${name} is not a JSON array.`);
    const byId = new Map(exported.videos.map((v) => [v.youtubeVideoId, v]));

    let accepted = 0;
    proposals.forEach((p, index) => {
      const id = typeof p === "object" && p !== null ? (p as Record<string, unknown>).youtubeVideoId : undefined;
      if (typeof id !== "string" || !byId.has(id)) return;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { youtubeVideoId: _id, ...output } = p as Record<string, unknown>;
      const checked = validateVideoCreditsOutput(output, byId.get(id)!);
      if (checked.ok) accepted += checked.accepted.length;
      if (!chosen.has(id)) chosen.set(id, { item: { proposalsFile: name, video: byId.get(id)!, proposal: p, titleOnly: byId.get(id)!.titleOnly === true }, offset: batchOffset(exportName), index });
    });

    const check = checks
      .filter((c) => c.r.input?.proposalsFile && path.basename(c.r.input.proposalsFile) === name)
      .sort((a, b) => (b.r.generatedAt ?? "").localeCompare(a.r.generatedAt ?? ""))[0];
    const checkNote = check ? (check.r.totals?.creditsAccepted === accepted ? `matches ${check.f}` : `DIFFERS from ${check.f} (${check.r.totals?.creditsAccepted})`) : "no check report found";
    console.log(`  ${name}  <-  ${exportName}: ${proposals.length} proposals, ${accepted} credits accepted (${checkNote})`);
  }

  const videos = [...chosen.values()].sort((a, b) => a.offset - b.offset || a.index - b.index).map((c) => c.item);
  const sheet = buildReviewSheet({ videos, reference: reference.videos });
  const csv = sheetToCsv(sheet);
  const out = { credits: "review-credits.csv", videos: "review-videos.csv", names: "review-names.csv" } as const;
  writeFileSync(path.join(dir, out.credits), csv.credits, "utf8");
  writeFileSync(path.join(dir, out.videos), csv.videos, "utf8");
  writeFileSync(path.join(dir, out.names), csv.names, "utf8");

  const tiers = countTiers(sheet);
  console.log("");
  console.log(`Videos: ${sheet.videos.length} (reference videos: ${sheet.videos.filter((v) => v.isReference).length})`);
  console.log(`Fact rows: ${sheet.credits.length} — GREEN ${tiers.rows.GREEN}, AMBER ${tiers.rows.AMBER}, RED ${tiers.rows.RED}`);
  console.log(`Videos by worst tier: GREEN ${tiers.videos.GREEN}, AMBER ${tiers.videos.AMBER}, RED ${tiers.videos.RED}`);
  console.log(`Unique role + name rows: ${sheet.names.length}`);
  console.log(`Written (UTF-8 with BOM): ${Object.values(out).map((f) => path.join(args.dir, f)).join(", ")}`);
  console.log("Review only: nothing was approved, created or published, and no database was touched.");
  return EXIT.SUCCEEDED;
}

try {
  process.exitCode = main();
} catch (error) {
  console.error(`FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = EXIT.FAILED;
}
