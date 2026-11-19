// Upload-to-draft pipeline (R-34), stage 5: DRAFT the video page and every NEW entity page. Pure and CLOSED-WORLD: every sentence, key fact and
// JSON-LD property is built from the video's validated credits (cited as C1, C2 …) and from research claims (R1, R2 …); nothing else.
//
//   SEO title     at most 60 characters ("<Title> | <Choir> | Music Madras", shortened word by word);
//   meta          at most 155 characters, from the summary;
//   summary       answer-first: two or three factual sentences; a WEAK claim (below its minimum evidence, gate 1) is attributed ("…, according to
//                 <source>"); a CONFLICT claim is never used;
//   key facts     one labelled line per credit and per sufficient claim;
//   JSON-LD       schema.org MusicRecording / MusicComposition / Person / MusicGroup / Place; `sameAs` ONLY from ACCEPTED claims of tier A or B;
//   questions     answer-engine questions from the search-demand patterns, answered only when a credit already answers them.
// Gate 3 runs on every summary (modules/mmke/guardrails/generation.ts: traceability, names, numbers, denials, banned wording, opening sentence,
// anti-generic) and on the claim sentences across drafts (near-duplicates). Problems become FLAGS on the bundle; nothing is "fixed" silently.

import { checkDraftProse, findBannedPhrases, findNearDuplicates, type CitableClaim } from "../mmke/guardrails/generation";
import { assessEvidence, type SourceTier } from "../mmke/guardrails/sources";
import { fold } from "../mmke/guardrails/text";
import type { EntityKind } from "./resolve";
import type { SearchQuerySuggestion } from "./searchDemand";

export const SEO_TITLE_MAX = 60;
export const META_DESCRIPTION_MAX = 155;
const SITE = "Music Madras";

export interface DraftCredit {
  /** C1, C2 … */
  id: string;
  role: "COMPOSER" | "LYRICIST" | "ARRANGER" | "CONDUCTOR" | "CHOIR" | "ENSEMBLE" | "PERFORMER" | "VENUE" | "WORK" | "DATE";
  name: string;
  workTitle: string | null;
  /** The quote the validators checked (its words license the sentence). */
  quote: string;
  /** The resolution key of the entity this credit is (absent for a date). */
  subjectKey: string | null;
}

export interface DraftClaim {
  /** R1, R2 … (display and citation id within a bundle). */
  id: string;
  /** The PipelineClaim row id, when the claim is stored. */
  dbId?: string;
  /** An ENTITY-FIRST claim (manual research, docs/upload-pipeline.md section 9): shared by every bundle that names the entity. */
  entityLevel?: boolean;
  /** "api" or "manual (owner's Claude account)". */
  provenance?: string;
  subjectKey: string;
  subjectKind: string;
  value: string | null;
  statement: string;
  excerpt: string;
  sourceUrl: string;
  sourceTitle: string | null;
  sourceTier: SourceTier;
  videoRelation: "AGREES" | "CONFLICTS" | "NOT_STATED";
  status: "PROPOSED" | "ACCEPTED" | "CONFLICT" | "REJECTED" | "STALE";
}

export interface KeyFact {
  label: string;
  value: string;
  support: string[];
}

export interface PageDraft {
  /** "VIDEO" for the video's own page, else the new entity's kind. */
  kind: "VIDEO" | EntityKind;
  subjectKey: string;
  name: string;
  seoTitle: string;
  metaDescription: string;
  summary: string[];
  /** The ids each summary sentence rests on. */
  summarySupport: string[][];
  keyFacts: KeyFact[];
  jsonLd: Record<string, unknown>;
  sameAs: string[];
  questions: Array<{ question: string; answer: string; support: string[] }>;
  searchQueries: string[];
  /** Gate-3 problems: each becomes a bundle flag. */
  problems: string[];
  /** Informational (not flags), e.g. "no researched facts". */
  notes: string[];
  /**
   * Summary prose written outside the template (PIPELINE_DRAFT_MODE=api, or a manual video-draft import), as it passed gate 3. Absent: the
   * summary is the template's. Re-checked at approval against the decided claims (modules/pipeline/pageProse.ts).
   */
  prose?: { provenance: string; sentences: string[]; support: string[][]; seoTitle: string | null; metaDescription: string | null };
}

export const ARCHIVE_BOILERPLATE = "This performance is part of the Music Madras archive.";

