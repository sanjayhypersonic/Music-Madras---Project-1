// R-34: which videos an OPERATOR run (npm run pipeline:run) may touch. Pure.
//
// The operator names videos (--only) or asks for the first N queued (--limit). A video is REFUSED, never run, when:
//   - it is not in the synchronised catalogue, or not public, or not OBSERVED in the latest sync;
//   - it is HELD OUT: a hold on the video (its exposure review carries a rights, copyright, privacy or other hold), a Recording-level hold on the
//     Recording that links it, or a bundle the planner held out (for example a work with no approved composer);
//   - it is ALREADY APPROVED: its bundle is APPROVED or PUBLISHED, or its Recording is already published;
//   - its bundle is REJECTED, FAILED or SKIPPED (a person or the pipeline already decided; a changed video is re-queued by the daily run).
// Everything else is selected, in the order given (or queue order), up to the limit.

import type { PipelinePorts, RunReport } from "./run";

/** The printed summary of an operator run: per video, the stages it went through; then failures, the stop reason, tokens, searches and cost. */
export function describeRunReport(report: RunReport, selected: readonly string[]): string[] {
  const lines: string[] = [];
  for (const id of selected) {
    const steps = report.advanced.filter((a) => a.youtubeVideoId === id);
    const failures = report.failures.filter((f) => f.youtubeVideoId === id);
    lines.push(`  ${id}: ${steps.length ? `${steps[0].from} -> ${steps.map((s) => s.to).join(" -> ")}` : "no stage advanced"}${failures.length ? `; failed at ${failures.map((f) => `${f.stage} (${f.kind})`).join(", ")}` : ""}`);
  }
  for (const w of report.wouldDo) lines.push(`  would: ${w}`);
  if (report.stoppedReason) lines.push(`  STOPPED: ${report.stoppedReason === "COST_CAP" ? "the next paid call would have gone over MAX_USD_PER_RUN; the run resumes from its saved stage next time" : report.stoppedReason}`);
  const u = report.usage;
  lines.push(`  Usage: ${u.calls} AI call(s), ${u.inputTokens} input + ${u.outputTokens} output tokens, ${u.webSearches} web search(es), $${u.costUsd.toFixed(4)} of the $${u.capUsd.toFixed(2)} cap${report.dryRun ? " (dry run: nothing was called or written)" : ""}`);
  return lines;
}

/**
 * The orchestrator's ports, restricted to the selected videos: whatever the underlying ports return, nothing outside `youtubeVideoIds` is queued
 * or advanced. (The Prisma ports are scoped in their queries too; this is the second, independent guarantee.)
 */
export function scopePorts(ports: PipelinePorts, youtubeVideoIds: readonly string[]): PipelinePorts {
  const allowed = new Set(youtubeVideoIds);
  // Every method is bound explicitly: spreading a class instance would drop its prototype methods.
  return {
    saveStage: (id, patch) => ports.saveStage(id, patch),
    replaceClaims: (id, claims) => ports.replaceClaims(id, claims),
    loadClaims: (id) => ports.loadClaims(id),
    loadCatalogueIndex: () => ports.loadCatalogueIndex(),
    loadAliases: () => ports.loadAliases(),
    hasApprovedResearch: (kind, name) => ports.hasApprovedResearch(kind, name),
    listPublishedCopySummaries: () => ports.listPublishedCopySummaries(),
    listQueueCandidates: async (limit) => (await ports.listQueueCandidates(limit)).filter((c) => allowed.has(c.youtubeVideoId)),
    enqueue: async (candidate, fingerprint, requeue) => {
      if (!allowed.has(candidate.youtubeVideoId)) throw new Error("refused: a video outside this run's selection");
      return ports.enqueue(candidate, fingerprint, requeue);
    },
    listWork: async (limit, maxAttempts) => (await ports.listWork(limit, maxAttempts)).filter((r) => allowed.has(r.youtubeVideoId)),
  };
}

export interface VideoRunFacts {
  youtubeVideoId: string;
  inCatalogue: boolean;
  privacyStatus: string | null;
  observabilityState: string | null;
  bundleStatus: string | null;
  bundleHeldReasons: string[];
  videoHoldReason: string | null;
  recordingHoldReason: string | null;
  recordingStatus: string | null;
}

