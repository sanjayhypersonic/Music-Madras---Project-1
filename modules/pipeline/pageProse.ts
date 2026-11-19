// Upload-to-draft pipeline (R-34): VIDEO PAGE PROSE written outside the template, by the owner's own Claude account (a manual video-draft import)
// or by the pipeline's provider (PIPELINE_DRAFT_MODE=api). Pure. ONE contract and ONE validator for both (pipeline-page-prose-v1):
//   - the input is closed-world: the bundle's credits (C1 …) and its usable claims (R1 …); an ENTITY-FIRST claim is usable only once APPROVED
//     (ACCEPTED), so a page is built from approved entity research and the draft stage starts no research of its own;
//   - every sentence names the ids it rests on, and only ids that were supplied;
//   - gate 3 runs exactly as on the template's summary (checkSummary: traceability, names, numbers, denials, banned wording, opening, anti-generic);
//   - SEO title at most 60 characters, meta description at most 155, no banned wording.
// Prose that fails is never "fixed": the template summary stays, and the problems are reported.

import type { AIGenerationRequest } from "../ai/provider/aiProvider";
import { PAGE_PROSE_INSTRUCTIONS_V1, PAGE_PROSE_OUTPUT_SCHEMA_V1, PIPELINE_PAGE_PROSE_PROMPT_V1 } from "../ai/prompts/pipelineManual/pipelineManualPromptV1";
import { findBannedPhrases } from "../mmke/guardrails/generation";
import { assessDraftClaims, buildMetaDescription, checkSummary, META_DESCRIPTION_MAX, SEO_TITLE_MAX, type DraftClaim, type DraftCredit, type PageDraft } from "./drafts";

export const PROSE_MAX_SENTENCES = 3;
export const PROSE_SENTENCE_MAX_CHARS = 300;

/** Claims a draft may use: a video's own research while proposed or accepted; an entity-first claim only once accepted. */
export const draftableClaims = (claims: readonly DraftClaim[]): DraftClaim[] => claims.filter((c) => (c.entityLevel ? c.status === "ACCEPTED" : c.status === "PROPOSED" || c.status === "ACCEPTED"));

export interface ProseContext {
  youtubeVideoId: string;
  recordingTitle: string;
  transliteration: string | null;
  credits: readonly DraftCredit[];
  /** Every claim of the bundle; only the draftable ones are offered and accepted as support. */
  claims: readonly DraftClaim[];
}

export interface PageProse {
  provenance: string;
  sentences: string[];
  support: string[][];
  seoTitle: string | null;
  metaDescription: string | null;
}

/** The DATA object the prose is written from (the manual draft packet prints it; the API call sends it as contextPayload). */
export function proseContextPayload(ctx: ProseContext) {
  const uses = assessDraftClaims(draftableClaims(ctx.claims));
  return {
    title: ctx.recordingTitle,
    transliteration: ctx.transliteration,
    credits: ctx.credits.map((c) => ({ id: c.id, role: c.role, name: c.name, workTitle: c.workTitle })),
    claims: uses.map((u) => ({ id: u.claim.id, subjectKind: u.claim.subjectKind, value: u.claim.value, statement: u.claim.statement, sourceTitle: u.claim.sourceTitle, weak: u.weak, conflictsWithVideo: u.claim.videoRelation === "CONFLICTS" })),
  };
}

