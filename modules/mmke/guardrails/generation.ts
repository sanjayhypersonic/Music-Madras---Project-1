// GATE 3, GENERATION: code-enforced checks on a draft's PROSE, whoever or whatever wrote it (docs/content-guardrails.md section 4). PURE.
//
//   - banned phrases: filler, superlatives, hedges that smuggle unsupported claims ("it is believed"), and AI tics;
//   - opening sentence: starts with the recording's title as written (original script kept), is not a generic opener, and is short;
//   - claim-to-sentence traceability: every sentence that is not fixed boilerplate cites at least one usable claim ([R-…], [C1], [1]); every NAME
//     (a capitalised word or any non-Latin word), every NUMBER or year, every MONTH and every QUANTITY word in it must appear in the claims it cites;
//     a denial must appear in a cited claim; a WEAK claim may only be stated with attribution ("According to …"), never as plain fact;
//   - anti-generic: a sentence with no name, number or title in it is generic and is refused;
//   - similarity: drafts of different videos must not be near-copies of each other, and must not share an opening.
// What these checks cannot do (as content-intelligence-architecture §90): they test words, not meaning. Words from the claims can be recombined into
// something the claims do not say. Human review of every sentence against its cited claims stays the control.

import { FUNCTION_WORDS, MONTHS, QUANTITY_WORDS, SENTENCE_END, containsSentenceBoundary, fold, hasDigit, hasNegation, tokens } from "./text";
import { shingleSimilarity } from "./sources";

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Banned phrases

export const BANNED_PHRASES: readonly string[] = [
  // superlatives and praise
  "timeless", "stunning", "breathtaking", "masterpiece", "masterful", "iconic", "legendary", "world-renowned", "world renowned", "world-class", "beloved",
  "soul-stirring", "soul stirring", "heavenly voices", "angelic", "mesmerising", "mesmerizing", "spellbinding", "unforgettable", "beautiful rendition",
  "the best", "the greatest", "the finest", "most famous", "most popular", "one of the most",
  // hedges that carry an unsupported claim
  "it is believed", "it is said", "reportedly", "allegedly", "possibly", "probably", "traditionally", "legend has it", "many believe", "some say", "widely regarded",
  // filler and AI tics
  "a testament to", "rich tapestry", "delve", "in conclusion", "needless to say", "in today's world", "journey through", "nestled", "boasts", "elevate", "embark",
];

