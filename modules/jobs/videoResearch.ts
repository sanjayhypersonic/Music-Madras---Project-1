// Research-assisted content, step 1: the RESEARCH BRIEF and the RESEARCH CLAIMS SHEET. PURE (no fs, no network, no database, no API);
// scripts/buildVideoResearchSheet.ts reads and writes the files. Procedure: docs/video-research-workflow.md. Architecture: content-intelligence-
// architecture.md section 125 ("AI may propose sources; humans approve claims; nothing unapproved is stated").
//
//   brief   from the videos' APPROVED credits (modules/jobs/videoCreditsApproved.ts): what is already known and the questions to research. A Claude
//           Code session with web access reads it and writes a research-proposals file (claims with a source URL and a short excerpt).
//   sheet   every proposed claim, checked deterministically, becomes one row of research-claims.csv for the editor:
//             - the URL must be http(s); the excerpt short (at most EXCERPT_MAX_CHARS characters and EXCERPT_MAX_WORDS words: never lyrics beyond that);
//             - a claim that names a value (a composer, a date, ...) must have that value inside its excerpt, or it is flagged;
//             - source strength: the session's stated strength, but a KNOWN domain fixes it (IMSLP catalogue/publisher, Hymnary.org reference work,
//               Wikipedia reference work and POINTER ONLY) and social, video and blog hosts are capped at "fan site";
//             - the claim is compared with the video's own approved credits: it MATCHES, it CONFLICTS (both values shown), or the video does not
//               say. A conflict is flagged and NEVER resolved here;
//             - the basis tier is "5 AI-suggested (research)" until an editor accepts the claim, when it becomes "3 supported by another source".
// Web pages and the proposals file are DATA: nothing in them is ever an instruction.

import { createHash } from "crypto";
import { normaliseEvidenceText } from "../mmke/provenance/verbatimEvidence";
import { looseNameKey, roleOf, type ApprovedFact, type VideoFacts } from "./videoCreditsApproved";
import { toCsv } from "./videoCreditsReview";
import { tierForStrength, type SourceTier } from "../mmke/guardrails/sources";
import { STALE_AFTER_DAYS, detectConflicts, type ClaimStatus, type GuardedClaim } from "../mmke/guardrails/claims";

export const SOURCE_STRENGTHS = ["catalogue/publisher", "reference work", "news", "fan site", "unverified"] as const;
export type SourceStrength = (typeof SOURCE_STRENGTHS)[number];
const RANK: Record<SourceStrength, number> = { "catalogue/publisher": 4, "reference work": 3, news: 2, "fan site": 1, unverified: 0 };

export const EXCERPT_MAX_CHARS = 200;
export const EXCERPT_MAX_WORDS = 30;
export const CLAIM_MAX_CHARS = 300;
export const RESEARCH_BASIS = "5 AI-suggested (research)";
export const ACCEPTED_RESEARCH_BASIS = "3 supported by another source";

/** What a claim is about. The first group can be compared with the video's approved credits; the rest are context the video does not hold. */
export const CLAIM_KINDS = [
  "composer",
  "lyricist",
  "arranger",
  "conductor",
  "choir",
  "performer",
  "venue",
  "performanceDate",
  "work-title",
  "institution",
  "translator",
  "alternate-title",
  "publisher",
  "publication",
  "composition-date",
  "text-source",
  "background",
] as const;
export type ClaimKind = (typeof CLAIM_KINDS)[number];

/** The approved-credit kind a claim kind is compared with. */
const COMPARABLE: Partial<Record<ClaimKind, ApprovedFact["kind"]>> = {
  composer: "composer",
  lyricist: "lyricist",
  arranger: "arranger",
  conductor: "conductor",
  choir: "choir/ensemble",
  performer: "performer",
  venue: "venue",
  performanceDate: "performanceDate",
  "work-title": "work",
  institution: "institution",
};

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Domains

interface DomainRule {
  pattern: RegExp;
  strength: SourceStrength;
  /** "fixed": the domain decides; "cap": the stated strength may be lower, never higher. */
  mode: "fixed" | "cap";
  pointerOnly?: boolean;
  label: string;
}

