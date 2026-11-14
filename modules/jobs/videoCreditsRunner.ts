// Credits extraction, milestone 1: the PURE parts of the operator script scripts/runVideoCreditsExtraction.ts (argument parsing, the path guard,
// the token and cost estimate, the summary and the report). No fs, no network, no database, so all of it is unit-tested.
//
// Milestone 1 boundaries, enforced here and in the script:
//   - the input is a local JSON export of videos (the shape of tests/fixtures/realYouTubeVideos.json); the database is never read or written;
//   - the only provider is the deterministic fake; --execute (a real Anthropic call) is refused;
//   - every path (input, fake responses, report) must resolve inside the repository, so nothing outside it, such as a secrets folder, is read;
//   - the only write is the local report file.

import path from "path";
import { VIDEO_CREDITS_OUTPUT_SCHEMA_V1, VIDEO_CREDITS_PROMPT_V1, VIDEO_CREDITS_SYSTEM_INSTRUCTIONS_V1 } from "../ai/prompts/videoCredits/videoCreditsPromptV1";
import { buildVideoCreditsContext, videoSkipReason, type VideoCreditsOutcome, type VideoCreditsSource } from "../ai/gateway/extractVideoCredits";

export const VIDEO_CREDITS_EXIT_CODES = { SUCCEEDED: 0, FAILED: 2, REFUSED: 4 } as const;

export const DEFAULT_VIDEO_CREDITS_MODEL = "claude-opus-5-5";

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Arguments

export interface VideoCreditsRunnerArgs {
  videosFile: string;
  fakeResponsesFile: string | null;
  reportFile: string | null;
  model: string;
  limit: number | null;
}

const KNOWN_FLAGS = new Set(["--videos", "--fake-responses", "--report", "--model", "--limit", "--execute"]);

export function parseVideoCreditsRunnerArgs(argv: readonly string[]): { ok: true; args: VideoCreditsRunnerArgs } | { ok: false; error: string } {
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (!KNOWN_FLAGS.has(flag)) return { ok: false, error: `Unknown argument "${flag}".` };
    if (flag === "--execute") {
      return {
        ok: false,
        error: "--execute would call the real Anthropic API, which is not enabled in milestone 1. Run without it: the dry run uses the deterministic fake provider and writes only a local report.",
      };
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) return { ok: false, error: `${flag} needs a value.` };
    values.set(flag, value);
    i++;
  }
  const videosFile = values.get("--videos");
  if (!videosFile) return { ok: false, error: "--videos <file> is required: a local JSON export of videos, in the shape of tests/fixtures/realYouTubeVideos.json." };
  let limit: number | null = null;
  if (values.has("--limit")) {
    limit = Number(values.get("--limit"));
    if (!Number.isInteger(limit) || limit < 1) return { ok: false, error: "--limit must be a positive whole number." };
  }
  const model = values.get("--model") ?? DEFAULT_VIDEO_CREDITS_MODEL;
  if (!MODEL_PRICES[model]) return { ok: false, error: `--model "${model}" has no price in the estimate table. Known: ${Object.keys(MODEL_PRICES).join(", ")}.` };
  return { ok: true, args: { videosFile, fakeResponsesFile: values.get("--fake-responses") ?? null, reportFile: values.get("--report") ?? null, model, limit } };
}