/** Cuts text to `max` characters at a word boundary (never mid-word; no ellipsis is added). */
export function fitWords(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max + 1);
  return cut.slice(0, Math.max(cut.lastIndexOf(" "), 0)).replace(/[\s,;:—–-]+$/, "") || t.slice(0, max);
}

export function buildSeoTitle(title: string, qualifier: string | null): string {
  const candidates = [qualifier ? `${title} | ${qualifier} | ${SITE}` : null, `${title} | ${SITE}`, title].filter((c): c is string => !!c);
  return candidates.find((c) => c.length <= SEO_TITLE_MAX) ?? fitWords(title, SEO_TITLE_MAX);
}

/** The summary's sentences, as many whole sentences as fit, else the first sentence cut at a word. */
export function buildMetaDescription(sentences: readonly string[]): string {
  let out = "";
  for (const s of sentences) {
    const next = out ? `${out} ${s}` : s;
    if (next.length > META_DESCRIPTION_MAX) break;
    out = next;
  }
  return out || fitWords(sentences[0] ?? "", META_DESCRIPTION_MAX);
}

const list = (items: readonly string[]) => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`);
const withThe = (name: string) => (/^the\s/i.test(name) ? name : `the ${name}`);
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const formatDate = (iso: string): string => {
  const [y, m, d] = iso.split("-");
  return d ? `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}` : m ? `${MONTHS[Number(m) - 1]} ${y}` : y;
};
const withoutEnd = (s: string) => s.trim().replace(/[.!?]$/, "");
const withPeriod = (s: string) => (/[.!?]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`);

export interface ClaimUse {
  claim: DraftClaim;
  /** Meets its type's minimum evidence (gate 1, pooling claims that state the same value). */
  sufficient: boolean;
  weak: boolean;
}

/** Gate 1 per claim: which claims may be stated as fact, which only with attribution, and which not at all (conflicts, rejected, stale). */
export function assessDraftClaims(claims: readonly DraftClaim[]): ClaimUse[] {
  const live = claims.filter((c) => c.status === "PROPOSED" || c.status === "ACCEPTED");
  return live.map((claim) => {
    const pool = live.filter((o) => o.subjectKey === claim.subjectKey && o.subjectKind === claim.subjectKind && !!claim.value && !!o.value && fold(o.value) === fold(claim.value));
    const sources = (pool.length > 0 ? pool : [claim]).map((c) => ({ url: c.sourceUrl, tier: c.sourceTier, excerpt: c.excerpt, approved: true }));
    const a = assessEvidence(claim.subjectKind, sources, { videoTextSupports: claim.videoRelation === "AGREES" });
    return { claim, sufficient: a.sufficient, weak: a.weak };
  });
}

/** `sameAs` links: ACCEPTED claims of tier A or B about this subject (never a proposed claim, never Wikipedia, which is tier X). */
export function sameAsFor(subjectKey: string, claims: readonly DraftClaim[]): string[] {
  return [...new Set(claims.filter((c) => c.subjectKey === subjectKey && c.status === "ACCEPTED" && (c.sourceTier === "A" || c.sourceTier === "B")).map((c) => c.sourceUrl))];
}

function claimSentence(use: ClaimUse): string {
  const c = use.claim;
  return use.weak ? `${withoutEnd(c.statement)}, according to ${c.sourceTitle || new URL(c.sourceUrl).hostname}.` : withPeriod(c.statement);
}

const citable = (credits: readonly DraftCredit[], uses: readonly ClaimUse[]): CitableClaim[] => [
  ...credits.map((c) => ({ id: c.id, text: [c.name, c.workTitle ?? "", c.quote].join("\n"), weak: false })),
  ...uses.map((u) => ({ id: u.claim.id, text: [u.claim.statement, u.claim.value ?? "", u.claim.excerpt, u.claim.sourceTitle ?? ""].join("\n"), weak: u.weak })),
];

/** Runs gate 3 on a summary: each sentence rendered with its ids as markers, then checked against the credits and claims it cites. */
export function checkSummary(title: string, sentences: readonly string[], support: readonly string[][], credits: readonly DraftCredit[], uses: readonly ClaimUse[], allowed: readonly string[]): string[] {
  const marked = sentences.map((s, i) => `${withoutEnd(s)} ${support[i].map((id) => `[${id}]`).join("")}.`).join(" ");
  // Markers are numeric or C/R ids; the checker's marker pattern accepts C<n> and digits, so R ids are mapped to digits for the check.
  const toMarker = new Map<string, string>();
  let n = 0;
  for (const u of uses) toMarker.set(u.claim.id, String(++n));
  const rendered = marked.replace(/\[(R\d+)\]/g, (_m, id: string) => `[${toMarker.get(id) ?? id}]`);
  const claimsForCheck = citable(credits, uses).map((c) => ({ ...c, id: toMarker.get(c.id) ?? c.id }));
  const result = checkDraftProse(rendered, { title, claims: claimsForCheck, boilerplate: [ARCHIVE_BOILERPLATE], allowed: [...allowed, SITE] });
  return result.problems.map((p) => `summary: ${p.problem}`);
}

