// Research-assisted content, step 2: PROSE DRAFTS from accepted claims and approved credits only. PURE (no fs, no network, no database, no API);
// scripts/draftVideoDescriptions.ts reads the sheets and writes describe-drafts.csv, the local prompt file and the audit log.
//
// The content guardrails (docs/content-guardrails.md, modules/mmke/guardrails) decide which claims may be written:
//   gate 1 (sources)  each row's source tier (A/B/C/X); claims about the same subject with the same value pool their sources, independent ones
//                     counting once; a claim below its type's minimum evidence is WEAK;
//   gate 2 (claims)   only `accept`, or `edit` with an editedClaim, AND a named approver; never a flagged row; a fan-site source needs a note; a claim
//                     that conflicts with the video's approved credits or with another live claim is BLOCKED until a person resolves it (code never
//                     picks a side); stale and malformed claims are blocked;
//   gate 3 (generation) the context paragraph is built from the usable claims' own sentences, each with its citation number; a WEAK claim is
//                     written with attribution ("…, according to <source> [n]."), never as plain fact; the paragraph is then checked by
//                     checkTraceability, and any problem is reported in the draft's notes.
// The rest of the text is the credits template (modules/jobs/videoCreditsDescribe.ts). A claim that only MATCHES the video's credits is cited as
// corroboration, not repeated. Approved credits are cited as [V] (the video's own YouTube text, or the editor for basis 4).

import { csvRecords, type VideoFacts } from "./videoCreditsApproved";
import { ARCHIVE_SENTENCE, INVITATION, draftDescription } from "./videoCreditsDescribe";
import { CLAIMS_HEADER } from "./videoResearch";
import { toCsv } from "./videoCreditsReview";
import { fold } from "../mmke/guardrails/text";
import { SOURCE_TIERS, type EvidenceSource, type SourceTier } from "../mmke/guardrails/sources";
import { assessClaims, type ClaimStatus, type GuardedClaim } from "../mmke/guardrails/claims";
import { checkTraceability, findBannedPhrases, type CitableClaim } from "../mmke/guardrails/generation";
import type { ClaimDecisionRow } from "../mmke/guardrails/audit";
import type { VideoDescriptionPromptInput } from "../ai/prompts/videoDescription/videoDescriptionPromptV1";

export interface UsableClaim {
  claimId: string;
  youtubeVideoId: string;
  subjectKind: string;
  claim: string;
  value: string;
  excerpt: string;
  sourceUrl: string;
  sourceTitle: string;
  sourceStrength: string;
  sourceTier: SourceTier;
  relation: string;
  /** Below the minimum evidence for its type: written only with attribution. */
  weak: boolean;
  evidence: string;
}

export interface BlockedClaim {
  claimId: string;
  youtubeVideoId: string;
  reason: string;
}

export interface ClaimSheetAssessment {
  usable: UsableClaim[];
  blocked: BlockedClaim[];
  ignored: number;
  problems: string[];
  /** Every row's decision and approver, for the audit log (gate 5). */
  decisions: ClaimDecisionRow[];
}

