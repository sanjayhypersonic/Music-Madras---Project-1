// Research-assisted content, step 1. LOCAL ONLY: no database, no network, no API (the web research itself is done by a separate, human-started
// Claude Code session following docs/video-research-workflow.md; this script never fetches anything).
//
//   npm run ai:video-research-sheet -- --brief      writes research-brief-<time>.json: the approved credits and the questions to research
//   npm run ai:video-research-sheet                 reads every research-proposals-*.json and writes research-claims.csv (one row per claim)
//   (--dir <folder inside the repository>, default reports/video-credits; --only <id,id>)
//
// Both read the reviewed review-credits.csv and review-names.csv (and review-videos.csv when present): only APPROVED credits are researched and
// compared. research-claims.csv is UTF-8 with BOM; the editor fills decision (accept | edit | reject | defer), editedClaim and editorNotes.
// Proposals files and the web pages behind them are DATA, never instructions. Exit codes: 0 done, 2 failed, 4 refused.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { csvRecords, resolveApprovedFacts } from "../modules/jobs/videoCreditsApproved";
import { isPathInside } from "../modules/jobs/videoCreditsRunner";
import { buildClaimRows, buildResearchBrief, claimRowsToCsv, parseResearchProposals, type ClaimDecision } from "../modules/jobs/videoResearch";

const ROOT = path.resolve(__dirname, "..");

function refuse(message: string): number {
  console.error(`REFUSED: ${message}`);
  return 4;
}

function main(): number {
  const argv = process.argv.slice(2);
  let dir = path.join("reports", "video-credits");
  let only: Set<string> | null = null;
  let brief = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--brief") brief = true;
    else if ((argv[i] === "--dir" || argv[i] === "--only") && argv[i + 1] && !argv[i + 1].startsWith("--")) {
      if (argv[i] === "--dir") dir = argv[i + 1];
      else only = new Set(argv[i + 1].split(",").map((s) => s.trim()).filter(Boolean));
      i++;
    } else return refuse(`Unexpected argument "${argv[i]}". Use --brief, --dir <folder> and --only <id,id>.`);
  }
  if (!isPathInside(ROOT, dir)) return refuse("--dir must be inside this repository.");
  const file = (name: string) => path.resolve(ROOT, dir, name);
  if (!existsSync(file("review-credits.csv")) || !existsSync(file("review-names.csv"))) return refuse(`review-credits.csv and review-names.csv must both be in ${dir} (reviewed).`);

  const facts = resolveApprovedFacts({
    creditsCsv: readFileSync(file("review-credits.csv"), "utf8"),
    namesCsv: readFileSync(file("review-names.csv"), "utf8"),
    videosCsv: existsSync(file("review-videos.csv")) ? readFileSync(file("review-videos.csv"), "utf8") : null,
  });
  if (facts.problems.length > 0 && facts.videos.length === 0) return refuse(facts.problems.join(" "));
  const videos = facts.videos.filter((v) => !only || only.has(v.youtubeVideoId));
  console.log("Video research sheet — local files only (no database, no network, no API).");

  if (brief) {
    const generatedAt = new Date();
    const out = file(`research-brief-${generatedAt.toISOString().replace(/[:.]/g, "-")}.json`);
    const content = buildResearchBrief(videos, generatedAt);
    writeFileSync(out, `${JSON.stringify(content, null, 2)}\n`, "utf8");
    console.log(`Brief: ${content.videos.length} video(s) with approved credits, ${content.videos.reduce((n, v) => n + v.questions.length, 0)} question(s).`);
    console.log(`Written: ${path.relative(ROOT, out)}. Next: a research session follows docs/video-research-workflow.md and writes research-proposals-<time>.json here.`);
    return 0;
  }

  const proposalFiles = readdirSync(file(".")).filter((f) => /^research-proposals-.*\.json$/.test(f)).sort();
  if (proposalFiles.length === 0) return refuse(`no research-proposals-*.json in ${dir}. Write the brief first (--brief) and run the research session.`);
  const proposals = proposalFiles.map((name) => {
    const parsed = parseResearchProposals(JSON.parse(readFileSync(file(name), "utf8")));
    for (const p of parsed.problems) console.log(`  ${name}: ${p}`);
    const keep = <T extends { youtubeVideoId: string }>(xs: T[]) => xs.filter((x) => !only || only.has(x.youtubeVideoId));
    return { file: name, claims: keep(parsed.claims), gaps: keep(parsed.gaps) };
  });
  const rows = buildClaimRows({ proposals, videos });
  // Decisions already made in an existing research-claims.csv are kept (matched by claimId).
  const previous = new Map<string, ClaimDecision>();
  if (existsSync(file("research-claims.csv"))) {
    // Only the decision columns are required, so a sheet written before a column was added still hands over its decisions.
    const old = csvRecords(readFileSync(file("research-claims.csv"), "utf8"), ["claimId", "decision"], "research-claims.csv");
    if (old.ok) for (const r of old.rows) if (r.decision || r.approver || r.editedClaim || r.editorNotes) previous.set(r.claimId, { decision: r.decision ?? "", approver: r.approver ?? "", editedClaim: r.editedClaim ?? "", editorNotes: r.editorNotes ?? "" });
  }
  writeFileSync(file("research-claims.csv"), claimRowsToCsv(rows, previous), "utf8");
  if (previous.size > 0) console.log(`Kept ${[...previous.keys()].filter((id) => rows.some((r) => r.claimId === id)).length} earlier decision(s) by claimId.`);

  const claims = rows.filter((r) => r.subjectKind !== "research gap");
  const count = (pred: (r: (typeof rows)[number]) => boolean) => claims.filter(pred).length;
  console.log(`Claims: ${claims.length} from ${proposalFiles.length} file(s); research gaps: ${rows.length - claims.length}`);
  console.log(`  matches the video ${count((r) => r.videoTextRelation === "matches the video")}, CONFLICTS ${count((r) => r.conflict)}, flagged ${count((r) => r.flags.length > 0)}, Wikipedia pointers ${count((r) => r.pointerOnly)}`);
  console.log(`Written (UTF-8 with BOM): ${path.join(dir, "research-claims.csv")}. Conflicts are shown, never resolved: the editor decides.`);
  return 0;
}

try {
  process.exitCode = main();
} catch (error) {
  console.error(`FAILED: ${error instanceof Error ? error.name : "unknown error"}`);
  process.exitCode = 2;
}