export interface VideoDraftInput {
  youtubeVideoId: string;
  youtubeTitle: string | null;
  publishedAt: string | null;
  recordingTitle: string;
  transliteration: string | null;
  credits: DraftCredit[];
  claims: DraftClaim[];
  queries: SearchQuerySuggestion[];
}

export function draftVideoPage(input: VideoDraftInput): PageDraft {
  const of = (role: DraftCredit["role"]) => input.credits.filter((c) => c.role === role);
  const ids = (cs: readonly DraftCredit[]) => cs.map((c) => c.id);
  const composers = of("COMPOSER");
  const performers = [...of("CHOIR"), ...of("ENSEMBLE")];
  const soloists = of("PERFORMER");
  const venue = of("VENUE")[0];
  const date = of("DATE")[0];
  const uses = assessDraftClaims(input.claims.filter((c) => c.subjectKey === "VIDEO"));
  const title = input.recordingTitle;
  const titleShown = input.transliteration ? `${title} (${input.transliteration})` : title;

  const sentences: string[] = [];
  const support: string[][] = [];
  // 1. The answer first: what it is and who performs it.
  const who = [...performers.map((c) => withThe(c.name)), ...soloists.map((c) => c.name)];
  const where = `${venue ? ` at ${venue.name}` : ""}${date ? ` on ${formatDate(date.name)}` : ""}`;
  const by = composers.length ? `a work by ${list(composers.map((c) => c.name))}` : "";
  if (by && who.length) sentences.push(`${titleShown} is ${by}, performed by ${list(who)}${where}.`);
  else if (by) sentences.push(`${titleShown} is ${by}.`);
  else if (who.length) sentences.push(`${titleShown} is performed by ${list(who)}${where}.`);
  else sentences.push(`${titleShown} is a recording in the Music Madras archive.`);
  support.push([...ids(composers), ...ids(performers), ...ids(soloists), ...(venue ? [venue.id] : []), ...(date ? [date.id] : [])]);
  // 2. The other creators and the conductor.
  const lyricists = of("LYRICIST");
  const arrangers = of("ARRANGER");
  const conductors = of("CONDUCTOR");
  const parts = [lyricists.length ? `the words are by ${list(lyricists.map((c) => c.name))}` : "", arrangers.length ? `the arrangement is by ${list(arrangers.map((c) => c.name))}` : "", conductors.length ? `the conductor is ${list(conductors.map((c) => c.name))}` : ""].filter(Boolean);
  if (parts.length) {
    const s = list(parts);
    sentences.push(`${s[0].toUpperCase()}${s.slice(1)}.`);
    support.push([...ids(lyricists), ...ids(arrangers), ...ids(conductors)]);
  }
  // 3. One researched fact the video does not already state (never a conflict; a weak claim only with attribution).
  const fact = uses.find((u) => u.claim.videoRelation === "NOT_STATED" && (u.sufficient || u.weak));
  if (fact && sentences.length < 3) {
    sentences.push(claimSentence(fact));
    support.push([fact.claim.id]);
  }
  if (sentences.length === 1 && support[0].length === 0) support[0] = [];

  const keyFacts: KeyFact[] = [];
  const add = (label: string, cs: readonly DraftCredit[]) => cs.length && keyFacts.push({ label, value: cs.map((c) => c.name).join(", "), support: ids(cs) });
  add("Work", of("WORK"));
  add("Composer", composers);
  add("Words", lyricists);
  add("Arrangement", arrangers);
  add("Choir", of("CHOIR"));
  add("Ensemble", of("ENSEMBLE"));
  add("Conductor", conductors);
  add("Performer", soloists);
  add("Venue", venue ? [venue] : []);
  if (date) keyFacts.push({ label: "Date", value: formatDate(date.name), support: [date.id] });
  for (const u of uses.filter((x) => x.sufficient && x.claim.videoRelation !== "CONFLICTS" && x.claim.value)) keyFacts.push({ label: FACT_LABEL[u.claim.subjectKind] ?? "Fact", value: u.claim.value!, support: [u.claim.id] });

  const person = (c: DraftCredit) => ({ "@type": "Person", name: c.name, ...(c.subjectKey && sameAsFor(c.subjectKey, input.claims).length ? { sameAs: sameAsFor(c.subjectKey, input.claims) } : {}) });
  const group = (c: DraftCredit) => ({ "@type": "MusicGroup", name: c.name, ...(c.subjectKey && sameAsFor(c.subjectKey, input.claims).length ? { sameAs: sameAsFor(c.subjectKey, input.claims) } : {}) });
  const jsonLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "MusicRecording",
    name: title,
    ...(input.transliteration ? { alternateName: input.transliteration } : {}),
    recordingOf: {
      "@type": "MusicComposition",
      name: of("WORK")[0]?.name ?? title,
      ...(composers.length ? { composer: composers.map(person) } : {}),
      ...(lyricists.length ? { lyricist: lyricists.map(person) } : {}),
      ...(sameAsFor("VIDEO", input.claims).length ? { sameAs: sameAsFor("VIDEO", input.claims) } : {}),
    },
    ...(performers.length || soloists.length ? { byArtist: [...performers.map(group), ...soloists.map(person)] } : {}),
    ...(conductors.length || arrangers.length ? { contributor: [...conductors, ...arrangers].map(person) } : {}),
    ...(venue ? { locationCreated: { "@type": "Place", name: venue.name } } : {}),
    subjectOf: { "@type": "VideoObject", name: input.youtubeTitle ?? title, embedUrl: `https://www.youtube.com/embed/${input.youtubeVideoId}`, ...(input.publishedAt ? { uploadDate: input.publishedAt } : {}) },
  };

  const questions: PageDraft["questions"] = [];
  if (composers.length) questions.push({ question: `Who composed ${title}?`, answer: `${list(composers.map((c) => c.name))}.`, support: ids(composers) });
  if (lyricists.length) questions.push({ question: `Who wrote the words of ${title}?`, answer: `${list(lyricists.map((c) => c.name))}.`, support: ids(lyricists) });
  if (who.length) {
    const answer = list(who);
    questions.push({ question: `Who performs ${title} in this recording?`, answer: `${answer[0].toUpperCase()}${answer.slice(1)}.`, support: [...ids(performers), ...ids(soloists)] });
  }
  if (venue) questions.push({ question: `Where was this performance of ${title} recorded?`, answer: `${venue.name}.`, support: [venue.id] });

  const allowed = [title, input.transliteration ?? ""].filter(Boolean);
  const problems = checkSummary(titleShown, sentences, support, input.credits, uses, allowed);
  const qualifier = performers[0]?.name ?? composers[0]?.name ?? null;
  return {
    kind: "VIDEO",
    subjectKey: "VIDEO",
    name: title,
    seoTitle: buildSeoTitle(title, qualifier),
    metaDescription: buildMetaDescription(sentences),
    summary: sentences,
    summarySupport: support,
    keyFacts,
    jsonLd,
    sameAs: sameAsFor("VIDEO", input.claims),
    questions,
    searchQueries: input.queries.map((q) => q.query),
    problems,
    notes: fact ? [] : ["no researched fact is used: the summary rests on the video's own credits"],
  };
}