/** Gates 1 and 2 over research-claims.csv as the editor left it. */
export function assessClaimSheet(claimsCsv: string, now: Date): ClaimSheetAssessment {
  const sheet = csvRecords(claimsCsv, CLAIMS_HEADER, "research-claims.csv");
  if (!sheet.ok) return { usable: [], blocked: [], ignored: 0, problems: [`${sheet.problem} (rebuild it with npm run ai:video-research-sheet; decisions are kept)`], decisions: [] };
  const rows = sheet.rows.filter((r) => r.subjectKind !== "research gap");
  const decisionOf = (r: Record<string, string>) => (r.decision ?? "").trim().toLowerCase();
  const blocked: BlockedClaim[] = [];
  const preBlocked = new Set<string>();
  let ignored = 0;

  for (const r of rows) {
    const d = decisionOf(r);
    const block = (reason: string) => {
      blocked.push({ claimId: r.claimId, youtubeVideoId: r.youtubeVideoId, reason });
      preBlocked.add(r.claimId);
    };
    if (d === "" || d === "defer" || d === "reject") {
      ignored++;
      continue;
    }
    if (d !== "accept" && d !== "edit") block(`unknown decision "${r.decision}" (use accept, edit, reject or defer).`);
    else if (d === "edit" && !(r.editedClaim ?? "").trim()) block("edit needs an editedClaim.");
    else if (!(r.approver ?? "").trim()) block("no approver: an accepted claim needs the name of the person who approved it.");
    else if ((r.flags ?? "").trim()) block(`flagged: ${r.flags}. A flagged claim cannot be used; ask for a better source.`);
    else if (r.sourceStrength === "fan site" && !(r.editorNotes ?? "").trim()) block("a fan-site source needs an editor note.");
    else if ((r.videoTextRelation ?? "").startsWith("CONFLICTS")) block(`unresolved conflict with the video's approved credits (${r.videoTextRelation}); correct review-credits.csv or reject the claim. Code never chooses.`);
  }

  // Gate 2 over every live row (rejected rows take part, so a conflict an editor resolved by rejecting one side no longer blocks the other).
  const statusOf = (r: Record<string, string>): ClaimStatus => {
    const d = decisionOf(r);
    if (d === "reject") return "rejected";
    if (d === "defer") return "deferred";
    return (d === "accept" || d === "edit") && (r.approver ?? "").trim() && !preBlocked.has(r.claimId) ? "accepted" : "proposed";
  };
  const tierOf = (r: Record<string, string>): SourceTier => ((SOURCE_TIERS as readonly string[]).includes(r.sourceTier) ? (r.sourceTier as SourceTier) : "X");
  const sameSubject = (a: Record<string, string>, b: Record<string, string>) =>
    a.youtubeVideoId === b.youtubeVideoId && a.subjectKind === b.subjectKind && fold(a.workTitle ?? "") === fold(b.workTitle ?? "") && !!a.claimValue && fold(a.claimValue) === fold(b.claimValue ?? "");
  const guarded: GuardedClaim[] = rows.map((r) => {
    const status = statusOf(r);
    const own: EvidenceSource = { url: r.sourceUrl, tier: tierOf(r), excerpt: r.excerpt, approved: status === "accepted" };
    // Accepted claims stating the same value about the same subject corroborate each other (independence is checked by gate 1).
    const corroborating = rows.filter((o) => o !== r && statusOf(o) === "accepted" && sameSubject(r, o)).map((o) => ({ url: o.sourceUrl, tier: tierOf(o), excerpt: o.excerpt, approved: true }));
    return {
      claimId: r.claimId,
      youtubeVideoId: r.youtubeVideoId,
      subjectKind: r.subjectKind,
      workTitle: r.workTitle || null,
      value: r.claimValue || null,
      statement: (decisionOf(r) === "edit" ? r.editedClaim : r.claim).trim(),
      sources: [own, ...corroborating],
      status,
      approver: (r.approver ?? "").trim() || null,
      approvedAt: (r.approver ?? "").trim() ? now.toISOString() : null,
      retrievedAt: r.retrievedAt || null,
    };
  });
  const assessed = assessClaims(guarded, { now });

  const usable: UsableClaim[] = [];
  for (const a of assessed) {
    const r = rows.find((x) => x.claimId === a.claim.claimId)!;
    const d = decisionOf(r);
    if (d === "" || d === "defer" || d === "reject" || preBlocked.has(r.claimId)) continue;
    if (!a.usable) {
      blocked.push({ claimId: r.claimId, youtubeVideoId: r.youtubeVideoId, reason: a.reasons.join("; ") });
      continue;
    }
    usable.push({
      claimId: r.claimId,
      youtubeVideoId: r.youtubeVideoId,
      subjectKind: r.subjectKind,
      claim: a.claim.statement,
      value: r.claimValue ?? "",
      excerpt: r.excerpt ?? "",
      sourceUrl: r.sourceUrl,
      sourceTitle: r.sourceTitle,
      sourceStrength: r.sourceStrength,
      sourceTier: tierOf(r),
      relation: r.videoTextRelation,
      weak: a.weak,
      evidence: a.evidence.reason,
    });
  }
  const decisions = sheet.rows.filter((r) => r.subjectKind !== "research gap").map((r) => ({ claimId: r.claimId, decision: r.decision ?? "", approver: r.approver ?? "", status: r.status }));
  return { usable, blocked, ignored, problems: [], decisions };
}

export interface ProseDraft {
  youtubeVideoId: string;
  youtubeTitle: string;
  recordingTitle: string;
  draft: string;
  /** The context paragraph built from claims (the part gate 3 checks), or "" when there is none. */
  claimProse: string;
  citations: string[];
  claimsUsed: number;
  notes: string[];
}

