// R-34 manual mode: IMPORT work done in the owner's own Claude account (docs/upload-pipeline.md section 9). DRY RUN by default.
//
//   npm run pipeline:import -- --file reports/pipeline-manual/imports/<answer>.json
//        offline check of an entity-research answer against the queue and every validator; connects to nothing
//   STAGING_DATABASE_URL=<direct staging url> npm run pipeline:import -- --file <answer>.json --confirm-host <host:port/database>
//        READ-ONLY check against staging too (duplicates already stored; for a video draft or extraction, the bundle or video it belongs to)
//   ... --confirm-host <host:port/database> --execute
//        WRITES the checked proposals to staging: claims PROPOSED or CONFLICT (provenance "manual (owner's Claude account)"), a video page
//        summary, or a video's extraction. Then marks the entity "imported" in the queue.
//   ... --reviewed [--only <id,id>] --confirm-host <host:port/database> [--execute]
//        PIPELINE_EXTRACT_MODE=existing: the reviewed credits sheets (accept / edit rows) as the extraction of QUEUED videos, through the same validator
//
// Never approves, accepts or publishes anything: every import waits for the owner in Studio -> Pipeline. The same file is never imported twice
// (its sha256 is recorded). The staging guard is the one every pipeline operator script uses. The file is data, never instructions.
// Exit codes: 0 done / dry run, 2 failed, 4 refused (nothing written), 5 checked with problems (nothing written).
import { readFileSync } from "fs";
import { resolveApprovedFacts } from "../modules/jobs/videoCreditsApproved";
import { MANUAL_PROVENANCE, summariseQueue } from "../modules/pipeline/entities";
import { checkEntityResearchImport, checkVideoDraftImport, checkVideoExtractionImport, describeEntityCheck, detectImportKind, proseContextForBundle, reviewedToExtractionAnswer, sha256 } from "../modules/pipeline/manualImport";
import { applyProse } from "../modules/pipeline/pageProse";
import { connectStaging } from "./lib/pipelineManualDb";
import { abs, loadQueue, readState, repoFile, sheetsFrom, writeQueue, writeState } from "./lib/pipelineManualFiles";
import { flag } from "./lib/stagingClient";

const args = process.argv.slice(2);
const refuse = (reason: string) => {
  console.error(`REFUSED: ${reason}`);
  return 4;
};