const FACT_LABEL: Readonly<Record<string, string>> = {
  publisher: "Publisher",
  publication: "Published",
  "composition-date": "Composed",
  "alternate-title": "Also known as",
  "text-source": "Text",
  translator: "Translation",
  "work-title": "Published title",
};

const ROLE_LABEL: Readonly<Record<string, string>> = { COMPOSER: "Composer", LYRICIST: "Lyricist", ARRANGER: "Arranger", CONDUCTOR: "Conductor", CHOIR: "Choir", ENSEMBLE: "Ensemble", PERFORMER: "Performer", VENUE: "Venue", WORK: "Work" };

export interface EntityDraftInput {
  kind: EntityKind;
  subjectKey: string;
  name: string;
  /** The credits of this entity in this video (its roles). */
  credits: DraftCredit[];
  recordingTitle: string;
  claims: DraftClaim[];
  queries: SearchQuerySuggestion[];
}

export function draftEntityPage(input: EntityDraftInput): PageDraft {
  const roles = [...new Set(input.credits.map((c) => c.role))];
  const roleWords = roles.map((r) => ROLE_LABEL[r]?.toLowerCase() ?? r.toLowerCase());
  const works = [...new Set(input.credits.map((c) => c.workTitle).filter((w): w is string => !!w))];
  const uses = assessDraftClaims(input.claims.filter((c) => c.subjectKey === input.subjectKey));
  const sentences: string[] = [];
  const support: string[][] = [];
  const creditIds = input.credits.map((c) => c.id);
  if (input.kind === "VENUE") sentences.push(`${input.name} is the venue of the recording of ${input.recordingTitle} in the Music Madras archive.`);
  else if (input.kind === "WORK") sentences.push(`${input.name} is performed in the recording of ${input.recordingTitle} in the Music Madras archive.`);
  else {
    const ofWorks = works.length ? ` of ${list(works)}` : "";
    const where = works.some((w) => fold(w) === fold(input.recordingTitle)) ? "in the Music Madras archive" : `in the recording of ${input.recordingTitle} in the Music Madras archive`;
    sentences.push(`${input.name} is credited as ${list(roleWords)}${ofWorks} ${where}.`);
  }
  support.push(creditIds);
  for (const u of uses.filter((x) => x.claim.videoRelation !== "CONFLICTS" && (x.sufficient || x.weak)).slice(0, 2)) {
    sentences.push(claimSentence(u));
    support.push([u.claim.id]);
  }
  const keyFacts: KeyFact[] = roles.map((r) => ({ label: "Role", value: ROLE_LABEL[r] ?? r, support: input.credits.filter((c) => c.role === r).map((c) => c.id) }));
  if (works.length) keyFacts.push({ label: "Work", value: works.join(", "), support: creditIds });
  for (const u of uses.filter((x) => x.sufficient && x.claim.value)) keyFacts.push({ label: FACT_LABEL[u.claim.subjectKind] ?? "Fact", value: u.claim.value!, support: [u.claim.id] });
  const sameAs = sameAsFor(input.subjectKey, input.claims);
  const type = input.kind === "VENUE" ? "Place" : input.kind === "CHOIR" || input.kind === "ENSEMBLE" ? "MusicGroup" : input.kind === "WORK" ? "MusicComposition" : "Person";
  const jsonLd: Record<string, unknown> = { "@context": "https://schema.org", "@type": type, name: input.name, ...(sameAs.length ? { sameAs } : {}) };
  const allowed = [input.name, input.recordingTitle, ...works];
  const problems = checkSummary(input.name, sentences, support, input.credits, uses, allowed);
  return {
    kind: input.kind,
    subjectKey: input.subjectKey,
    name: input.name,
    seoTitle: buildSeoTitle(input.name, ROLE_LABEL[roles[0]] ?? null),
    metaDescription: buildMetaDescription(sentences),
    summary: sentences,
    summarySupport: support,
    keyFacts,
    jsonLd,
    sameAs,
    questions: [],
    searchQueries: input.queries.map((q) => q.query),
    problems,
    notes: uses.length ? [] : ["no researched facts yet: the page states only the archive's own credit"],
  };
}