const withoutEnd = (s: string) => s.trim().replace(/[.!?]$/, "");
const withPeriod = (s: string) => (/[.!?]["”’)]?$/.test(s) ? s : `${s}.`);
const sourceLabel = (c: UsableClaim) => c.sourceTitle || c.sourceUrl;

export function buildProseDraft(video: VideoFacts, claims: readonly UsableClaim[], options: { invitation?: boolean; heldReasons?: string[]; blocked?: readonly BlockedClaim[] } = {}): ProseDraft {
  const mine = claims.filter((c) => c.youtubeVideoId === video.youtubeVideoId);
  const citations: string[] = [`[V] The video's own YouTube title and description, and the editor (approved credits): https://www.youtube.com/watch?v=${video.youtubeVideoId}`];
  const sentences: string[] = [];
  const citable: CitableClaim[] = [];
  mine.forEach((c, i) => {
    const n = String(i + 1);
    const corroborates = c.relation === "matches the video";
    citations.push(`[${n}] ${sourceLabel(c)} — ${c.sourceUrl} (tier ${c.sourceTier}, ${c.sourceStrength}; ${c.claimId}${c.weak ? "; WEAK: attributed" : ""}${corroborates ? "; corroborates the video's credit" : ""})`);
    citable.push({ id: n, text: [c.claim, c.value, c.excerpt, sourceLabel(c)].join(" \n "), weak: c.weak });
    if (corroborates) return;
    sentences.push(c.weak ? `${withoutEnd(c.claim)}, according to ${sourceLabel(c)} [${n}].` : withPeriod(c.claim).replace(/([.!?]["”’)]?)$/, ` [${n}]$1`));
  });
  const claimProse = sentences.join(" ");
  const base = draftDescription(video, { invitation: options.invitation, heldReasons: options.heldReasons, extraContext: claimProse ? [claimProse] : [] });

  const notes = [...base.notes];
  if (claimProse) {
    const allowed = [video.approvedRecordingTitle ?? "", video.transliteration, "Music Madras", ...video.facts.map((f) => f.name)].filter(Boolean);
    for (const p of checkTraceability(claimProse, citable, { boilerplate: [ARCHIVE_SENTENCE, INVITATION], allowed })) notes.push(`GUARDRAIL (gate 3): "${p.sentence.slice(0, 80)}": ${p.problem}`);
  }
  for (const b of findBannedPhrases(base.draft)) notes.push(`GUARDRAIL (gate 3): banned wording "${b}"`);
  const blocked = (options.blocked ?? []).filter((r) => r.youtubeVideoId === video.youtubeVideoId);
  for (const r of blocked) notes.push(`claim ${r.claimId} not used: ${r.reason}`);
  return { youtubeVideoId: video.youtubeVideoId, youtubeTitle: video.youtubeTitle, recordingTitle: base.recordingTitle, draft: base.draft, claimProse, citations, claimsUsed: mine.length, notes };
}

/** The data block a model would receive for one video: approved credits (C1, ...) and usable claims ([1], ...), nothing else. */
export function promptInputFor(video: VideoFacts, claims: readonly UsableClaim[]): VideoDescriptionPromptInput {
  const works = video.facts.filter((f) => f.kind === "work");
  return {
    youtubeVideoId: video.youtubeVideoId,
    title: video.approvedRecordingTitle ?? (works.length === 1 ? works[0].name : works.map((w) => w.name).join(" / ")),
    transliteration: video.transliterationApproved && video.transliteration ? video.transliteration : null,
    approvedCredits: video.facts.map((f, i) => ({ id: `C${i + 1}`, role: f.kind, name: f.name, workTitle: f.workTitle || null })),
    acceptedClaims: claims
      .filter((c) => c.youtubeVideoId === video.youtubeVideoId)
      .map((c, i) => ({ id: `[${i + 1}]`, claim: c.claim, source: c.sourceUrl, sourceTitle: sourceLabel(c), sourceStrength: c.sourceStrength, sourceTier: c.sourceTier, weak: c.weak })),
  };
}

export const DRAFTS_HEADER = ["youtubeVideoId", "youtubeUrl", "youtubeTitle", "recordingTitle", "claimsUsed", "draftDescription", "citations", "notes", "decision", "editedDescription", "editorNotes"] as const;

export function proseDraftsToCsv(drafts: readonly ProseDraft[]): string {
  return toCsv(
    DRAFTS_HEADER,
    drafts.map((d) => [d.youtubeVideoId, `https://www.youtube.com/watch?v=${d.youtubeVideoId}`, d.youtubeTitle, d.recordingTitle, d.claimsUsed, d.draft, d.citations.join("\n"), d.notes.join(" | "), "", "", ""])
  );
}
