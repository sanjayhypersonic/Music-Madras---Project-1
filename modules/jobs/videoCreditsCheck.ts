// Credits extraction, route 2: the PURE parts of scripts/checkVideoCreditsProposals.ts. No fs, no network, no database.
//
// A proposals file is written by a person or a Claude Code session that read an export file (docs/video-credits-manual-workflow.md). It is a JSON
// array with one object per video: the video-credits-v1 output schema plus `youtubeVideoId`. Each proposal is checked with exactly the validators
// the API route uses (modules/ai/structuredOutput/validateVideoCreditsOutput.ts) against the title and description IN THE EXPORT, so a quotation
// must occur in the text the session was given. Proposals for videos that are not in the export are rejected, as are a second proposal for the
// same video and anything that is not an object with a video id.

import { normaliseEvidenceText } from "../mmke/provenance/verbatimEvidence";
import { videoCreditsFingerprint, type VideoCreditsOutcome } from "../ai/gateway/extractVideoCredits";
import { validateVideoCreditsOutput, type VideoCredit } from "../ai/structuredOutput/validateVideoCreditsOutput";
import { VIDEO_CREDIT_ROLES, VIDEO_CREDITS_PROMPT_V1, type VideoCreditRole } from "../ai/prompts/videoCredits/videoCreditsPromptV1";
import { totalVideoCredits, type VideoCreditsTotals } from "./videoCreditsRunner";
import type { ExportedVideo } from "./videoCreditsExport";
import path from "path";

export const VIDEO_CREDITS_CHECK_EXIT_CODES = { SUCCEEDED: 0, FAILED: 2, REFUSED: 4 } as const;

/** The checker records who produced the proposals as "manual": a person or a Claude Code session, not an API call. */
export const MANUAL_PROVIDER = "manual";

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Arguments

export interface VideoCreditsCheckArgs {
  exportFile: string;
  proposalsFile: string;
  reportFile: string | null;
}

const FLAGS = new Set(["--export", "--proposals", "--report"]);

export function parseVideoCreditsCheckArgs(argv: readonly string[]): { ok: true; args: VideoCreditsCheckArgs } | { ok: false; error: string } {
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (!FLAGS.has(flag)) return { ok: false, error: `Unknown argument "${flag}".` };
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) return { ok: false, error: `${flag} needs a value.` };
    values.set(flag, value);
    i++;
  }
  const exportFile = values.get("--export");
  const proposalsFile = values.get("--proposals");
  if (!exportFile || !proposalsFile) return { ok: false, error: "--export <file> and --proposals <file> are both required." };
  return { ok: true, args: { exportFile, proposalsFile, reportFile: values.get("--report") ?? null } };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Inputs

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const nullableString = (v: unknown) => v === null || v === undefined || typeof v === "string";