export type RunRefusal = { youtubeVideoId: string; reason: string };

export function refusalReason(f: VideoRunFacts): string | null {
  if (!f.inCatalogue) return "not in the synchronised catalogue (run the YouTube sync first)";
  if (f.privacyStatus !== "public") return `stored as ${f.privacyStatus ?? "unknown privacy"}, not public`;
  if (f.observabilityState !== "OBSERVED") return `${f.observabilityState ?? "not observed"} in the latest sync`;
  if (f.videoHoldReason) return `held out: the video has a ${f.videoHoldReason.toLowerCase()} hold`;
  if (f.recordingHoldReason) return `held out: its Recording has a ${f.recordingHoldReason.toLowerCase()} hold`;
  if (f.bundleHeldReasons.length) return `held out by the planner: ${f.bundleHeldReasons[0]}`;
  if (f.bundleStatus === "APPROVED" || f.bundleStatus === "PUBLISHED") return `already approved (bundle ${f.bundleStatus})`;
  if (f.recordingStatus === "PUBLISHED") return "already approved (its Recording is published)";
  if (f.bundleStatus === "REJECTED" || f.bundleStatus === "FAILED" || f.bundleStatus === "SKIPPED") return `bundle is ${f.bundleStatus}; not re-run by hand`;
  if (f.bundleStatus === "AWAITING_APPROVAL") return "already drafted and awaiting approval (nothing left to run)";
  return null;
}

export const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

export interface RunArgs {
  only: string[] | null;
  limit: number | null;
  execute: boolean;
  confirmHost: string | null;
}

export function parseRunArgs(argv: readonly string[]): { ok: true; args: RunArgs } | { ok: false; error: string } {
  const args: RunArgs = { only: null, limit: null, execute: false, confirmHost: null };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === "--execute") {
      args.execute = true;
      continue;
    }
    const value = argv[i + 1];
    if (!["--only", "--limit", "--confirm-host"].includes(flag)) return { ok: false, error: `Unknown argument "${flag}".` };
    if (value === undefined || value.startsWith("--")) return { ok: false, error: `${flag} needs a value.` };
    if (flag === "--only") {
      const ids = [...new Set(value.split(",").map((s) => s.trim()).filter(Boolean))];
      if (ids.length === 0 || ids.some((id) => !YOUTUBE_ID.test(id))) return { ok: false, error: "--only takes comma-separated 11-character YouTube video ids." };
      if (ids.length > 20) return { ok: false, error: "--only takes at most 20 videos per run." };
      args.only = ids;
    }
    if (flag === "--limit") {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 1 || n > 20) return { ok: false, error: "--limit must be a whole number from 1 to 20." };
      args.limit = n;
    }
    if (flag === "--confirm-host") args.confirmHost = value;
    i++;
  }
  if (!args.only && !args.limit) return { ok: false, error: "Name the videos with --only <id,id> or take the first queued with --limit <N>." };
  if (args.execute && !args.confirmHost) return { ok: false, error: "--execute needs --confirm-host <host:port/database> (the staging target, typed by the operator)." };
  return { ok: true, args };
}

/** The videos this run may touch, in order, and every refusal with its reason. With --only, an id missing from `facts` is "not in the catalogue". */
export function selectRunTargets(facts: readonly VideoRunFacts[], args: Pick<RunArgs, "only" | "limit">): { selected: string[]; refused: RunRefusal[] } {
  const byId = new Map(facts.map((f) => [f.youtubeVideoId, f]));
  const ordered = args.only ?? facts.map((f) => f.youtubeVideoId);
  const selected: string[] = [];
  const refused: RunRefusal[] = [];
  for (const id of ordered) {
    const f = byId.get(id) ?? { youtubeVideoId: id, inCatalogue: false, privacyStatus: null, observabilityState: null, bundleStatus: null, bundleHeldReasons: [], videoHoldReason: null, recordingHoldReason: null, recordingStatus: null };
    const reason = refusalReason(f);
    if (reason) refused.push({ youtubeVideoId: id, reason });
    else if (!args.limit || selected.length < args.limit) selected.push(id);
  }
  return { selected, refused };
}