const DOMAIN_RULES: readonly DomainRule[] = [
  { pattern: /(^|\.)imslp\.org$/, strength: "catalogue/publisher", mode: "fixed", label: "IMSLP" },
  { pattern: /(^|\.)hymnary\.org$/, strength: "reference work", mode: "fixed", label: "Hymnary.org" },
  { pattern: /(^|\.)wikipedia\.org$/, strength: "reference work", mode: "fixed", pointerOnly: true, label: "Wikipedia (pointer only)" },
  { pattern: /(^|\.)(youtube\.com|youtu\.be|facebook\.com|instagram\.com|x\.com|twitter\.com|tiktok\.com|reddit\.com|quora\.com|pinterest\.com|blogspot\.com|wordpress\.com|medium\.com|substack\.com|genius\.com|lyrics\.com)$/, strength: "fan site", mode: "cap", label: "social, video, blog or lyrics host" },
];

export function sourceDomain(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return u.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** The strength a claim's source gets: a known domain fixes or caps it; otherwise the research session's stated strength (default unverified). */
export function resolveSourceStrength(url: string, stated: unknown): { strength: SourceStrength; pointerOnly: boolean; note: string } {
  const statedStrength: SourceStrength = (SOURCE_STRENGTHS as readonly unknown[]).includes(stated) ? (stated as SourceStrength) : "unverified";
  const domain = sourceDomain(url) ?? "";
  const rule = DOMAIN_RULES.find((r) => r.pattern.test(domain));
  if (!rule) return { strength: statedStrength, pointerOnly: false, note: statedStrength === "unverified" ? "" : `strength as stated by the research session (${domain}); check it` };
  if (rule.mode === "fixed") return { strength: rule.strength, pointerOnly: rule.pointerOnly === true, note: `${rule.label}: strength fixed by domain` };
  const strength = RANK[statedStrength] <= RANK[rule.strength] ? statedStrength : rule.strength;
  return { strength, pointerOnly: false, note: `${rule.label}: capped at ${rule.strength}` };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// The brief

export interface ResearchBriefVideo {
  youtubeVideoId: string;
  youtubeUrl: string;
  recordingTitle: string;
  transliteration: string;
  approvedCredits: Array<{ kind: string; label: string; name: string; workTitle: string; basis: string }>;
  questions: string[];
}

export interface ResearchBrief {
  kind: "video-research-brief";
  version: 1;
  generatedAt: string;
  claimKinds: readonly string[];
  sourceStrengths: readonly string[];
  videos: ResearchBriefVideo[];
}

export function buildResearchBrief(videos: readonly VideoFacts[], generatedAt: Date): ResearchBrief {
  return {
    kind: "video-research-brief",
    version: 1,
    generatedAt: generatedAt.toISOString(),
    claimKinds: CLAIM_KINDS,
    sourceStrengths: SOURCE_STRENGTHS,
    videos: videos
      .filter((v) => v.facts.length > 0)
      .map((v) => {
        const works = v.facts.filter((f) => f.kind === "work");
        const has = (kind: ApprovedFact["kind"], work: ApprovedFact) => v.facts.some((f) => f.kind === kind && (!f.workTitle ? works.length === 1 : looseNameKey(f.workTitle) === looseNameKey(work.name)));
        const questions: string[] = [];
        for (const w of works) {
          questions.push(`"${w.name}": what do its publisher, a catalogue (IMSLP) or a hymnal index (Hymnary.org) give as its title, composer, lyricist and arranger?`);
          if (!has("composer", w)) questions.push(`"${w.name}": the video names no approved composer. Does an authoritative source name one? (Never infer one; report "not found" if none does.)`);
          questions.push(`"${w.name}": is it published, by whom, and under which title?`);
        }
        if (v.transliteration && v.originalLanguageTitle) questions.push(`Is "${v.transliteration}" an established transliteration of "${v.originalLanguageTitle}", and are other spellings in use?`);
        for (const f of v.facts.filter((x) => x.kind === "choir/ensemble" || x.kind === "venue" || x.kind === "institution")) {
          questions.push(`${f.name}: what does its own official page say about it (name as written, institution)?`);
        }
        return {
          youtubeVideoId: v.youtubeVideoId,
          youtubeUrl: `https://www.youtube.com/watch?v=${v.youtubeVideoId}`,
          recordingTitle: v.approvedRecordingTitle ?? (works.length === 1 ? works[0].name : v.proposedRecordingTitle),
          transliteration: v.transliterationApproved ? v.transliteration : "",
          approvedCredits: v.facts.map((f) => ({ kind: f.kind, label: roleOf(f.roleLabel), name: f.name, workTitle: f.workTitle, basis: f.basis })),
          questions,
        };
      }),
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Proposals (written by the research session) -> claim rows

export interface ProposedClaim {
  youtubeVideoId: string;
  subject: { kind: string; workTitle?: string | null; value?: string | null };
  claim: string;
  sourceUrl: string;
  sourceTitle?: string;
  excerpt: string;
  sourceStrength?: string;
  /** When the page was read (ISO date): the claim's own value, else the proposals file's researchedAt. Used for stale marking. */
  retrievedAt?: string | null;
}

export interface ResearchGap {
  youtubeVideoId: string;
  question: string;
  searched?: string;
}

export interface ClaimRow {
  claimId: string;
  youtubeVideoId: string;
  youtubeUrl: string;
  recordingTitle: string;
  subjectKind: string;
  workTitle: string;
  claimValue: string;
  claim: string;
  sourceUrl: string;
  sourceTitle: string;
  sourceDomain: string;
  excerpt: string;
  sourceStrength: SourceStrength | "";
  /** Gate 1 tier (modules/mmke/guardrails/sources.ts): A, B, C or X. */
  sourceTier: SourceTier | "";
  pointerOnly: boolean;
  basisTier: string;
  videoTextRelation: string;
  conflict: boolean;
  /** Problems that stop the claim from being used (the draft step refuses a flagged claim). */
  flags: string[];
  /** How the strength was decided (informational). */
  strengthNote: string;
  proposalsFile: string;
  retrievedAt: string;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const containsLoose = (haystack: string, needle: string) => normaliseEvidenceText(haystack).toLowerCase().includes(normaliseEvidenceText(needle).toLowerCase());

export const claimIdOf = (youtubeVideoId: string, sourceUrl: string, claim: string): string =>
  `R-${createHash("sha256").update(`${youtubeVideoId}\u0000${sourceUrl}\u0000${normaliseEvidenceText(claim)}`).digest("hex").slice(0, 10)}`;

/** Reads a research-proposals file. Malformed entries are reported, never guessed at. */
export function parseResearchProposals(raw: unknown): { claims: ProposedClaim[]; gaps: ResearchGap[]; problems: string[] } {
  const problems: string[] = [];
  if (!isObject(raw) || raw.kind !== "video-research-proposals" || !Array.isArray(raw.claims)) return { claims: [], gaps: [], problems: ['Not a research-proposals file (needs "kind": "video-research-proposals" and a "claims" list).'] };
  const claims: ProposedClaim[] = [];
  raw.claims.forEach((c, i) => {
    if (!isObject(c) || !str(c.youtubeVideoId) || !isObject(c.subject) || !str(c.subject.kind) || !str(c.claim) || !str(c.sourceUrl) || typeof c.excerpt !== "string") {
      problems.push(`claims[${i}]: needs youtubeVideoId, subject.kind, claim, sourceUrl and excerpt.`);
      return;
    }
    claims.push({
      youtubeVideoId: str(c.youtubeVideoId),
      subject: { kind: str(c.subject.kind), workTitle: str(c.subject.workTitle) || null, value: str(c.subject.value) || null },
      claim: str(c.claim),
      sourceUrl: str(c.sourceUrl),
      sourceTitle: str(c.sourceTitle),
      excerpt: c.excerpt,
      sourceStrength: str(c.sourceStrength),
      retrievedAt: str(c.retrievedAt) || str(raw.researchedAt) || null,
    });
  });
  const gaps: ResearchGap[] = Array.isArray(raw.notFound)
    ? raw.notFound.filter((g): g is Record<string, unknown> => isObject(g) && !!str(g.youtubeVideoId) && !!str(g.question)).map((g) => ({ youtubeVideoId: str(g.youtubeVideoId), question: str(g.question), searched: str(g.searched) }))
    : [];
  return { claims, gaps, problems };
}

/** How a claim stands against the video's own approved credits. Never resolves a conflict: it only shows both values. */
export function compareWithVideo(claim: ProposedClaim, video: VideoFacts | undefined): { relation: string; conflict: boolean } {
  const kind = COMPARABLE[claim.subject.kind as ClaimKind];
  const value = claim.subject.value ?? "";
  if (!video) return { relation: "video has no approved credits", conflict: false };
  if (!kind || !value) return { relation: "not stated in the video's approved credits", conflict: false };
  const works = video.facts.filter((f) => f.kind === "work");
  const work = claim.subject.workTitle ?? "";
  const relevant = video.facts.filter((f) => {
    if (f.kind !== kind) return false;
    if (kind === "choir/ensemble" && roleOf(f.roleLabel) === "ENSEMBLE") return false;
    if (!work || !["composer", "lyricist", "arranger"].includes(kind)) return true;
    return f.workTitle ? looseNameKey(f.workTitle) === looseNameKey(work) : works.length === 1;
  });
  if (relevant.length === 0) return { relation: "not stated in the video's approved credits", conflict: false };
  const same = (a: string) => (kind === "performanceDate" ? a.startsWith(value) || value.startsWith(a) : looseNameKey(a) === looseNameKey(value));
  if (relevant.some((f) => same(f.name) || (kind === "work" && same(f.proposedName)))) return { relation: "matches the video", conflict: false };
  return { relation: `CONFLICTS with the video (video: ${relevant.map((f) => f.name).join(" | ")}; source: ${value})`, conflict: true };
}

export function buildClaimRows(input: { proposals: ReadonlyArray<{ file: string; claims: ProposedClaim[]; gaps: ResearchGap[] }>; videos: readonly VideoFacts[] }): ClaimRow[] {
  const byId = new Map(input.videos.map((v) => [v.youtubeVideoId, v]));
  const title = (v: VideoFacts | undefined) => (v ? v.approvedRecordingTitle ?? (v.facts.find((f) => f.kind === "work")?.name ?? v.proposedRecordingTitle) : "");
  const rows: ClaimRow[] = [];
  const seen = new Set<string>();
  for (const { file, claims, gaps } of input.proposals) {
    for (const c of claims) {
      const id = claimIdOf(c.youtubeVideoId, c.sourceUrl, c.claim);
      if (seen.has(id)) continue; // the same claim from the same source, proposed twice
      seen.add(id);
      const video = byId.get(c.youtubeVideoId);
      const flags: string[] = [];
      const domain = sourceDomain(c.sourceUrl);
      if (!domain) flags.push("the source URL is not an http(s) URL");
      if (!(CLAIM_KINDS as readonly string[]).includes(c.subject.kind)) flags.push(`unknown subject kind "${c.subject.kind}"`);
      if (/lyric/i.test(c.subject.kind)) flags.push("lyrics are never a claim");
      const excerpt = normaliseEvidenceText(c.excerpt);
      if (!excerpt) flags.push("no excerpt");
      if (excerpt.length > EXCERPT_MAX_CHARS || excerpt.split(" ").length > EXCERPT_MAX_WORDS) flags.push(`excerpt longer than ${EXCERPT_MAX_CHARS} characters or ${EXCERPT_MAX_WORDS} words (never quote lyrics or long passages)`);
      if (c.claim.length > CLAIM_MAX_CHARS) flags.push(`claim longer than ${CLAIM_MAX_CHARS} characters`);
      if (c.subject.value && excerpt && !containsLoose(excerpt, c.subject.value)) flags.push(`the value "${c.subject.value}" is not in the excerpt`);
      if (!video) flags.push("the video has no approved credits in the review sheets");
      const strength = domain ? resolveSourceStrength(c.sourceUrl, c.sourceStrength) : { strength: "unverified" as const, pointerOnly: false, note: "" };
      if (strength.pointerOnly) flags.push("Wikipedia is a pointer only: cite the source it cites instead");
      const cmp = compareWithVideo(c, video);
      rows.push({
        claimId: id,
        youtubeVideoId: c.youtubeVideoId,
        youtubeUrl: `https://www.youtube.com/watch?v=${c.youtubeVideoId}`,
        recordingTitle: title(video),
        subjectKind: c.subject.kind,
        workTitle: c.subject.workTitle ?? "",
        claimValue: c.subject.value ?? "",
        claim: c.claim,
        sourceUrl: c.sourceUrl,
        sourceTitle: c.sourceTitle ?? "",
        sourceDomain: domain ?? "",
        excerpt,
        sourceStrength: strength.strength,
        sourceTier: tierForStrength(strength.strength, strength.pointerOnly),
        pointerOnly: strength.pointerOnly,
        basisTier: RESEARCH_BASIS,
        videoTextRelation: cmp.relation,
        conflict: cmp.conflict,
        flags,
        strengthNote: strength.note,
        proposalsFile: file,
        retrievedAt: c.retrievedAt ?? "",
      });
    }
    for (const g of gaps) {
      rows.push({
        claimId: claimIdOf(g.youtubeVideoId, "", `NOT FOUND: ${g.question}`),
        youtubeVideoId: g.youtubeVideoId,
        youtubeUrl: `https://www.youtube.com/watch?v=${g.youtubeVideoId}`,
        recordingTitle: title(byId.get(g.youtubeVideoId)),
        subjectKind: "research gap",
        workTitle: "",
        claimValue: "",
        claim: `No source found: ${g.question}`,
        sourceUrl: "",
        sourceTitle: "",
        sourceDomain: "",
        excerpt: g.searched ?? "",
        sourceStrength: "",
        sourceTier: "",
        pointerOnly: false,
        basisTier: "",
        videoTextRelation: "",
        conflict: false,
        flags: ["research gap: nothing to accept"],
        strengthNote: "",
        proposalsFile: file,
        retrievedAt: "",
      });
    }
  }
  return rows;
}

export const CLAIMS_HEADER = [
  "claimId",
  "youtubeVideoId",
  "youtubeUrl",
  "recordingTitle",
  "subjectKind",
  "workTitle",
  "claimValue",
  "claim",
  "sourceUrl",
  "sourceTitle",
  "sourceDomain",
  "excerpt",
  "sourceStrength",
  "sourceTier",
  "strengthNote",
  "basisTier",
  "videoTextRelation",
  "flags",
  "proposalsFile",
  "retrievedAt",
  "status",
  "decision",
  "approver",
  "editedClaim",
  "editorNotes",
] as const;

export interface ClaimDecision {
  decision: string;
  approver: string;
  editedClaim: string;
  editorNotes: string;
}

/**
 * The lifecycle status of every claim row (gate 2, modules/mmke/guardrails/claims.ts), from the editor's decisions and the checks:
 * rejected / deferred as decided; stale when read more than STALE_AFTER_DAYS ago; conflict when it disagrees with the video's approved credits or
 * with another live claim about the same subject (never resolved by code); accepted only with a decision AND a named approver; otherwise proposed.
 * A research gap has no status.
 */
export function claimStatuses(rows: readonly ClaimRow[], decisions: ReadonlyMap<string, Pick<ClaimDecision, "decision" | "approver">>, now: Date): Map<string, ClaimStatus | ""> {
  const decisionOf = (id: string) => (decisions.get(id)?.decision ?? "").trim().toLowerCase();
  const asGuarded = (r: ClaimRow): GuardedClaim => ({
    claimId: r.claimId,
    youtubeVideoId: r.youtubeVideoId,
    subjectKind: r.subjectKind,
    workTitle: r.workTitle || null,
    value: r.claimValue || null,
    statement: r.claim,
    sources: [],
    status: decisionOf(r.claimId) === "reject" ? "rejected" : "proposed",
    approver: null,
    approvedAt: null,
    retrievedAt: r.retrievedAt || null,
  });
  const inConflict = new Set(detectConflicts(rows.filter((r) => r.subjectKind !== "research gap").map(asGuarded)).flatMap((c) => c.claimIds));
  const out = new Map<string, ClaimStatus | "">();
  for (const r of rows) {
    const d = decisionOf(r.claimId);
    const approver = (decisions.get(r.claimId)?.approver ?? "").trim();
    let status: ClaimStatus | "";
    if (r.subjectKind === "research gap") status = "";
    else if (d === "reject") status = "rejected";
    else if (d === "defer") status = "deferred";
    else if (r.retrievedAt && now.getTime() - new Date(r.retrievedAt).getTime() > STALE_AFTER_DAYS * 86_400_000) status = "stale";
    else if (r.conflict || inConflict.has(r.claimId)) status = "conflict";
    else if ((d === "accept" || d === "edit") && approver) status = "accepted";
    else status = "proposed";
    out.set(r.claimId, status);
  }
  return out;
}

/** research-claims.csv; decisions already made (by claimId, from the previous sheet) are carried over, so a rebuild never loses the editor's work. */
export function claimRowsToCsv(rows: readonly ClaimRow[], previous: ReadonlyMap<string, ClaimDecision> = new Map(), now: Date = new Date()): string {
  const status = claimStatuses(rows, previous, now);
  return toCsv(
    CLAIMS_HEADER,
    rows.map((r) => {
      const p = previous.get(r.claimId);
      return [r.claimId, r.youtubeVideoId, r.youtubeUrl, r.recordingTitle, r.subjectKind, r.workTitle, r.claimValue, r.claim, r.sourceUrl, r.sourceTitle, r.sourceDomain, r.excerpt, r.sourceStrength, r.sourceTier, r.strengthNote, r.basisTier, r.videoTextRelation, r.flags.join(" | "), r.proposalsFile, r.retrievedAt, status.get(r.claimId) ?? "", p?.decision ?? "", p?.approver ?? "", p?.editedClaim ?? "", p?.editorNotes ?? ""];
    })
  );
}