/** Near-duplicate check across drafts (gate 3): compares the RESEARCHED sentences only (template sentences are alike by design). */
export function nearDuplicateProblems(drafts: readonly PageDraft[], existing: ReadonlyArray<{ id: string; summary: string; name: string }>): Map<string, string[]> {
  const researched = (d: PageDraft) => d.summary.filter((_, i) => d.summarySupport[i].some((id) => id.startsWith("R"))).join(" ");
  const items = [...drafts.map((d) => ({ id: `${d.kind}:${d.subjectKey}`, prose: researched(d), title: d.name })), ...existing.map((e) => ({ id: `existing:${e.id}`, prose: e.summary, title: e.name }))].filter((x) => x.prose.trim());
  const out = new Map<string, string[]>();
  for (const dup of findNearDuplicates(items)) {
    for (const [self, other] of [[dup.a, dup.b], [dup.b, dup.a]] as const) {
      if (self.startsWith("existing:")) continue;
      out.set(self, [...(out.get(self) ?? []), `near-duplicate of ${other} (${Math.round(dup.similarity * 100)}% similar${dup.sameOpening ? ", same opening" : ""})`]);
    }
  }
  return out;
}

/** Anti-generic wording across the whole draft (SEO title, meta and summary). */
export const draftWordingProblems = (d: PageDraft): string[] => findBannedPhrases([d.seoTitle, d.metaDescription, ...d.summary].join(" ")).map((p) => `banned wording "${p}"`);