export function buildProseRequest(ctx: ProseContext, options: { model?: string } = {}): AIGenerationRequest {
  return {
    systemInstructions: PAGE_PROSE_INSTRUCTIONS_V1,
    contextPayload: proseContextPayload(ctx),
    outputSchema: PAGE_PROSE_OUTPUT_SCHEMA_V1 as unknown as Record<string, unknown>,
    promptVersion: PIPELINE_PAGE_PROSE_PROMPT_V1,
    targetEntityType: "VIDEO",
    targetEntityId: ctx.youtubeVideoId,
    suggestionType: "EDITORIAL_PROSE",
    contextFingerprint: ctx.youtubeVideoId,
    model: options.model,
    maxOutputTokens: 1_500,
  };
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

export function checkPageProse(output: unknown, ctx: ProseContext, provenance: string): { ok: true; prose: PageProse } | { ok: false; problems: string[] } {
  if (!isObject(output) || !Array.isArray(output.summary)) return { ok: false, problems: ["the answer has no summary array"] };
  const usable = draftableClaims(ctx.claims);
  const uses = assessDraftClaims(usable);
  const known = new Set([...ctx.credits.map((c) => c.id), ...usable.map((c) => c.id)]);
  const conflicting = new Set(usable.filter((c) => c.videoRelation === "CONFLICTS" || c.status === "CONFLICT").map((c) => c.id));
  const problems: string[] = [];
  const sentences: string[] = [];
  const support: string[][] = [];
  if (output.summary.length === 0 || output.summary.length > PROSE_MAX_SENTENCES) problems.push(`the summary must have 1 to ${PROSE_MAX_SENTENCES} sentences`);
  output.summary.slice(0, PROSE_MAX_SENTENCES).forEach((raw, i) => {
    const at = `sentence ${i + 1}`;
    if (!isObject(raw)) return problems.push(`${at}: not an object`);
    const sentence = str(raw.sentence).replace(/\s+/g, " ");
    const ids = Array.isArray(raw.support) ? raw.support.map(str).map((id) => id.replace(/^\[|\]$/g, "")).filter(Boolean) : [];
    if (!sentence) return problems.push(`${at}: empty`);
    if (sentence.length > PROSE_SENTENCE_MAX_CHARS) problems.push(`${at}: longer than ${PROSE_SENTENCE_MAX_CHARS} characters`);
    if (ids.length === 0) problems.push(`${at}: rests on no credit or claim`);
    for (const id of ids) {
      if (!known.has(id)) problems.push(`${at}: cites ${id}, which is not a credit or an approved claim of this bundle`);
      if (conflicting.has(id)) problems.push(`${at}: cites ${id}, which conflicts with the video (never stated)`);
    }
    sentences.push(/[.!?]$/.test(sentence) ? sentence : `${sentence}.`);
    support.push(ids);
  });
  const seoTitle = str(output.seoTitle) || null;
  const metaDescription = str(output.metaDescription) || null;
  if (seoTitle && seoTitle.length > SEO_TITLE_MAX) problems.push(`seoTitle is longer than ${SEO_TITLE_MAX} characters`);
  if (metaDescription && metaDescription.length > META_DESCRIPTION_MAX) problems.push(`metaDescription is longer than ${META_DESCRIPTION_MAX} characters`);
  const banned = findBannedPhrases([seoTitle ?? "", metaDescription ?? "", ...sentences].join(" "));
  if (banned.length) problems.push(`banned wording: ${banned.join(", ")}`);
  if (problems.length === 0) {
    const titleShown = ctx.transliteration ? `${ctx.recordingTitle} (${ctx.transliteration})` : ctx.recordingTitle;
    const allowed = [ctx.recordingTitle, ctx.transliteration ?? ""].filter(Boolean);
    problems.push(...checkSummary(titleShown, sentences, support, ctx.credits, uses, allowed));
  }
  return problems.length ? { ok: false, problems } : { ok: true, prose: { provenance, sentences, support, seoTitle, metaDescription } };
}

/** The page with the checked prose in place of the template summary (the template's own summary problems no longer apply). */
export function applyProse(page: PageDraft, prose: PageProse): PageDraft {
  return {
    ...page,
    summary: prose.sentences,
    summarySupport: prose.support,
    seoTitle: prose.seoTitle ?? page.seoTitle,
    metaDescription: prose.metaDescription ?? buildMetaDescription(prose.sentences),
    problems: page.problems.filter((p) => !p.startsWith("summary:")),
    notes: [...page.notes.filter((n) => !/summary rests/.test(n)), `summary written by ${prose.provenance} and checked by gate 3`],
    prose,
  };
}
