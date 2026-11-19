// Upload-to-draft pipeline (R-34), MANUAL mode: the IMPORT validators (npm run pipeline:import). Pure: the script reads the file, the queue and
// (with --confirm-host) the database, and passes them here. The pasted JSON is DATA from outside the app: it is checked like the API route's
// output and is never trusted because the owner pasted it.
//
// Three kinds, told apart by their "format" field:
//   music-madras/entity-research@1    research about ONE entity of the queue (from a research packet). Each claim goes through the API route's
//                                     own per-claim rules (research.ts checkClaimCore: kind, never lyrics, one sentence, banned wording, never a
//                                     lyrics site, value verbatim in the source text, tier from the domain rules) plus the manual-only rules:
//                                     source URL and excerpt present; excerpt at most 200 characters and 30 words and VERBATIM (it must contain
//                                     the value); a value for every kind but background; tier A/B/C/X, never above what the domain allows
//                                     (it is lowered, and the note says so); at most 12 claims (DEEP) or 4 (LIGHT); the entity name exactly as in
//                                     the queue (original script); duplicates (in the file, or already stored) are skipped. Disagreements are
//                                     NEVER resolved: two values for one fact, a listed conflict, or a value the reviewed credits contradict make
//                                     every claim involved a CONFLICT for the owner to decide;
//   music-madras/video-draft@1        a video page summary for one bundle awaiting approval: the page-prose validator (pageProse.ts, gate 3);
//   music-madras/video-extraction@1   a video-credits-v2 answer for one queued video: the extraction validator (validateVideoCreditsOutput);
// and --reviewed (PIPELINE_EXTRACT_MODE=existing): the reviewed credits sheets (accept / edit decisions only) turned into the same v2 answer and
// put through the same validator. An import writes PROPOSALS only (claims PROPOSED or CONFLICT, a draft, an extraction): it never approves,
// accepts or publishes anything.

import { createHash } from "crypto";
import type { CheckedVideoCredits } from "../ai/structuredOutput/validateVideoCreditsOutput";
import { validateVideoCreditsOutput } from "../ai/structuredOutput/validateVideoCreditsOutput";
import { ENTITY_RESEARCH_FORMAT_V1, MAX_CLAIMS_PER_TIER, VIDEO_DRAFT_FORMAT_V1 } from "../ai/prompts/pipelineManual/pipelineManualPromptV1";
import { roleOf, type VideoFacts } from "../jobs/videoCreditsApproved";
import { tierForStrength, type SourceTier } from "../mmke/guardrails/sources";
import { fold } from "../mmke/guardrails/text";
import { MANUAL_PROVENANCE, type QueueEntry } from "./entities";
import { checkPageProse, type PageProse, type ProseContext } from "./pageProse";
import { draftCredits, toVideoFacts } from "./facts";
import type { BundleForApproval } from "./approve";
import { checkClaimCore, EXCERPT_MAX_CHARS, EXCERPT_MAX_WORDS } from "./research";
import type { EntityKind } from "./resolve";

export const VIDEO_EXTRACTION_FORMAT_V1 = "music-madras/video-extraction@1";
export type ImportKind = "entity-research" | "video-draft" | "video-extraction";

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

export const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

