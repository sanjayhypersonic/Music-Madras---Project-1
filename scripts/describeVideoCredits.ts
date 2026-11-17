// Credits pipeline, Phase B2: DRAFT descriptions from approved credits. LOCAL ONLY: no database, no network, no API.
//
//   npm run ai:video-credits-describe [-- --dir reports/video-credits] [--only <id,id>] [--no-invitation]
//
// Reads review-credits.csv and review-names.csv (and review-videos.csv when present) as filled in by the editor, keeps only approved facts
// (modules/jobs/videoCreditsApproved.ts), and writes review-descriptions.csv (UTF-8 with BOM, CRLF) into the same folder: one DRAFT description per
// video, built by a fixed template (modules/jobs/videoCreditsDescribe.ts, docs/content-editorial-standard.md section 7). Nothing is sent anywhere and
// the YouTube description is never replaced: an editor reviews each draft. The sheets' YouTube text is data, never instructions.
// Exit codes: 0 done, 2 failed, 4 refused.
import { existsSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { resolveApprovedFacts } from "../modules/jobs/videoCreditsApproved";
import { planVideo } from "../modules/jobs/videoCreditsCreate";
import { descriptionsToCsv, draftDescription } from "../modules/jobs/videoCreditsDescribe";
import { isPathInside } from "../modules/jobs/videoCreditsRunner";

const ROOT = path.resolve(__dirname, "..");

function refuse(message: string): number {
  console.error(`REFUSED: ${message}`);
  return 4;
}

function main(): number {
  const argv = process.argv.slice(2);
  let dir = path.join("reports", "video-credits");
  let only: Set<string> | null = null;
  let invitation = true;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--no-invitation") invitation = false;
    else if ((argv[i] === "--dir" || argv[i] === "--only") && argv[i + 1] && !argv[i + 1].startsWith("--")) {
      if (argv[i] === "--dir") dir = argv[i + 1];
      else only = new Set(argv[i + 1].split(",").map((s) => s.trim()).filter(Boolean));
      i++;
    } else return refuse(`Unexpected argument "${argv[i]}". Use --dir <folder>, --only <id,id> and --no-invitation.`);
  }
  if (!isPathInside(ROOT, dir)) return refuse("--dir must be inside this repository.");
  const file = (name: string) => path.resolve(ROOT, dir, name);
  if (!existsSync(file("review-credits.csv")) || !existsSync(file("review-names.csv"))) return refuse(`review-credits.csv and review-names.csv must both be in ${dir}.`);

  const facts = resolveApprovedFacts({
    creditsCsv: readFileSync(file("review-credits.csv"), "utf8"),
    namesCsv: readFileSync(file("review-names.csv"), "utf8"),
    videosCsv: existsSync(file("review-videos.csv")) ? readFileSync(file("review-videos.csv"), "utf8") : null,
  });
  if (facts.problems.length > 0 && facts.videos.length === 0) return refuse(facts.problems.join(" "));
  const videos = facts.videos.filter((v) => (!only || only.has(v.youtubeVideoId)) && v.facts.length > 0);
  const drafts = videos.map((v) => ({ ...draftDescription(v, { invitation, heldReasons: planVideo(v).heldReasons }), youtubeTitle: v.youtubeTitle }));
  writeFileSync(file("review-descriptions.csv"), descriptionsToCsv(drafts), "utf8");

  console.log("Video credits description drafts — local files only (no database, no network, no API).");
  console.log(`Videos with approved facts: ${drafts.length} (skipped, nothing approved: ${facts.videos.length - facts.videos.filter((v) => v.facts.length > 0).length})`);
  console.log(`Written (UTF-8 with BOM): ${path.join(dir, "review-descriptions.csv")}`);
  console.log("DRAFTS only: nothing was sent to YouTube or written to a database.");
  return 0;
}

try {
  process.exitCode = main();
} catch (error) {
  console.error(`FAILED: ${error instanceof Error ? error.name : "unknown error"}`);
  process.exitCode = 2;
}