/** The banned phrases a text contains (whole words, case- and accent-insensitive). */
export function findBannedPhrases(text: string): string[] {
  const t = ` ${fold(text).replace(/[^\p{L}\p{N}'-]+/gu, " ")} `;
  return BANNED_PHRASES.filter((p) => t.includes(` ${fold(p)} `));
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Sentences

/** Splits prose into sentences with the same boundary rules as containsSentenceBoundary (abbreviations and initials do not end a sentence). */
export function splitSentences(prose: string): string[] {
  const out: string[] = [];
  for (const paragraph of prose.split(/\n\s*\n/)) {
    let rest = paragraph.replace(/\s+/g, " ").trim();
    while (rest) {
      let cut = -1;
      for (let i = 1; i <= rest.length; i++) {
        if (containsSentenceBoundary(rest.slice(0, i + 1)) && !containsSentenceBoundary(rest.slice(0, i))) {
          cut = i;
          break;
        }
      }
      if (cut < 0) {
        out.push(rest);
        break;
      }
      // rest[cut] is the first character of the next sentence: everything before it (terminator and closing quotes included) is this sentence
      const head = rest.slice(0, cut).trim();
      out.push(head);
      rest = rest.slice(head.length).trim();
    }
  }
  return out.filter(Boolean);
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Opening sentence

export const GENERIC_OPENERS: readonly string[] = ["in this video", "welcome", "join us", "experience", "discover", "enjoy", "listen to", "presenting", "here is", "this is", "watch", "get ready"];
export const OPENING_MAX_CHARS = 250;

export function checkOpeningSentence(prose: string, title: { title: string; transliteration?: string | null }): string[] {
  const first = splitSentences(prose)[0] ?? "";
  const p: string[] = [];
  if (!first) return ["the draft has no opening sentence"];
  if (!fold(first).startsWith(fold(title.title))) p.push(`the opening sentence does not start with the title as written ("${title.title}")`);
  const opener = GENERIC_OPENERS.find((g) => fold(first).startsWith(g));
  if (opener) p.push(`generic opener "${opener}"`);
  if (first.length > OPENING_MAX_CHARS) p.push(`the opening sentence is longer than ${OPENING_MAX_CHARS} characters`);
  return p;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Traceability

export interface CitableClaim {
  /** The marker used in prose, without brackets: "R-8ca702af8d", "C3" or "2". */
  id: string;
  /** Everything the claim may license: its statement, value and source excerpts. */
  text: string;
  /** Usable only with attribution. */
  weak: boolean;
}

export interface SentenceProblem {
  sentence: string;
  problem: string;
}

const MARKER = /\[(R-[0-9a-f]{10}|C\d+|\d+)\]/g;
/** Attribution names who says it: "According to …", "as listed in …", or a source noun with a reporting verb ("the publisher's catalogue lists …"). */
export const ATTRIBUTION = /\b(?:according to|as (?:stated|listed|given|reported|recorded) (?:by|in))\b|\b(?:source|catalogue|catalog|index|newspaper|review|article|website|page|listing|book|hymnal|songbook|programme|archive|publisher|dictionary)\b[^.]*\b(?:states|lists|gives|reports|records|describes|says|names|credits|attributes)\b/i;

/** Proper nouns as written: capitalised Latin words (not the first word when it is a function word) and every non-Latin word. */
function namesIn(sentence: string): string[] {
  const words = sentence.replace(MARKER, " ").match(/[\p{L}\p{M}][\p{L}\p{M}'’-]*/gu) ?? [];
  return words.filter((w, i) => {
    if (!/\p{Script=Latin}/u.test(w)) return true;
    if (!/^\p{Lu}/u.test(w)) return false;
    return !(i === 0 && FUNCTION_WORDS.has(fold(w)));
  });
}

/** A denial, not counting the abbreviation "no." before a number ("catalogue no. EP-1234", "Symphony No. 5"), which would otherwise license any "not". */
const denies = (text: string) => hasNegation(text.replace(/\bno\.\s*(?=\S*\d)/gi, " "));

function licensed(cited: readonly CitableClaim[], allowed: readonly string[]): Set<string> {
  const set = new Set<string>();
  for (const text of [...cited.map((c) => c.text), ...allowed]) {
    const folded = fold(text);
    for (const t of tokens(folded)) set.add(t);
    for (const m of folded.matchAll(/\b\d{4}-(\d{2})(?:-\d{2})?\b/g)) if (MONTHS[Number(m[1]) - 1]) set.add(MONTHS[Number(m[1]) - 1]);
    for (const m of folded.matchAll(/\b(\d{4})-\d{2}/g)) set.add(m[1]);
  }
  return set;
}

/**
 * Checks every sentence of the prose against the claims it cites. `boilerplate` sentences (the archive sentence, the invitation) are fixed text
 * and need no claim; `allowed` names (the recording's title and transliteration, "Music Madras") may appear anywhere.
 */
export function checkTraceability(prose: string, claims: readonly CitableClaim[], options: { boilerplate?: readonly string[]; allowed?: readonly string[] } = {}): SentenceProblem[] {
  const byId = new Map(claims.map((c) => [c.id, c]));
  const boilerplate = new Set((options.boilerplate ?? []).map((b) => fold(b)));
  const problems: SentenceProblem[] = [];
  for (const sentence of splitSentences(prose)) {
    const add = (problem: string) => problems.push({ sentence, problem });
    if (boilerplate.has(fold(sentence))) continue;
    if (!SENTENCE_END.test(sentence.replace(MARKER, "").trim())) add("does not end like a sentence");
    for (const b of findBannedPhrases(sentence)) add(`banned wording "${b}"`);
    const ids = [...sentence.matchAll(MARKER)].map((m) => m[1]);
    if (ids.length === 0) {
      add("cites no claim: every sentence must cite the claims it states");
      continue;
    }
    const unknown = ids.filter((id) => !byId.has(id));
    for (const id of unknown) add(`cites [${id}], which is not a usable claim`);
    const cited = ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
    if (cited.length === 0) continue;
    const ok = licensed(cited, options.allowed ?? []);
    const body = sentence.replace(MARKER, " ");
    for (const t of tokens(body)) {
      if ((hasDigit(t) || QUANTITY_WORDS.has(t) || MONTHS.includes(t)) && !ok.has(t)) add(`the number, date or quantity "${t}" is not in the cited claims`);
    }
    for (const name of namesIn(body)) {
      const parts = tokens(name);
      if (parts.some((p) => !ok.has(p))) add(`the name "${name}" is not in the cited claims`);
    }
    if (denies(body) && !cited.some((c) => denies(c.text))) add("contains a denial that no cited claim makes");
    if (cited.some((c) => c.weak) && !ATTRIBUTION.test(body)) add(`states a WEAK claim (${cited.filter((c) => c.weak).map((c) => c.id).join(", ")}) as plain fact; say who says it ("According to …")`);
    const specific = tokens(body).some((t) => hasDigit(t)) || namesIn(body).length > 0;
    if (!specific) add("generic: the sentence names nothing and dates nothing");
  }
  return problems;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Similarity across drafts

export const NEAR_DUPLICATE_THRESHOLD = 0.5;

export interface NearDuplicate {
  a: string;
  b: string;
  similarity: number;
  sameOpening: boolean;
}

/** Pairs of drafts (of different videos) that are near-copies, or that share an opening once each title is removed. Boilerplate is ignored. */
export function findNearDuplicates(drafts: ReadonlyArray<{ id: string; prose: string; title: string }>, options: { threshold?: number; boilerplate?: readonly string[] } = {}): NearDuplicate[] {
  const threshold = options.threshold ?? NEAR_DUPLICATE_THRESHOLD;
  const boiler = new Set((options.boilerplate ?? []).map((b) => fold(b)));
  const prepared = drafts.map((d) => {
    const sentences = splitSentences(d.prose.replace(MARKER, "")).filter((s) => !boiler.has(fold(s)));
    const strip = (s: string) => fold(s).split(fold(d.title)).join(" ");
    return { id: d.id, body: sentences.map(strip).join(" "), opening: strip(sentences[0] ?? "").replace(/\s+/g, " ").trim() };
  });
  const out: NearDuplicate[] = [];
  for (let i = 0; i < prepared.length; i++) {
    for (let j = i + 1; j < prepared.length; j++) {
      const similarity = shingleSimilarity(prepared[i].body, prepared[j].body);
      const sameOpening = prepared[i].opening.length > 0 && prepared[i].opening === prepared[j].opening;
      if (similarity >= threshold || sameOpening) out.push({ a: prepared[i].id, b: prepared[j].id, similarity: Math.round(similarity * 100) / 100, sameOpening });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// All of gate 3 for one draft

export interface DraftCheck {
  ok: boolean;
  problems: SentenceProblem[];
}

export function checkDraftProse(prose: string, input: { title: string; transliteration?: string | null; claims: readonly CitableClaim[]; boilerplate?: readonly string[]; allowed?: readonly string[] }): DraftCheck {
  const opening = checkOpeningSentence(prose, input).map((problem) => ({ sentence: splitSentences(prose)[0] ?? "", problem }));
  const allowed = [input.title, input.transliteration ?? "", ...(input.allowed ?? [])].filter(Boolean);
  const problems = [...opening, ...checkTraceability(prose, input.claims, { boilerplate: input.boilerplate, allowed })];
  return { ok: problems.length === 0, problems };
}