export function detectImportKind(json: unknown): ImportKind | null {
  const format = isObject(json) ? str(json.format) : "";
  if (format === ENTITY_RESEARCH_FORMAT_V1) return "entity-research";
  if (format === VIDEO_DRAFT_FORMAT_V1) return "video-draft";
  if (format === VIDEO_EXTRACTION_FORMAT_V1) return "video-extraction";
  return null;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Entity research

export interface ManualEntityClaim {
  entityKey: string;
  entityKind: EntityKind;
  entityName: string;
  subjectKind: string;
  workTitle: string | null;
  value: string | null;
  statement: string;
  sourceUrl: string;
  sourceTitle: string | null;
  excerpt: string;
  sourceTier: SourceTier;
  status: "PROPOSED" | "CONFLICT";
  retrievedAt: string;
  provenance: string;
  notes: string[];
}

export interface EntityResearchCheck {
  /** Whole-file refusals: nothing from the file may be written. */
  refused: string[];
  entityKey: string;
  claims: ManualEntityClaim[];
  rejected: Array<{ index: number; reason: string }>;
  duplicates: string[];
  notFound: string[];
}

const TIER_RANK: Readonly<Record<SourceTier, number>> = { A: 0, B: 1, C: 2, X: 3 };
/** Facts with one true value: two different values are a conflict. */
const SINGLE_VALUED = new Set(["composer", "lyricist", "arranger", "composition-date", "publisher", "publication", "translator", "text-source"]);

export function checkEntityResearchImport(json: unknown, ctx: { entry: QueueEntry | undefined; existing: ReadonlyArray<{ sourceUrl: string; statement: string }>; now: Date }): EntityResearchCheck {
  const out: EntityResearchCheck = { refused: [], entityKey: "", claims: [], rejected: [], duplicates: [], notFound: [] };
  if (!isObject(json) || str(json.format) !== ENTITY_RESEARCH_FORMAT_V1) {
    out.refused.push(`not an entity-research answer (format must be "${ENTITY_RESEARCH_FORMAT_V1}")`);
    return out;
  }
  out.entityKey = str(json.entityKey);
  const entry = ctx.entry;
  if (!entry || entry.entityKey !== out.entityKey) {
    out.refused.push(`entity key "${out.entityKey}" is not in the entity queue (npm run pipeline:entities)`);
    return out;
  }
  const name = str(json.entityName);
  if (name.normalize("NFC") !== entry.name.normalize("NFC")) out.refused.push(`entityName "${name}" is not the queue's "${entry.name}" (copy it exactly, in its original script)`);
  if (!Array.isArray(json.claims)) out.refused.push("claims must be an array");
  if (entry.nameDecision === "(blank)" || entry.nameDecision === "mixed") out.refused.push(`the name "${entry.name}" is not decided in review-names.csv (${entry.nameDecision}); decide it first so research attaches to the right entity`);
  if (out.refused.length) return out;

  out.notFound = Array.isArray(json.notFound) ? json.notFound.map(str).filter(Boolean).slice(0, 20) : [];
  const limit = MAX_CLAIMS_PER_TIER[entry.tier];
  const seen = new Set<string>();
  const existing = new Set(ctx.existing.map((c) => `${c.sourceUrl}\u0000${fold(c.statement)}`));
  (json.claims as unknown[]).forEach((raw, index) => {
    const reject = (reason: string) => out.rejected.push({ index, reason });
    if (index >= limit) return reject(`over the ${entry.tier} limit of ${limit} claims`);
    if (!isObject(raw)) return reject("not an object");
    const subjectKind = str(raw.subjectKind);
    const sourceUrl = str(raw.sourceUrl);
    const excerpt = str(raw.excerpt).replace(/\s+/g, " ");
    const claimedTier = str(raw.tier).toUpperCase();
    const value = str(raw.value) || null;
    if (!sourceUrl) return reject("source URL missing");
    if (!excerpt) return reject("excerpt missing (copy the sentence from the page, verbatim)");
    if (excerpt.length > EXCERPT_MAX_CHARS || excerpt.split(" ").length > EXCERPT_MAX_WORDS) return reject(`excerpt longer than ${EXCERPT_MAX_WORDS} words or ${EXCERPT_MAX_CHARS} characters`);
    if (!["A", "B", "C", "X"].includes(claimedTier)) return reject(`tier "${str(raw.tier)}" is not A, B, C or X`);
    if (!value && subjectKind !== "background") return reject(`a ${subjectKind || "claim"} needs a value, copied verbatim from the excerpt`);
    const core = checkClaimCore({ subjectKind, value, statement: str(raw.statement), sourceText: excerpt, sourceUrl, sourceKind: str(raw.sourceKind) });
    if (!core.ok) return reject(core.reason.replace("the cited text", "the excerpt (it must be verbatim)"));
    const computed = tierForStrength(core.strength.strength, core.strength.pointerOnly);
    const notes: string[] = [];
    let tier = claimedTier as SourceTier;
    if (TIER_RANK[tier] < TIER_RANK[computed]) {
      notes.push(`tier lowered from ${tier} to ${computed}${core.strength.note ? ` (${core.strength.note})` : ""}`);
      tier = computed;
    }
    const dedupe = `${sourceUrl}\u0000${fold(core.statement)}`;
    if (seen.has(dedupe)) return out.duplicates.push(`claim ${index + 1}: repeats an earlier claim in this file`);
    if (existing.has(dedupe)) return out.duplicates.push(`claim ${index + 1}: already stored for ${entry.entityKey}`);
    seen.add(dedupe);
    const retrieved = /^\d{4}-\d{2}-\d{2}$/.test(str(raw.retrievedOn)) && !Number.isNaN(Date.parse(str(raw.retrievedOn))) && Date.parse(str(raw.retrievedOn)) <= ctx.now.getTime() ? new Date(`${str(raw.retrievedOn)}T00:00:00.000Z`) : ctx.now;
    out.claims.push({
      entityKey: entry.entityKey,
      entityKind: entry.entityKind,
      entityName: entry.name,
      subjectKind: core.subjectKind,
      workTitle: str(raw.workTitle) || (entry.entityKind === "WORK" ? entry.name : null),
      value: core.value,
      statement: core.statement,
      sourceUrl,
      sourceTitle: str(raw.sourceTitle) || null,
      excerpt,
      sourceTier: tier,
      status: "PROPOSED",
      retrievedAt: retrieved.toISOString(),
      provenance: MANUAL_PROVENANCE,
      notes,
    });
  });

  // Conflicts: marked, never resolved.
  const conflict = (c: ManualEntityClaim, why: string) => {
    c.status = "CONFLICT";
    c.notes.push(why);
  };
  for (const c of out.claims.filter((x) => x.value && SINGLE_VALUED.has(x.subjectKind))) {
    const others = out.claims.filter((o) => o !== c && o.subjectKind === c.subjectKind && o.value && fold(o.value) !== fold(c.value!) && fold(o.workTitle ?? "") === fold(c.workTitle ?? ""));
    if (others.length) conflict(c, `sources disagree on the ${c.subjectKind}: ${[c.value, ...others.map((o) => o.value)].map((v) => `"${v}"`).join(" vs ")}`);
  }
  for (const listed of Array.isArray(json.conflicts) ? json.conflicts.filter(isObject) : []) {
    const values = Array.isArray(listed.values) ? listed.values.map(str).map(fold) : [];
    for (const c of out.claims.filter((x) => x.subjectKind === str(listed.subjectKind) && x.value && values.includes(fold(x.value)))) if (c.status !== "CONFLICT") conflict(c, `listed as a conflict: ${str(listed.note) || "sources disagree"}`);
  }
  for (const c of out.claims.filter((x) => x.value && entry.entityKind === "WORK" && entry.credited[x.subjectKind]?.length)) {
    const credited = entry.credited[c.subjectKind];
    if (!credited.some((n) => fold(n) === fold(c.value!)) && c.status !== "CONFLICT") conflict(c, `the videos credit the ${c.subjectKind} as ${credited.map((n) => `"${n}"`).join(", ")}`);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Video draft (summary prose)

export function checkVideoDraftImport(json: unknown, ctx: ProseContext): { ok: true; prose: PageProse } | { ok: false; problems: string[] } {
  if (!isObject(json) || str(json.format) !== VIDEO_DRAFT_FORMAT_V1) return { ok: false, problems: [`not a video-draft answer (format must be "${VIDEO_DRAFT_FORMAT_V1}")`] };
  if (str(json.youtubeVideoId) !== ctx.youtubeVideoId) return { ok: false, problems: [`youtubeVideoId "${str(json.youtubeVideoId)}" is not this bundle's "${ctx.youtubeVideoId}"`] };
  return checkPageProse(json, ctx, MANUAL_PROVENANCE);
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Video extraction (manual answer, or the reviewed sheets)

export interface ImportedExtraction {
  checked: CheckedVideoCredits;
  titleOnly: boolean;
  model: string;
}

export function checkVideoExtractionImport(json: unknown, video: { youtubeVideoId: string; title: string | null; description: string | null }, provenance: string = MANUAL_PROVENANCE): { ok: true; extraction: ImportedExtraction } | { ok: false; problems: string[] } {
  if (!isObject(json) || str(json.format) !== VIDEO_EXTRACTION_FORMAT_V1) return { ok: false, problems: [`not a video-extraction answer (format must be "${VIDEO_EXTRACTION_FORMAT_V1}")`] };
  if (str(json.youtubeVideoId) !== video.youtubeVideoId) return { ok: false, problems: [`youtubeVideoId "${str(json.youtubeVideoId)}" is not "${video.youtubeVideoId}"`] };
  const checked = validateVideoCreditsOutput(json.output, video);
  if (!checked.ok) return { ok: false, problems: checked.problems };
  if (checked.accepted.length === 0) return { ok: false, problems: ["no credit passed the validators"] };
  return { ok: true, extraction: { checked, titleOnly: (video.description ?? "").trim().length === 0, model: provenance } };
}

const CREDIT_ROLE: Readonly<Record<string, string>> = { work: "WORK", composer: "COMPOSER", lyricist: "LYRICIST", arranger: "ARRANGER", conductor: "CONDUCTOR", performer: "PERFORMER", venue: "VENUE" };

/** PIPELINE_EXTRACT_MODE=existing: one video's REVIEWED facts (accept / edit only) as a video-credits-v2 answer, for the same validator. */
export function reviewedToExtractionAnswer(v: VideoFacts): Record<string, unknown> {
  const quoted = (f: { quote: string; sourceField: string } | undefined, value: unknown) => (f && value !== null ? { value, quote: f.quote, field: f.sourceField === "title" ? "title" : "description" } : { value: null, quote: null, field: null });
  const credits = v.facts
    .filter((f) => CREDIT_ROLE[f.kind] || f.kind === "choir/ensemble")
    .map((f) => ({
      role: f.kind === "choir/ensemble" ? (roleOf(f.roleLabel) === "ENSEMBLE" ? "ENSEMBLE" : "CHOIR") : CREDIT_ROLE[f.kind],
      // The name AS QUOTED: the validator checks it inside the quotation; the canonical spelling comes back through the approved aliases.
      name: f.proposedName || f.name,
      workTitle: ["COMPOSER", "LYRICIST", "ARRANGER"].includes(CREDIT_ROLE[f.kind] ?? "") ? f.workTitle || null : null,
      quote: f.quote,
      field: f.sourceField === "title" ? "title" : "description",
    }));
  const date = v.facts.find((f) => f.kind === "performanceDate");
  const venueType = v.facts.find((f) => f.kind === "venueType");
  const work = v.facts.find((f) => f.kind === "work");
  return {
    format: VIDEO_EXTRACTION_FORMAT_V1,
    youtubeVideoId: v.youtubeVideoId,
    output: {
      recordingKind: { value: "UNCLEAR", quote: null, field: null },
      credits,
      performanceDate: quoted(date, date?.name ?? null),
      venueType: { ...quoted(venueType, venueType?.name ?? null), fromName: /inferred from name/.test(venueType?.venueTypeBasis ?? "") },
      suggestedTitle: { ...quoted(work, v.approvedRecordingTitle ? work?.proposedName || work?.name || null : null), alternateTitle: v.transliterationApproved && v.transliteration ? { value: v.transliteration, quote: v.youtubeTitle, field: "title" } : { value: null, quote: null, field: null } },
      gaps: v.facts.filter((f) => f.kind === "presenter" || f.kind === "other unmodelled").map((f) => ({ missing: `UNMODELLED: ${f.kind === "presenter" ? "PRESENTER" : roleOf(f.roleLabel) || "OTHER"}: ${f.name} -- "${f.quote}"`, reason: "reviewed credits sheet" })),
    },
  };
}

export const describeEntityCheck = (c: EntityResearchCheck): string[] => [
  ...c.refused.map((r) => `REFUSED: ${r}`),
  ...c.claims.map((x, i) => `  claim ${i + 1}: ${x.status === "CONFLICT" ? "CONFLICT" : "ok"} [tier ${x.sourceTier}] ${x.subjectKind}${x.value ? ` "${x.value}"` : ""} <- ${x.sourceUrl}${x.notes.length ? ` (${x.notes.join("; ")})` : ""}`),
  ...c.rejected.map((r) => `  rejected claim ${r.index + 1}: ${r.reason}`),
  ...c.duplicates.map((d) => `  duplicate: ${d}`),
  ...c.notFound.map((n) => `  not found: ${n}`),
];


/** The prose context of a bundle awaiting approval: its credits, its claims (only approved entity claims are usable) and its titles. */
export function proseContextForBundle(bundle: Pick<BundleForApproval, "youtubeVideoId" | "youtubeTitle" | "extraction" | "resolution" | "draft" | "claims">): ProseContext {
  const facts = toVideoFacts({ youtubeVideoId: bundle.youtubeVideoId, youtubeTitle: bundle.youtubeTitle ?? "", checked: bundle.extraction.checked, resolution: bundle.resolution });
  return {
    youtubeVideoId: bundle.youtubeVideoId,
    recordingTitle: bundle.draft.video.name,
    transliteration: facts.transliterationApproved ? facts.transliteration || null : null,
    credits: draftCredits(bundle.extraction.checked, bundle.resolution),
    claims: bundle.claims,
  };
}