/** Reads an export file (or any object with a `videos` list of the same shape). */
export function parseExportFile(raw: unknown): { ok: true; videos: ExportedVideo[] } | { ok: false; problems: string[] } {
  if (!isObject(raw) || !Array.isArray(raw.videos)) return { ok: false, problems: ["The export file must be an object with a `videos` list."] };
  const problems: string[] = [];
  const videos: ExportedVideo[] = [];
  const seen = new Set<string>();
  raw.videos.forEach((v, i) => {
    if (!isObject(v) || typeof v.youtubeVideoId !== "string" || v.youtubeVideoId.length === 0 || !nullableString(v.title) || !nullableString(v.description)) {
      problems.push(`videos[${i}]: needs youtubeVideoId, and title and description as text or null.`);
      return;
    }
    if (seen.has(v.youtubeVideoId)) {
      problems.push(`videos[${i}]: ${v.youtubeVideoId} appears twice.`);
      return;
    }
    seen.add(v.youtubeVideoId);
    videos.push({
      youtubeVideoId: v.youtubeVideoId,
      title: (v.title as string | null | undefined) ?? null,
      description: (v.description as string | null | undefined) ?? null,
      publishedAt: typeof v.publishedAt === "string" ? v.publishedAt : null,
      playlistTitles: Array.isArray(v.playlistTitles) ? v.playlistTitles.filter((t): t is string => typeof t === "string") : [],
    });
  });
  return problems.length > 0 ? { ok: false, problems } : { ok: true, videos };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Checking

export type ProposalRejectionReason = "NOT_AN_OBJECT" | "MISSING_VIDEO_ID" | "VIDEO_NOT_IN_EXPORT" | "DUPLICATE_PROPOSAL";

export interface ProposalRejection {
  index: number;
  youtubeVideoId: string | null;
  reason: ProposalRejectionReason;
}

export interface VideoCreditsCheckResult {
  /** One per accepted proposal: EXTRACTED (checked) or INVALID_OUTPUT (malformed shape), as the API route reports them. */
  outcomes: VideoCreditsOutcome[];
  /** Proposals that were not checked at all. */
  proposalRejections: ProposalRejection[];
  /** Videos in the export that no proposal covers. */
  videosWithoutProposal: string[];
}

export function checkVideoCreditsProposals(videos: readonly ExportedVideo[], proposals: unknown): { ok: true; result: VideoCreditsCheckResult } | { ok: false; error: string } {
  if (!Array.isArray(proposals)) return { ok: false, error: "The proposals file must be a JSON array with one object per video." };
  const byId = new Map(videos.map((v) => [v.youtubeVideoId, v]));
  const covered = new Set<string>();
  const outcomes: VideoCreditsOutcome[] = [];
  const proposalRejections: ProposalRejection[] = [];

  proposals.forEach((proposal, index) => {
    if (!isObject(proposal)) return proposalRejections.push({ index, youtubeVideoId: null, reason: "NOT_AN_OBJECT" });
    const id = proposal.youtubeVideoId;
    if (typeof id !== "string" || id.length === 0) return proposalRejections.push({ index, youtubeVideoId: null, reason: "MISSING_VIDEO_ID" });
    const video = byId.get(id);
    if (!video) return proposalRejections.push({ index, youtubeVideoId: id, reason: "VIDEO_NOT_IN_EXPORT" });
    if (covered.has(id)) return proposalRejections.push({ index, youtubeVideoId: id, reason: "DUPLICATE_PROPOSAL" });
    covered.add(id);

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { youtubeVideoId: _id, ...output } = proposal;
    const checked = validateVideoCreditsOutput(output, video);
    const base = { youtubeVideoId: id, title: video.title, provider: MANUAL_PROVIDER, model: VIDEO_CREDITS_PROMPT_V1 };
    outcomes.push(
      checked.ok
        ? { ...base, status: "EXTRACTED", contextFingerprint: videoCreditsFingerprint(video), result: checked }
        : { ...base, status: "INVALID_OUTPUT", problems: checked.problems }
    );
  });

  return { ok: true, result: { outcomes, proposalRejections, videosWithoutProposal: videos.filter((v) => !covered.has(v.youtubeVideoId)).map((v) => v.youtubeVideoId) } };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Summaries

export type RoleSummary = Record<VideoCreditRole, { accepted: number; rejected: number }>;

export function summariseByRole(outcomes: readonly VideoCreditsOutcome[]): RoleSummary {
  const summary = Object.fromEntries(VIDEO_CREDIT_ROLES.map((r) => [r, { accepted: 0, rejected: 0 }])) as RoleSummary;
  for (const o of outcomes) {
    if (o.status !== "EXTRACTED") continue;
    for (const c of o.result.accepted) summary[c.role].accepted++;
    for (const r of o.result.rejected) if (summary[r.credit.role]) summary[r.credit.role].rejected++;
  }
  return summary;
}

export interface ProposedName {
  role: VideoCreditRole;
  /** The most frequent spelling (ties: first seen). */
  name: string;
  /** Every spelling grouped under this name: they differ only in letter case or white space. */
  spellings: string[];
  videoCount: number;
  youtubeVideoIds: string[];
}

/** Grouping key: role + name with invisible characters and white space normalised and letter case folded. Nothing fuzzier. */
const nameKey = (role: string, name: string) => `${role}\u0000${normaliseEvidenceText(name).toLocaleLowerCase("en")}`;

/**
 * The unique ACCEPTED names per role, for a names-first review: each new person, choir, ensemble, venue or work is decided once, not once per video.
 * Names that differ beyond letter case and white space ("The Chennai Chorale" / "Chennai Chorale") stay separate on purpose; merging them is the
 * reviewer's decision.
 */
export function uniqueProposedNames(outcomes: readonly VideoCreditsOutcome[]): ProposedName[] {
  const groups = new Map<string, { role: VideoCreditRole; counts: Map<string, number>; videos: Set<string> }>();
  for (const o of outcomes) {
    if (o.status !== "EXTRACTED") continue;
    for (const c of o.result.accepted as VideoCredit[]) {
      const key = nameKey(c.role, c.name);
      const g = groups.get(key) ?? { role: c.role, counts: new Map<string, number>(), videos: new Set<string>() };
      const spelling = normaliseEvidenceText(c.name);
      g.counts.set(spelling, (g.counts.get(spelling) ?? 0) + 1);
      g.videos.add(o.youtubeVideoId);
      groups.set(key, g);
    }
  }
  const roleOrder = new Map(VIDEO_CREDIT_ROLES.map((r, i) => [r, i]));
  return [...groups.values()]
    .map((g) => {
      const spellings = [...g.counts.entries()];
      const name = spellings.reduce((best, cur) => (cur[1] > best[1] ? cur : best))[0];
      return { role: g.role, name, spellings: spellings.map(([s]) => s), videoCount: g.videos.size, youtubeVideoIds: [...g.videos].sort() };
    })
    .sort((a, b) => (roleOrder.get(a.role) ?? 0) - (roleOrder.get(b.role) ?? 0) || b.videoCount - a.videoCount || a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Report

export interface VideoCreditsCheckReport {
  kind: "video-credits-check";
  generatedAt: string;
  promptVersion: string;
  provider: typeof MANUAL_PROVIDER;
  input: { exportFile: string; proposalsFile: string; videosInExport: number; proposals: number };
  totals: VideoCreditsTotals & { proposalsRejected: number; videosWithoutProposal: number };
  byRole: RoleSummary;
  proposedNames: ProposedName[];
  proposalRejections: ProposalRejection[];
  videosWithoutProposal: string[];
  videos: VideoCreditsOutcome[];
}

export function buildVideoCreditsCheckReport(input: {
  generatedAt: Date;
  args: VideoCreditsCheckArgs;
  videosInExport: number;
  proposals: number;
  result: VideoCreditsCheckResult;
}): VideoCreditsCheckReport {
  const { result } = input;
  return {
    kind: "video-credits-check",
    generatedAt: input.generatedAt.toISOString(),
    promptVersion: VIDEO_CREDITS_PROMPT_V1,
    provider: MANUAL_PROVIDER,
    input: { exportFile: input.args.exportFile, proposalsFile: input.args.proposalsFile, videosInExport: input.videosInExport, proposals: input.proposals },
    totals: { ...totalVideoCredits(result.outcomes), proposalsRejected: result.proposalRejections.length, videosWithoutProposal: result.videosWithoutProposal.length },
    byRole: summariseByRole(result.outcomes),
    proposedNames: uniqueProposedNames(result.outcomes),
    proposalRejections: result.proposalRejections,
    videosWithoutProposal: result.videosWithoutProposal,
    videos: result.outcomes,
  };
}

export function formatCheckSummary(report: VideoCreditsCheckReport): string[] {
  const lines = ["By role (accepted / rejected):"];
  for (const role of VIDEO_CREDIT_ROLES) {
    const s = report.byRole[role];
    if (s.accepted + s.rejected > 0) lines.push(`  ${role.padEnd(10)} ${String(s.accepted).padStart(4)} / ${s.rejected}`);
  }
  lines.push(`Unique proposed names (${report.proposedNames.length}), for a names-first review:`);
  for (const n of report.proposedNames) {
    lines.push(`  ${n.role.padEnd(10)} ${n.name}  — ${n.videoCount} video${n.videoCount === 1 ? "" : "s"}${n.spellings.length > 1 ? `; spellings: ${n.spellings.join(" | ")}` : ""}`);
  }
  if (report.proposalRejections.length > 0) {
    lines.push("Proposals not checked:");
    for (const r of report.proposalRejections) lines.push(`  #${r.index} ${r.youtubeVideoId ?? "(no video id)"}  ${r.reason}`);
  }
  if (report.videosWithoutProposal.length > 0) lines.push(`Videos in the export with no proposal: ${report.videosWithoutProposal.join(", ")}`);
  return lines;
}

/** reports/video-credits/check-<timestamp>.json, relative to the repository root. */
export const defaultCheckReportPath = (generatedAt: Date): string => path.join("reports", "video-credits", `check-${generatedAt.toISOString().replace(/[:.]/g, "-")}.json`);