/** True when `candidate` resolves to `root` itself or somewhere beneath it (after resolving "..", on any platform). */
export function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(root, candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Estimate

/** Anthropic first-party prices in US dollars per million tokens (claude-api reference, cached 2026-11-03). The Batch API charges half. */
export const MODEL_PRICES: Record<string, { input: number; output: number }> = {
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
};
export const BATCH_DISCOUNT = 0.5;

/**
 * A deliberately conservative local token estimate: one token per 3 characters. Current Claude tokenizers produce roughly one token per 3 to 4
 * characters of English; erring high keeps the printed cost an upper-side figure. The real count (the token-counting endpoint) is a later
 * milestone, because this one makes no API call at all.
 */
export const CHARS_PER_TOKEN = 3;
export const estimateTokens = (text: string): number => Math.ceil(text.length / CHARS_PER_TOKEN);

/** Output per video, including thinking: typical at low effort, and a high case. Assumptions, to be replaced by measured usage after a pilot. */
export const OUTPUT_TOKENS_PER_VIDEO = { typical: 1_500, high: 3_000 } as const;

export interface VideoCreditsEstimate {
  model: string;
  videosToSend: number;
  fixedInputTokensPerVideo: number;
  inputTokens: number;
  typical: { outputTokens: number; cost: number; batchCost: number };
  high: { outputTokens: number; cost: number; batchCost: number };
}

export function estimateVideoCreditsCost(videos: readonly VideoCreditsSource[], model: string): VideoCreditsEstimate {
  const price = MODEL_PRICES[model];
  const fixed = estimateTokens(VIDEO_CREDITS_SYSTEM_INSTRUCTIONS_V1) + estimateTokens(JSON.stringify(VIDEO_CREDITS_OUTPUT_SCHEMA_V1));
  const sent = videos.filter((v) => videoSkipReason(v) === null);
  const inputTokens = sent.reduce((sum, v) => sum + fixed + estimateTokens(JSON.stringify({ context: buildVideoCreditsContext(v) })), 0);
  const scenario = (perVideo: number) => {
    const outputTokens = perVideo * sent.length;
    const cost = (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
    return { outputTokens, cost, batchCost: cost * BATCH_DISCOUNT };
  };
  return { model, videosToSend: sent.length, fixedInputTokensPerVideo: fixed, inputTokens, typical: scenario(OUTPUT_TOKENS_PER_VIDEO.typical), high: scenario(OUTPUT_TOKENS_PER_VIDEO.high) };
}

const dollars = (n: number) => `$${n.toFixed(n < 1 ? 3 : 2)}`;
const count = (n: number) => n.toLocaleString("en-US");

export function formatEstimate(estimate: VideoCreditsEstimate): string[] {
  const lines = [
    `Estimate for ${estimate.model} (${VIDEO_CREDITS_PROMPT_V1}; local estimate at ${CHARS_PER_TOKEN} characters per token, no API call):`,
    `  Videos that would be sent:  ${estimate.videosToSend}`,
    `  Input tokens:               ${count(estimate.inputTokens)} (instructions and schema ${count(estimate.fixedInputTokensPerVideo)} per video, plus each video's text)`,
    `  Typical (${count(OUTPUT_TOKENS_PER_VIDEO.typical)} output/video): ${count(estimate.typical.outputTokens)} output tokens, ${dollars(estimate.typical.cost)} standard, ${dollars(estimate.typical.batchCost)} Batch API`,
    `  High    (${count(OUTPUT_TOKENS_PER_VIDEO.high)} output/video): ${count(estimate.high.outputTokens)} output tokens, ${dollars(estimate.high.cost)} standard, ${dollars(estimate.high.batchCost)} Batch API`,
  ];
  return lines;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Summary and report

export interface VideoCreditsTotals {
  videos: number;
  skipped: Record<string, number>;
  extracted: number;
  providerFailed: number;
  invalidOutput: number;
  creditsAccepted: number;
  creditsRejected: number;
  rejectionReasons: Record<string, number>;
}

export function totalVideoCredits(outcomes: readonly VideoCreditsOutcome[]): VideoCreditsTotals {
  const totals: VideoCreditsTotals = { videos: outcomes.length, skipped: {}, extracted: 0, providerFailed: 0, invalidOutput: 0, creditsAccepted: 0, creditsRejected: 0, rejectionReasons: {} };
  const bump = (bucket: Record<string, number>, key: string) => (bucket[key] = (bucket[key] ?? 0) + 1);
  for (const o of outcomes) {
    if (o.status === "SKIPPED") bump(totals.skipped, o.skipReason);
    else if (o.status === "PROVIDER_FAILED") totals.providerFailed++;
    else if (o.status === "INVALID_OUTPUT") totals.invalidOutput++;
    else {
      totals.extracted++;
      totals.creditsAccepted += o.result.accepted.length;
      totals.creditsRejected += o.result.rejected.length;
      for (const r of o.result.rejected) bump(totals.rejectionReasons, `credit:${r.reason}`);
      for (const [name, value] of [["performanceDate", o.result.performanceDate], ["venueType", o.result.venueType], ["suggestedTitle", o.result.suggestedTitle], ["recordingKind", o.result.recordingKind]] as const) {
        if (value.status === "REJECTED") bump(totals.rejectionReasons, `${name}:${value.reason}`);
      }
    }
  }
  return totals;
}

const shown = (s: string | null, max = 60) => {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

export function formatOutcome(o: VideoCreditsOutcome): string[] {
  const head = `  ${o.youtubeVideoId}  ${shown(o.title, 50)}`;
  switch (o.status) {
    case "SKIPPED":
      return [`${head}\n    SKIPPED (${o.skipReason}), no provider call`];
    case "PROVIDER_FAILED":
      return [`${head}\n    PROVIDER_FAILED ${o.errorType}: ${o.errorMessage}`];
    case "INVALID_OUTPUT":
      return [`${head}\n    INVALID_OUTPUT: ${o.problems.slice(0, 3).join(" ")}`];
    case "EXTRACTED": {
      const r = o.result;
      const lines = [`${head}\n    EXTRACTED: ${r.accepted.length} credit(s) accepted, ${r.rejected.length} rejected`];
      for (const c of r.accepted) lines.push(`      + ${c.role.padEnd(10)} ${shown(c.name, 45)}${c.workTitle ? ` [${shown(c.workTitle, 30)}]` : ""}  <- ${c.field}: "${shown(c.quote, 50)}"`);
      for (const { credit, reason } of r.rejected) lines.push(`      - ${credit.role.padEnd(10)} ${shown(credit.name, 45)}  REJECTED ${reason}`);
      for (const [name, value] of [["recordingKind", r.recordingKind], ["performanceDate", r.performanceDate], ["venueType", r.venueType], ["suggestedTitle", r.suggestedTitle]] as const) {
        if (value.status === "ACCEPTED") lines.push(`      ${name}: ${value.value} (quoted)`);
        else if (value.status === "REJECTED") lines.push(`      ${name}: ${value.value} REJECTED ${value.reason}`);
      }
      for (const g of r.gaps.slice(0, 5)) lines.push(`      gap: ${shown(g.missing, 40)} (${shown(g.reason, 60)})`);
      return lines;
    }
  }
}

export function formatTotals(t: VideoCreditsTotals): string[] {
  const skipped = Object.entries(t.skipped).map(([k, v]) => `${k}=${v}`).join(", ") || "none";
  const reasons = Object.entries(t.rejectionReasons).sort().map(([k, v]) => `${k}=${v}`).join(", ") || "none";
  return [
    `Videos: ${t.videos} (extracted ${t.extracted}, skipped ${Object.values(t.skipped).reduce((a, b) => a + b, 0)} [${skipped}], provider failures ${t.providerFailed}, invalid output ${t.invalidOutput})`,
    `Credits: ${t.creditsAccepted} accepted, ${t.creditsRejected} rejected`,
    `Rejections by reason: ${reasons}`,
  ];
}

export interface VideoCreditsReport {
  kind: "video-credits-dry-run";
  generatedAt: string;
  promptVersion: string;
  provider: "fake";
  estimateModel: string;
  input: { videosFile: string; fakeResponsesFile: string | null; limit: number | null };
  estimate: VideoCreditsEstimate;
  totals: VideoCreditsTotals;
  videos: VideoCreditsOutcome[];
}

export function buildVideoCreditsReport(input: {
  generatedAt: Date;
  args: VideoCreditsRunnerArgs;
  estimate: VideoCreditsEstimate;
  outcomes: VideoCreditsOutcome[];
}): VideoCreditsReport {
  return {
    kind: "video-credits-dry-run",
    generatedAt: input.generatedAt.toISOString(),
    promptVersion: VIDEO_CREDITS_PROMPT_V1,
    provider: "fake",
    estimateModel: input.args.model,
    input: { videosFile: input.args.videosFile, fakeResponsesFile: input.args.fakeResponsesFile, limit: input.args.limit },
    estimate: input.estimate,
    totals: totalVideoCredits(input.outcomes),
    videos: input.outcomes,
  };
}

/** reports/video-credits/video-credits-<timestamp>.json, relative to the repository root. */
export const defaultReportPath = (generatedAt: Date): string =>
  path.join("reports", "video-credits", `video-credits-${generatedAt.toISOString().replace(/[:.]/g, "-")}.json`);
