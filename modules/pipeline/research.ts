// Upload-to-draft pipeline (R-34), stage 4: RESEARCH, for NEW entities and for the video's work only. Pure, apart from the provider calls the
// caller makes with the requests built here.
//
// Two calls per subject (modules/ai/prompts/pipelineResearch/pipelineResearchPromptV1.ts): a web-search session that returns cited passages,
// then a structured call that turns citations into claims. Every claim is then checked IN CODE against the citations:
//   - it must name a citation the provider returned; its URL and excerpt are taken from that citation, never from the model;
//   - its value (when it has one) must occur in the citation's cited text, and in its statement; the statement is one sentence, at most 300
//     characters, with no banned wording; lyrics are never a claim; the excerpt is at most 200 characters and 30 words;
//   - its source tier comes from the guardrails (gate 1): known domains fix or cap it, Wikipedia is a pointer only (tier X);
//   - it is compared with the video's own text: AGREES (the video states the value), CONFLICTS (the video credits someone else in that role:
//     the claim is marked CONFLICT and never resolved), or NOT_STATED.
// Gates: docs/content-guardrails.md. A claim is a PROPOSAL until the owner accepts it in the Studio Pipeline inbox.

import type { AIGenerationRequest, AIResearchRequest, AIResearchSuccess } from "../ai/provider/aiProvider";
import type { CheckedVideoCredits } from "../ai/structuredOutput/validateVideoCreditsOutput";
import { PIPELINE_CLAIMS_INSTRUCTIONS_V1, PIPELINE_CLAIMS_OUTPUT_SCHEMA_V1, PIPELINE_RESEARCH_PROMPT_V1, PIPELINE_SEARCH_INSTRUCTIONS_V1 } from "../ai/prompts/pipelineResearch/pipelineResearchPromptV1";
import { CLAIM_KINDS, resolveSourceStrength } from "../jobs/videoResearch";
import { tierForStrength, type SourceTier } from "../mmke/guardrails/sources";
import { findBannedPhrases } from "../mmke/guardrails/generation";
import { containsSentenceBoundary, fold } from "../mmke/guardrails/text";
import type { EntityKind } from "./resolve";

/** Sites never used as sources (lyrics). */
export const BLOCKED_RESEARCH_DOMAINS = ["genius.com", "lyrics.com", "azlyrics.com", "musixmatch.com", "lyricstranslate.com"];
export const EXCERPT_MAX_CHARS = 200;
export const EXCERPT_MAX_WORDS = 30;
export const STATEMENT_MAX_CHARS = 300;

export interface ResearchSubject {
  /** The resolution key (or "VIDEO" for the video's own work). */
  key: string;
  kind: EntityKind | "VIDEO";
  name: string;
  role: string;
  workTitle: string | null;
  videoTitle: string;
}

export type VideoRelation = "AGREES" | "CONFLICTS" | "NOT_STATED";

export interface ProposedPipelineClaim {
  /** "VIDEO" for the video's work, else the resolution key of the new entity researched (stored as PipelineClaim.subjectKey). */
  subjectKey: string;
  entityKind: EntityKind | null;
  entityName: string;
  subjectKind: string;
  workTitle: string | null;
  value: string | null;
  statement: string;
  sourceUrl: string;
  sourceTitle: string | null;
  excerpt: string;
  sourceTier: SourceTier;
  videoRelation: VideoRelation;
  status: "PROPOSED" | "CONFLICT";
  retrievedAt: string;
}

export function buildSearchRequest(subject: ResearchSubject, options: { maxSearches: number; model?: string }): AIResearchRequest {
  return {
    systemInstructions: PIPELINE_SEARCH_INSTRUCTIONS_V1,
    contextPayload: { subject: { name: subject.name, role: subject.role, workTitle: subject.workTitle }, videoTitle: subject.videoTitle },
    promptVersion: PIPELINE_RESEARCH_PROMPT_V1,
    targetEntityType: subject.kind,
    targetEntityId: subject.key,
    maxSearches: options.maxSearches,
    blockedDomains: BLOCKED_RESEARCH_DOMAINS,
    model: options.model,
    maxOutputTokens: 4_000,
  };
}

interface IndexedCitation {
  id: string;
  url: string;
  title: string | null;
  citedText: string;
}

/** Citation ids "P<passage>.C<citation>", as the claims prompt sees them. */
export function indexCitations(research: Pick<AIResearchSuccess, "passages">): IndexedCitation[] {
  return research.passages.flatMap((p, i) => p.citations.map((c, j) => ({ id: `P${i + 1}.C${j + 1}`, url: c.url, title: c.title, citedText: c.citedText })));
}

export function buildClaimsRequest(subject: ResearchSubject, research: Pick<AIResearchSuccess, "passages">, options: { model?: string } = {}): AIGenerationRequest {
  const citations = indexCitations(research);
  return {
    systemInstructions: PIPELINE_CLAIMS_INSTRUCTIONS_V1,
    contextPayload: {
      subject: { name: subject.name, role: subject.role, workTitle: subject.workTitle },
      passages: research.passages.map((p, i) => ({ id: `P${i + 1}`, text: p.text, citations: citations.filter((c) => c.id.startsWith(`P${i + 1}.`)) })),
    },
    outputSchema: PIPELINE_CLAIMS_OUTPUT_SCHEMA_V1 as unknown as Record<string, unknown>,
    promptVersion: PIPELINE_RESEARCH_PROMPT_V1,
    targetEntityType: subject.kind,
    targetEntityId: subject.key,
    suggestionType: "CANONICAL_RELATIONSHIP_CANDIDATE",
    contextFingerprint: subject.key,
    model: options.model,
    maxOutputTokens: 6_000,
  };
}

