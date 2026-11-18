// Shared text normalisation for the content guardrails (docs/content-guardrails.md). PURE, Prisma-free (ADR §3).
// Moved here UNCHANGED from modules/ai/structuredOutput/validatePlaylistOutput.ts (2026-11-18) so the playlist draft checks and the guardrail
// checks (modules/mmke/guardrails/*.ts) use one implementation: folding, tokenising in any script, the conservative English stemmer, sentence
// boundaries, negation and quantity words. Change behaviour here only with both test suites (playlistDraft*.test.ts, guardrails*.test.ts).

// Words that carry no claim about the subject. Deliberately SMALL and plain: anything not listed here must appear in the cited evidence. Negations
// (not, no, never, without), comparatives and superlatives (more, most, best), quantifiers (all, every, only, both) and causal or sequential links
// (because, since, after, before, then, so) are deliberately NOT here — they change what a sentence claims, so they need support like any other word.
export const FUNCTION_WORDS: ReadonlySet<string> = new Set([
  "the", "a", "an", "this", "that", "these", "those",
  "of", "in", "on", "at", "by", "for", "with", "from", "to", "into", "over", "under", "between", "during", "about", "as", "through", "within",
  "and", "or", "than", "while", "when", "where", "which", "who", "whom", "whose",
  "it", "its", "they", "their", "them", "he", "she", "his", "her", "we", "our", "you", "your",
  "is", "are", "was", "were", "be", "been", "being", "has", "have", "had", "do", "does", "did",
  "also", "there",
]);

export const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/**
 * How every comparison is made: NFKC, lower-case, typographic quotes unified, and accents removed from LATIN letters only (Dvořák = Dvorak).
 * Combining marks of every other script are KEPT: in Tamil, Devanagari and the other Indic scripts the vowel signs are marks, and removing them
 * would make materially different words identical (கல் "stone" and கால் "leg" would both become கல). Matching in those scripts is therefore exact.
 */
export function fold(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[’‘`´]/g, "'")
    .replace(/[“”]/g, '"')
    .toLowerCase()
    .normalize("NFD")
    .replace(/(\p{Script=Latin})\p{M}+/gu, "$1")
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .trim();
}

/** Words and numbers in ANY script (letters, combining marks, digits and the joiners Indic scripts use), keeping internal apostrophes (david's). */
export function tokens(text: string): string[] {
  return fold(text).match(/[\p{L}\p{N}\p{M}‌‍]+(?:'[\p{L}\p{M}]+)*/gu) ?? [];
}

/**
 * A light, deterministic stem for plain English words only, so plural and tense endings do not cause false rejections (carol / carols,
 * sing / singing). It is deliberately conservative: a word is never cut to fewer than four letters (so "news" does not become "new"), words ending
 * in -ss, -us or -is are left alone, and any word that is not plain ASCII Latin (every other script, and Latin with letters outside a-z) is compared
 * EXACTLY: there is no stemming for languages this does not understand. Applied to both sides.
 */
export function stem(word: string): string {
  if (!/^[a-z']+$/.test(word)) return word;
  const w = word.replace(/'s$/, "").replace(/'/g, "");
  if (/(ches|shes|sses|xes|zes)$/.test(w) && w.length - 2 >= 4) return w.slice(0, -2);
  if (w.endsWith("ies") && w.length - 3 + 1 >= 4) return `${w.slice(0, -3)}y`;
  for (const suffix of ["ing", "ed", "ly", "s"]) {
    if (suffix === "s" && /(ss|us|is)$/.test(w)) continue;
    if (w.endsWith(suffix) && w.length - suffix.length >= 4) return w.slice(0, -suffix.length);
  }
  return w;
}

// Sentence boundaries. A full stop after one of these is an abbreviation, not the end of a sentence ("St. Mary's Church", "Symphony No. 5", "J. S. Bach").
export const ABBREVIATIONS: ReadonlySet<string> = new Set(["st", "mr", "mrs", "ms", "dr", "prof", "rev", "fr", "sr", "jr", "mt", "ft", "vs", "no", "nos", "op", "vol", "bwv", "kv", "hob", "cf", "co", "bros"]);
export const SENTENCE_END = /[.!?…。！？।॥]["'”’»)\]]*$/u;

/**
 * Whether the text holds MORE than one sentence. A "." (or "!" / "?") followed by space ends a sentence unless it follows a known abbreviation or a
 * single initial, or the next word begins in lower case (an abbreviation in the middle of a sentence); CJK and Devanagari terminators need no space.
 */
export function containsSentenceBoundary(text: string): boolean {
  for (const match of text.matchAll(/([.!?…])(\s+)(?=\S)|([。！？।॥])(?=\s*\S)/gu)) {
    const index = match.index ?? 0;
    if (match[3]) return true;
    const before = text.slice(0, index);
    const lastWord = /(\p{L}+)$/u.exec(before)?.[1] ?? "";
    if (match[1] === "." && (ABBREVIATIONS.has(lastWord.toLowerCase()) || (lastWord.length === 1 && /\p{Lu}/u.test(lastWord)))) continue;
    const next = text.slice(index + match[0].length)[0] ?? "";
    if (match[1] === "." && /\p{Ll}/u.test(next)) continue;
    return true;
  }
  return false;
}

// Negation. A sentence that denies something must show the denial IN a quotation (so it is evidenced where it is said, not merely somewhere in the
// cited item), and a quotation that contains a denial must not be dropped from the sentence. English only; other languages get no such check.
export const NEGATION = /(?:^|[^\p{L}])(?:not|no|never|none|neither|nor|without|cannot)(?![\p{L}])|n't(?![\p{L}])/iu;
export const hasNegation = (text: string) => NEGATION.test(fold(text));

export const hasDigit = (word: string) => /\p{N}/u.test(word);

/** Number words, ordinals and vague quantities: always claims, so they must appear in the cited evidence like any number. */
export const QUANTITY_WORDS: ReadonlySet<string> = new Set([
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty",
  "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety", "hundred", "hundreds", "thousand", "thousands", "million", "millions", "dozen", "dozens",
  "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth", "once", "twice", "thrice", "single", "several", "many", "few", "couple", "numerous", "both", "half",
]);