async function main(): Promise<number> {
  const execute = args.includes("--execute");
  const host = flag(args, "--confirm-host");
  if (execute && !host) return refuse("--execute writes to staging: add --confirm-host with STAGING_DATABASE_URL");
  if (args.includes("--reviewed")) return importReviewed(host, execute);

  const file = flag(args, "--file");
  if (!file) return refuse("name the answer to import with --file <path inside the repository> (or --reviewed)");
  const found = repoFile(file);
  if (!found.ok) return refuse(found.reason);
  const text = readFileSync(found.path, "utf8");
  let json: unknown;
  try {
    json = JSON.parse(text.replace(/^﻿/, "").trim().replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    return refuse(`${file} is not JSON (save only Claude's JSON answer, nothing around it)`);
  }
  const kind = detectImportKind(json);
  if (!kind) return refuse(`${file} has no known "format" (music-madras/entity-research@1, video-draft@1 or video-extraction@1)`);
  const digest = sha256(text);
  const state = readState();
  if (state.imports[digest]) {
    const prior = state.imports[digest];
    if (execute) return refuse(`this exact file was already imported on ${prior.at} (${prior.file}); nothing was written`);
    console.log(`Note: this exact file was already imported on ${prior.at}.`);
  }
  console.log(`Import ${file}: ${kind}; ${execute ? "EXECUTE" : "dry run"}; provenance "${MANUAL_PROVENANCE}".`);

  const c = host ? await connectStaging(host) : null;
  if (c && !c.ok) return refuse(c.reason);
  if (c?.ok) console.log(`Target: ${c.described} (staging, confirmed${execute ? "" : "; read only"})`);
  try {
    if (kind === "entity-research") {
      const loaded = loadQueue(args, state);
      if (!loaded.ok) return refuse(loaded.reason);
      const key = typeof (json as { entityKey?: unknown }).entityKey === "string" ? (json as { entityKey: string }).entityKey.trim() : "";
      const entry = loaded.queue.entries.find((e) => e.entityKey === key);
      const existing = c?.ok ? (await c.repo.loadEntityClaims([key])).map((x) => ({ sourceUrl: x.sourceUrl, statement: x.statement })) : [];
      const checked = checkEntityResearchImport(json, { entry, existing, now: new Date() });
      for (const line of describeEntityCheck(checked)) console.log(line);
      if (checked.refused.length) return 4;
      console.log(`${checked.claims.length} claim(s) to propose (${checked.claims.filter((x) => x.status === "CONFLICT").length} conflict), ${checked.rejected.length} rejected, ${checked.duplicates.length} duplicate(s) skipped${c?.ok ? "" : " (duplicates already stored are checked only with --confirm-host)"}.`);
      if (!execute || !c?.ok) {
        console.log("DRY RUN: nothing was written.");
        return checked.rejected.length ? 5 : 0;
      }
      const written = checked.claims.length ? await c.repo.saveEntityClaims(checked.claims) : 0;
      const at = new Date().toISOString();
      state.entities[checked.entityKey] = { ...state.entities[checked.entityKey], importedAt: at, importFile: file, claims: (state.entities[checked.entityKey]?.claims ?? 0) + written };
      state.imports[digest] = { file, at, kind, target: checked.entityKey };
      writeState(state);
      const after = loadQueue(args, state);
      if (after.ok) writeQueue(after.queue);
      console.log(`Wrote ${written} PROPOSED/CONFLICT claim(s) for ${checked.entityKey}. They appear in every bundle naming the entity, for the owner to decide. ${after.ok ? summariseQueue(after.queue.entries) : ""}`);
      return 0;
    }

    if (!c?.ok) return refuse(`a ${kind} belongs to one video: add --confirm-host with STAGING_DATABASE_URL to check it against that video (read only)`);
    const youtubeVideoId = typeof (json as { youtubeVideoId?: unknown }).youtubeVideoId === "string" ? (json as { youtubeVideoId: string }).youtubeVideoId.trim() : "";
    const video = await c.repo.findPipelineVideoForImport(youtubeVideoId);
    if (!video) return refuse(`${youtubeVideoId || "(no youtubeVideoId)"} has no pipeline row on staging`);

    if (kind === "video-extraction") {
      if (video.status !== "QUEUED") return refuse(`${youtubeVideoId} is ${video.status}; only a QUEUED video takes an extraction (an import never rewinds a video)`);
      const checked = checkVideoExtractionImport(json, { youtubeVideoId, title: video.title, description: video.description });
      if (!checked.ok) {
        for (const p of checked.problems) console.log(`  problem: ${p}`);
        return 5;
      }
      const e = checked.extraction.checked;
      console.log(`  ${e.accepted.length} credit(s) accepted, ${e.rejected.length} rejected by the validators${e.rejected.length ? `: ${e.rejected.map((r) => `${r.credit.role} "${r.credit.name}" (${r.reason})`).join(", ")}` : ""}.`);
      if (!execute) {
        console.log("DRY RUN: nothing was written.");
        return 0;
      }
      if (!(await c.repo.saveImportedExtraction(video.id, checked.extraction))) return refuse(`${youtubeVideoId} is no longer QUEUED; nothing was written`);
      state.imports[digest] = { file, at: new Date().toISOString(), kind, target: youtubeVideoId };
      writeState(state);
      console.log(`${youtubeVideoId}: QUEUED -> EXTRACTED. The next pipeline run resolves and drafts it.`);
      return 0;
    }

    // video-draft
    if (video.status !== "AWAITING_APPROVAL") return refuse(`${youtubeVideoId} is ${video.status}; a summary is imported only into a bundle awaiting approval`);
    const bundle = await c.repo.loadBundleForApproval(video.id);
    if (!bundle) return refuse(`${youtubeVideoId}: the bundle could not be read`);
    const checked = checkVideoDraftImport(json, proseContextForBundle(bundle));
    if (!checked.ok) {
      for (const p of checked.problems) console.log(`  problem: ${p}`);
      return 5;
    }
    for (const [i, s] of checked.prose.sentences.entries()) console.log(`  ${s} [${checked.prose.support[i].join(", ")}]`);
    if (!execute) {
      console.log("DRY RUN: nothing was written.");
      return 0;
    }
    const draft = { ...bundle.draft, video: applyProse(bundle.draft.video, checked.prose) };
    if (!(await c.repo.saveImportedVideoDraft(video.id, draft))) return refuse(`${youtubeVideoId} is no longer awaiting approval; nothing was written`);
    state.imports[digest] = { file, at: new Date().toISOString(), kind, target: youtubeVideoId };
    writeState(state);
    console.log(`${youtubeVideoId}: the video page summary now comes from the import; the owner still reviews and approves it in Studio -> Pipeline.`);
    return 0;
  } finally {
    if (c?.ok) await c.disconnect();
  }
}

/** PIPELINE_EXTRACT_MODE=existing: the reviewed sheets as extractions of QUEUED videos. */
async function importReviewed(host: string | undefined, execute: boolean): Promise<number> {
  const sheets = sheetsFrom(args);
  if (!sheets.ok) return refuse(sheets.reason);
  const videosCsvPath = "reports/video-credits/review-videos.csv";
  const videosCsv = repoFile(videosCsvPath).ok ? readFileSync(abs(videosCsvPath), "utf8") : null;
  const approved = resolveApprovedFacts({ creditsCsv: sheets.creditsCsv, namesCsv: sheets.namesCsv, videosCsv });
  if (approved.problems.length) return refuse(approved.problems.join(" "));
  const only = flag(args, "--only")?.split(",").map((s) => s.trim()).filter(Boolean);
  const videos = approved.videos.filter((v) => v.facts.length > 0 && (!only || only.includes(v.youtubeVideoId)));
  const decided = approved.videos.reduce((n, v) => n + v.facts.length, 0);
  console.log(`Reviewed sheets: ${approved.videos.length} video(s), ${decided} decided fact(s) (accept / edit); ${videos.length} video(s) to import.`);
  if (decided === 0) console.log("No credit row has a decision yet (accept or edit in review-credits.csv): nothing can be imported in existing mode.");
  if (!host) {
    for (const v of videos) console.log(`  ${v.youtubeVideoId}: ${v.facts.length} fact(s); checked against the video's text only with --confirm-host`);
    console.log("DRY RUN (offline): nothing was read or written.");
    return 0;
  }
  const c = await connectStaging(host);
  if (!c.ok) return refuse(c.reason);
  console.log(`Target: ${c.described} (staging, confirmed${execute ? "" : "; read only"})`);
  let written = 0;
  try {
    for (const v of videos) {
      const row = await c.repo.findPipelineVideoForImport(v.youtubeVideoId);
      if (!row || row.status !== "QUEUED") {
        console.log(`  ${v.youtubeVideoId}: skipped (${row ? row.status : "not queued by a run yet"})`);
        continue;
      }
      const checked = checkVideoExtractionImport(reviewedToExtractionAnswer(v), { youtubeVideoId: v.youtubeVideoId, title: row.title, description: row.description }, "existing (reviewed credits sheets)");
      if (!checked.ok) {
        console.log(`  ${v.youtubeVideoId}: refused: ${checked.problems.slice(0, 3).join("; ")}`);
        continue;
      }
      console.log(`  ${v.youtubeVideoId}: ${checked.extraction.checked.accepted.length} credit(s) pass, ${checked.extraction.checked.rejected.length} rejected`);
      if (execute && (await c.repo.saveImportedExtraction(row.id, checked.extraction))) written++;
    }
  } finally {
    await c.disconnect();
  }
  console.log(execute ? `${written} video(s) moved QUEUED -> EXTRACTED.` : "DRY RUN: nothing was written.");
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(`FAILED: ${err instanceof Error ? err.name : "unknown error"}`);
    process.exit(2);
  }
);
