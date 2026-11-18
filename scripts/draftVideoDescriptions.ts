// Research-assisted content, step 2: PROSE DRAFTS from accepted claims and approved credits. LOCAL ONLY: no database, no network, no API.
//
//   npm run ai:video-describe-draft [-- --dir reports/video-credits] [--only <id,id>] [--no-invitation]
//
// Reads the reviewed review-credits.csv and review-names.csv (and review-videos.csv when present) and, when present, research-claims.csv with the
// editor's decisions. Writes into the same folder:
//   describe-drafts.csv           one DRAFT per video (UTF-8 with BOM): the deterministic template text with accepted claims as a cited context
//                                 paragraph, the numbered citations, notes (blocked claims, gate-3 problems); the editor fills decision,
//                                 editedDescription and editorNotes;
//   describe-prompt-<time>.md     the video-description-v1 prompt and each video's data block, for a person or a session to give to a model.
//                                 Nothing is sent: there is no API call in this workflow;
//   research-audit.jsonl          APPENDED: every claim decision seen for the first time or changed (gate 5, docs/content-guardrails.md).
// Claims pass the content guardrails first (gates 1-3): a named approver, no conflict, no stale or flagged claim; weak claims only with attribution.
// Nothing replaces the YouTube text. Exit codes: 0 done, 2 failed, 4 refused.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { resolveApprovedFacts } from "../modules/jobs/videoCreditsApproved";
import { planVideo } from "../modules/jobs/videoCreditsCreate";
import { isPathInside } from "../modules/jobs/videoCreditsRunner";
import { assessClaimSheet, buildProseDraft, promptInputFor, proseDraftsToCsv, type BlockedClaim, type UsableClaim } from "../modules/jobs/videoDescribeDraft";
import { renderVideoDescriptionPromptFile } from "../modules/ai/prompts/videoDescription/videoDescriptionPromptV1";
import { auditDecisionChanges, parseJsonl, toJsonl } from "../modules/mmke/guardrails/audit";
import { findNearDuplicates } from "../modules/mmke/guardrails/generation";

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
  if (!existsSync(file("review-credits.csv")) || !existsSync(file("review-names.csv"))) return refuse(`review-credits.csv and review-names.csv must both be in ${dir} (reviewed).`);

  const facts = resolveApprovedFacts({
    creditsCsv: readFileSync(file("review-credits.csv"), "utf8"),
    namesCsv: readFileSync(file("review-names.csv"), "utf8"),
    videosCsv: existsSync(file("review-videos.csv")) ? readFileSync(file("review-videos.csv"), "utf8") : null,
  });
  if (facts.problems.length > 0 && facts.videos.length === 0) return refuse(facts.problems.join(" "));

  const now = new Date();
  let usable: UsableClaim[] = [];
  let blocked: BlockedClaim[] = [];
  let ignored = 0;
  let auditAppended = 0;
  if (existsSync(file("research-claims.csv"))) {
    const claims = assessClaimSheet(readFileSync(file("research-claims.csv"), "utf8"), now);
    if (claims.problems.length) return refuse(claims.problems.join(" "));
    ({ usable, blocked, ignored } = claims);
    // Gate 5: the spreadsheet can change silently, so every decision this run sees for the first time (or sees changed) is appended to the log.
    const logFile = file("research-audit.jsonl");
    const events = auditDecisionChanges(existsSync(logFile) ? parseJsonl(readFileSync(logFile, "utf8")) : [], claims.decisions, now);
    if (events.length) appendFileSync(logFile, toJsonl(events), "utf8");
    auditAppended = events.length;
  }

  const videos = facts.videos.filter((v) => (!only || only.has(v.youtubeVideoId)) && v.facts.length > 0);
  const drafts = videos.map((v) => buildProseDraft(v, usable, { invitation, heldReasons: planVideo(v).heldReasons, blocked }));
  // Gate 3, across videos: claim paragraphs must not be near-copies of each other.
  const withProse = drafts.filter((d) => d.claimProse);
  for (const dup of findNearDuplicates(withProse.map((d) => ({ id: d.youtubeVideoId, prose: d.claimProse, title: d.recordingTitle })))) {
    for (const id of [dup.a, dup.b]) drafts.find((d) => d.youtubeVideoId === id)!.notes.push(`GUARDRAIL (gate 3): context paragraph is ${dup.sameOpening ? "opened the same way as" : `${Math.round(dup.similarity * 100)}% similar to`} ${id === dup.a ? dup.b : dup.a}'s`);
  }
  writeFileSync(file("describe-drafts.csv"), proseDraftsToCsv(drafts), "utf8");
  const generatedAt = now.toISOString().replace(/[:.]/g, "-");
  const promptFile = file(`describe-prompt-${generatedAt}.md`);
  writeFileSync(promptFile, renderVideoDescriptionPromptFile(videos.map((v) => promptInputFor(v, usable))), "utf8");

  console.log("Video description drafts — local files only (no database, no network, no API).");
  console.log(`Videos: ${drafts.length}; usable claims ${usable.length} (weak, attributed: ${usable.filter((c) => c.weak).length}); blocked ${blocked.length}; no decision, defer or reject ${ignored}; audit events appended ${auditAppended}`);
  console.log(`Guardrail notes: ${drafts.reduce((n, d) => n + d.notes.filter((x) => x.startsWith("GUARDRAIL")).length, 0)}`);
  console.log(`Written: ${path.join(dir, "describe-drafts.csv")} (UTF-8 with BOM) and ${path.relative(ROOT, promptFile)} (prompt for a model; nothing was sent).`);
  console.log("DRAFTS only: nothing was sent to YouTube, to an AI provider or to a database.");
  return 0;
}

try {
  process.exitCode = main();
} catch (error) {
  console.error(`FAILED: ${error instanceof Error ? error.name : "unknown error"}`);
  process.exitCode = 2;
}