const SOURCE_KIND_STRENGTH: Readonly<Record<string, string>> = {
  publisher: "catalogue/publisher",
  "library or score catalogue": "catalogue/publisher",
  "hymnal index or reference work": "reference work",
  "official institution page": "reference work",
  "national newspaper": "news",
  "blog, fan site or social media": "fan site",
  other: "unverified",
};

/** At most EXCERPT_MAX_CHARS characters and EXCERPT_MAX_WORDS words of the cited text, centred on the value when there is one. */
export function excerptAround(citedText: string, value: string | null): string {
  const words = citedText.replace(/\s+/g, " ").trim().split(" ");
  let start = 0;
  if (value) {
    const target = fold(value).split(" ")[0];
    const at = words.findIndex((w) => fold(w).includes(target));
    if (at > 0) start = Math.max(0, at - 8);
  }
  let out = words.slice(start, start + EXCERPT_MAX_WORDS).join(" ");
  if (out.length > EXCERPT_MAX_CHARS) out = out.slice(0, EXCERPT_MAX_CHARS).replace(/\s+\S*$/, "");
  return out;
}

/** How a researched value stands against the video's own text and accepted credits. Never resolves a disagreement. */
export function relationToVideo(subjectKind: string, workTitle: string | null, value: string | null, video: { title: string | null; description: string | null }, checked: CheckedVideoCredits | null): VideoRelation {
  if (!value) return "NOT_STATED";
  if (fold(`${video.title ?? ""}\n${video.description ?? ""}`).includes(fold(value))) return "AGREES";
  const role = ({ composer: "COMPOSER", lyricist: "LYRICIST", arranger: "ARRANGER", conductor: "CONDUCTOR", choir: "CHOIR", performer: "PERFORMER", venue: "VENUE" } as Record<string, string>)[subjectKind];
  if (!role || !checked) return "NOT_STATED";
  const credited = checked.accepted.filter((c) => c.role === role && (!workTitle || !c.workTitle || fold(c.workTitle) === fold(workTitle)));
  return credited.length > 0 && !credited.some((c) => fold(c.name) === fold(value)) ? "CONFLICTS" : "NOT_STATED";
}

export interface ClaimCheckResult {
  claims: ProposedPipelineClaim[];
  rejected: Array<{ index: number; reason: string }>;
  notFound: string[];
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

export function checkResearchClaims(input: {
  subject: ResearchSubject;
  output: unknown;
  research: Pick<AIResearchSuccess, "passages">;
  video: { title: string | null; description: string | null };
  checked: CheckedVideoCredits | null;
  retrievedAt: Date;
}): ClaimCheckResult {
  const rejected: ClaimCheckResult["rejected"] = [];
  if (!isObject(input.output) || !Array.isArray(input.output.claims)) return { claims: [], rejected: [{ index: -1, reason: "the claims output was not in the expected shape" }], notFound: [] };
  const citations = new Map(indexCitations(input.research).map((c) => [c.id, c]));
  const claims: ProposedPipelineClaim[] = [];
  const seen = new Set<string>();
  input.output.claims.forEach((raw, index) => {
    const reject = (reason: string) => rejected.push({ index, reason });
    if (!isObject(raw)) return reject("not an object");
    const citation = citations.get(str(raw.citation));
    if (!citation) return reject(`cites "${str(raw.citation)}", which the search did not return`);
    const subjectKind = str(raw.subjectKind);
    if (!(CLAIM_KINDS as readonly string[]).includes(subjectKind)) return reject(`unknown subject kind "${subjectKind}"`);
    if (/lyric/i.test(subjectKind)) return reject("lyrics are never a claim");
    const value = str(raw.value) || null;
    const statement = str(raw.statement).replace(/\s+/g, " ");
    if (!statement || statement.length > STATEMENT_MAX_CHARS || containsSentenceBoundary(statement)) return reject("the statement must be one sentence of at most 300 characters");
    const banned = findBannedPhrases(statement);
    if (banned.length) return reject(`banned wording: ${banned.join(", ")}`);
    if (value && !fold(citation.citedText).includes(fold(value))) return reject(`the value "${value}" is not in the cited text`);
    if (value && !fold(statement).includes(fold(value))) return reject(`the statement does not contain its value "${value}"`);
    const strength = resolveSourceStrength(citation.url, SOURCE_KIND_STRENGTH[str(raw.sourceKind)] ?? "unverified");
    const relation = relationToVideo(subjectKind, str(raw.workTitle) || input.subject.workTitle, value, input.video, input.checked);
    const dedupe = `${citation.url}\u0000${fold(statement)}`;
    if (seen.has(dedupe)) return;
    seen.add(dedupe);
    claims.push({
      subjectKey: input.subject.key,
      entityKind: input.subject.kind === "VIDEO" ? "WORK" : input.subject.kind,
      entityName: input.subject.name,
      subjectKind,
      workTitle: str(raw.workTitle) || input.subject.workTitle,
      value,
      statement,
      sourceUrl: citation.url,
      sourceTitle: citation.title,
      excerpt: excerptAround(citation.citedText, value),
      sourceTier: tierForStrength(strength.strength, strength.pointerOnly),
      videoRelation: relation,
      status: relation === "CONFLICTS" ? "CONFLICT" : "PROPOSED",
      retrievedAt: input.retrievedAt.toISOString(),
    });
  });
  const notFound = Array.isArray(input.output.notFound) ? input.output.notFound.filter((n): n is string => typeof n === "string").slice(0, 10) : [];
  return { claims, rejected, notFound };
}
