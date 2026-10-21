import { PLAYLIST_LIMITS } from "../../mmke/playlists/playlistFields";
import type { EvidenceSet } from "../../mmke/playlists/playlistEvidence";

// Phase 6K-5, strengthened in 6K fix F5 — model output is UNTRUSTED. These checks run on everything the playlist assistant returns, whichever
// provider produced it, and refuse anything that is not what was asked for or that the evidence does not support. They are deterministic and
// conservative: a draft that fails is discarded with a reason the editor can act on (usually: supply more context), never silently "fixed".
//
// WHAT THE DRAFT CHECKS DO AND DO NOT ESTABLISH — stated plainly, because "validated" is easy to over-read:
//   They establish, mechanically and reliably, that every sentence (a) is exactly one sentence the model itself attributed to named evidence,
//   (b) quotes that evidence VERBATIM, and (c) contains no word, name, number, quantity, negation, comparison or causal link that does not appear in
//   the evidence it cites (checked word by word, for every word including the first of a sentence, in any script, with numbers and number words
//   always required to appear). The page text is ASSEMBLED FROM those sentences by code, so the text cannot say anything the checked sentences do not.
//   They CANNOT establish that a sentence means what its evidence means: words from the evidence can be recombined into a statement the evidence does
//   not make. So a draft that passes is only ever "needs human verification" — never "verified" — and it can only be accepted after a person
//   confirms they read each statement against its cited evidence.
//
// RESIDUAL LIMITATIONS (do not "fix" these by loosening string matching; the human gate is the control):
//   - Recombination: with evidence "The junior choir sang. The senior choir was absent." the sentence "The senior choir sang." passes, because every word
//     appears. Only a reader can see it contradicts the evidence. Negations are tied to quotations (a sentence cannot add or drop a quoted "not"), which
//     blocks the simplest reversals but is not semantic understanding.
//   - Languages: the function-word, neutral-vocabulary, number-word and negation lists, and the stemmer, are English. Text in any other script is checked
//     EXACTLY, token by token, with its combining marks kept (so Tamil கல் and கால் differ) and no stemming: every word of such a sentence must appear
//     in the evidence in the same form. That is strict (it rejects inflected forms), never permissive.
//   - Uploader-supplied text (video titles) enters the evidence and so licenses its own words; it can never instruct the model or this checker, but a
//     misleading title is evidence like any other. The human reads each sentence beside the evidence it cites.
//   - Lexical stems are conservative but can still conflate unrelated words in rare cases; a false acceptance is caught by the same human gate, a false
//     rejection costs the editor one retry.

export class PlaylistAiOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlaylistAiOutputError";
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const URL_OR_MARKUP = /https?:\/\/|www\.|<\/?[a-z!][^>]*>|`|\]\(|[\w.+-]+@[\w-]+\.[\w.]+/i;

// ---------------------------------------------------------------------------------------------------------------------------------
// The interview question
// ---------------------------------------------------------------------------------------------------------------------------------

export type ValidatedQuestion = { kind: "QUESTION"; question: string; reason: string } | { kind: "ENOUGH_CONTEXT"; reason: string };

export const QUESTION_MAX_LENGTH = 300;

export function validateInterviewOutput(output: unknown, alreadyAsked: readonly string[]): ValidatedQuestion {
  if (!isRecord(output)) throw new PlaylistAiOutputError("The assistant's reply was not in the expected shape.");
  const reason = typeof output.reason === "string" ? output.reason.trim().slice(0, 500) : "";
  if (output.outputType === "ENOUGH_CONTEXT") return { kind: "ENOUGH_CONTEXT", reason };
  if (output.outputType !== "QUESTION" || typeof output.question !== "string") throw new PlaylistAiOutputError("The assistant's reply was not in the expected shape.");
  const question = output.question.replace(/\s+/g, " ").trim();
  if (!question) throw new PlaylistAiOutputError("The assistant proposed an empty question.");
  if (question.length > QUESTION_MAX_LENGTH) throw new PlaylistAiOutputError(`The assistant's question was longer than ${QUESTION_MAX_LENGTH} characters.`);
  if (!question.endsWith("?")) throw new PlaylistAiOutputError("The assistant's reply was not a question.");
  if ((question.match(/\?/g) ?? []).length !== 1) throw new PlaylistAiOutputError("The assistant asked more than one question; only one is allowed at a time.");
  if (URL_OR_MARKUP.test(question)) throw new PlaylistAiOutputError("The assistant's question contained a link or markup.");
  // Any script: an ASCII-only normalisation would reduce every non-Latin question to an empty string and call two different ones "the same".
  const normalised = (s: string) => s.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}\p{M}]+/gu, " ").trim();
  if (alreadyAsked.some((q) => normalised(q) === normalised(question))) throw new PlaylistAiOutputError("The assistant repeated a question that has already been asked.");
  return { kind: "QUESTION", question, reason };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The draft
// ---------------------------------------------------------------------------------------------------------------------------------

export interface DraftSentence {
  /** Exactly one sentence. */
  text: string;
  /** The evidence items it rests on. */
  evidenceIds: string[];
  /** Verbatim phrases from those items. */
  quotes: string[];
  /** Starts a new paragraph (introductions only). */
  newParagraph: boolean;
}

/** The only state a passing draft can be in. There is deliberately no "VERIFIED" state in code: verification is a person's act, recorded when they accept. */
export type DraftVerification = "NEEDS_HUMAN_VERIFICATION";

export type ValidatedDraft =
  | { kind: "DRAFT"; text: string; sentences: DraftSentence[]; verification: DraftVerification }
  | { kind: "INFORMATION_GAP"; missing: string };

/** What the mechanical checks do and do not establish, in the words Studio shows beside every draft. */
export const DRAFT_CHECKS_ESTABLISH = "Every sentence quotes the evidence it cites, and every word, name, number and quantity in it appears in that evidence.";
export const DRAFT_CHECKS_DO_NOT_ESTABLISH = "They cannot tell whether a sentence says something the evidence does not say, or reverses what it says, and they check only English wording loosely (other languages must match the evidence word for word). Only you can check meaning.";

const MAX_SENTENCES = 30;
const MAX_SENTENCE_LENGTH = 400;
const MAX_QUOTES = 3;
const MAX_QUOTE_LENGTH = 200;
const MIN_QUOTE_LENGTH = 4;
const MAX_CITED_ITEMS = 6;

// Words that carry no claim about the subject. Deliberately SMALL and plain: anything not listed here must appear in the cited evidence. Negations
// (not, no, never, without), comparatives and superlatives (more, most, best), quantifiers (all, every, only, both) and causal or sequential links
// (because, since, after, before, then, so) are deliberately NOT here — they change what a sentence claims, so they need support like any other word.
const FUNCTION_WORDS: ReadonlySet<string> = new Set([
  "the", "a", "an", "this", "that", "these", "those",
  "of", "in", "on", "at", "by", "for", "with", "from", "to", "into", "over", "under", "between", "during", "about", "as", "through", "within",
  "and", "or", "than", "while", "when", "where", "which", "who", "whom", "whose",
  "it", "its", "they", "their", "them", "he", "she", "his", "her", "we", "our", "you", "your",
  "is", "are", "was", "were", "be", "been", "being", "has", "have", "had", "do", "does", "did",
  "also", "there",
]);

// Words that describe the PAGE rather than make a claim about its subject ("This playlist brings together …").
const NEUTRAL_VOCABULARY: ReadonlySet<string> = new Set(["playlist", "playlists", "video", "videos", "recording", "recordings", "collection", "selection", "page", "brings", "together", "includes", "features", "presents", "gathers", "collects", "contains", "here"]);

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/**
 * How every comparison is made: NFKC, lower-case, typographic quotes unified, and accents removed from LATIN letters only (Dvořák = Dvorak).
 * Combining marks of every other script are KEPT: in Tamil, Devanagari and the other Indic scripts the vowel signs are marks, and removing them
 * would make materially different words identical (கல் "stone" and கால் "leg" would both become கல). Matching in those scripts is therefore exact.
 */
function fold(text: string): string {
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
function tokens(text: string): string[] {
  return fold(text).match(/[\p{L}\p{N}\p{M}‌‍]+(?:'[\p{L}\p{M}]+)*/gu) ?? [];
}

/**
 * A light, deterministic stem for plain English words only, so plural and tense endings do not cause false rejections (carol / carols,
 * sing / singing). It is deliberately conservative: a word is never cut to fewer than four letters (so "news" does not become "new"), words ending
 * in -ss, -us or -is are left alone, and any word that is not plain ASCII Latin (every other script, and Latin with letters outside a-z) is compared
 * EXACTLY: there is no stemming for languages this does not understand. Applied to both sides.
 */
function stem(word: string): string {
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
const ABBREVIATIONS: ReadonlySet<string> = new Set(["st", "mr", "mrs", "ms", "dr", "prof", "rev", "fr", "sr", "jr", "mt", "ft", "vs", "no", "nos", "op", "vol", "bwv", "kv", "hob", "cf", "co", "bros"]);
const SENTENCE_END = /[.!?…。！？।॥]["'”’»)\]]*$/u;

/**
 * Whether the text holds MORE than one sentence. A "." (or "!" / "?") followed by space ends a sentence unless it follows a known abbreviation or a
 * single initial, or the next word begins in lower case (an abbreviation in the middle of a sentence); CJK and Devanagari terminators need no space.
 */
function containsSentenceBoundary(text: string): boolean {
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
const NEGATION = /(?:^|[^\p{L}])(?:not|no|never|none|neither|nor|without|cannot)(?![\p{L}])|n't(?![\p{L}])/iu;
const hasNegation = (text: string) => NEGATION.test(fold(text));

const hasDigit = (word: string) => /\p{N}/u.test(word);

/** Number words, ordinals and vague quantities: always claims, so they must appear in the cited evidence like any number. */
const QUANTITY_WORDS: ReadonlySet<string> = new Set([
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty",
  "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety", "hundred", "hundreds", "thousand", "thousands", "million", "millions", "dozen", "dozens",
  "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth", "once", "twice", "thrice", "single", "several", "many", "few", "couple", "numerous", "both", "half",
]);

function evidenceVocabulary(cited: readonly { text: string }[]): { stems: Set<string>; exact: Set<string>; text: string } {
  const stems = new Set<string>();
  const exact = new Set<string>();
  const folded = cited.map((c) => fold(c.text));
  for (const text of folded) {
    for (const t of tokens(text)) {
      exact.add(t);
      stems.add(stem(t));
    }
    // A date in the evidence (2021-12-19) also licenses its month's name.
    for (const m of text.matchAll(/\b\d{4}-(\d{2})-\d{2}\b/g)) {
      const month = MONTHS[Number(m[1]) - 1];
      if (month) {
        exact.add(month);
        stems.add(stem(month));
      }
    }
  }
  return { stems, exact, text: folded.join("\n") };
}

/** The words of a sentence that the cited evidence does not support. Every word is checked, including the first of the sentence. */
function unsupportedWords(sentence: string, vocab: { stems: Set<string>; exact: Set<string> }): string[] {
  const out: string[] = [];
  for (const token of tokens(sentence)) {
    if (hasDigit(token)) {
      if (!vocab.exact.has(token)) out.push(token); // numbers must match exactly, whatever their length
      continue;
    }
    if (QUANTITY_WORDS.has(token)) {
      if (!vocab.exact.has(token)) out.push(token);
      continue;
    }
    const base = token.replace(/'s$/, "");
    if (FUNCTION_WORDS.has(base) || NEUTRAL_VOCABULARY.has(base)) continue;
    if (vocab.stems.has(stem(token)) || vocab.exact.has(token)) continue;
    out.push(token);
  }
  return [...new Set(out)];
}

function quoteIsVerbatim(quote: string, citedFoldedText: string): boolean {
  const q = fold(quote);
  return q.length >= MIN_QUOTE_LENGTH && citedFoldedText.includes(q);
}

function assemble(sentences: readonly DraftSentence[], target: "SUMMARY" | "BODY"): string {
  if (target === "SUMMARY") return sentences.map((s) => s.text).join(" ");
  let out = "";
  sentences.forEach((s, index) => {
    if (index === 0) out = s.text;
    else out += `${s.newParagraph ? "\n\n" : " "}${s.text}`;
  });
  return out;
}

/** Validates (or re-validates, from stored sentences) a draft against the evidence set it is about to rest on. */
export function validateDraftOutput(output: unknown, evidence: EvidenceSet, target: "SUMMARY" | "BODY"): ValidatedDraft {
  if (!isRecord(output)) throw new PlaylistAiOutputError("The assistant's reply was not in the expected shape.");
  if (output.outputType === "INFORMATION_GAP") {
    const missing = typeof output.missing === "string" ? output.missing.trim().slice(0, 600) : "";
    return { kind: "INFORMATION_GAP", missing: missing || "More context is needed before this can be written without guessing." };
  }
  if (output.outputType !== "DRAFT" || !Array.isArray(output.sentences)) throw new PlaylistAiOutputError("The assistant's reply was not in the expected shape.");
  if (output.sentences.length === 0) throw new PlaylistAiOutputError("The assistant returned an empty draft.");
  if (output.sentences.length > MAX_SENTENCES) throw new PlaylistAiOutputError(`The draft has more than ${MAX_SENTENCES} sentences.`);

  const byId = new Map(evidence.items.map((item) => [item.id, item]));
  const sentences: DraftSentence[] = [];

  output.sentences.forEach((raw, index) => {
    const label = `Sentence ${index + 1}`;
    if (!isRecord(raw) || typeof raw.text !== "string" || !Array.isArray(raw.evidenceIds) || !Array.isArray(raw.quotes) || raw.evidenceIds.some((v) => typeof v !== "string") || raw.quotes.some((v) => typeof v !== "string")) {
      throw new PlaylistAiOutputError(`${label} was not in the expected shape.`);
    }
    const text = raw.text.replace(/\s+/g, " ").trim();
    if (!text) throw new PlaylistAiOutputError(`${label} is empty.`);
    if (text.length > MAX_SENTENCE_LENGTH) throw new PlaylistAiOutputError(`${label} is longer than ${MAX_SENTENCE_LENGTH} characters.`);
    if (URL_OR_MARKUP.test(text) || /^\s*[#*>-]/.test(text)) throw new PlaylistAiOutputError(`${label} contains a link, markup or formatting; plain text only is allowed.`);
    if (!SENTENCE_END.test(text)) throw new PlaylistAiOutputError(`${label} does not end like a sentence.`);
    if (containsSentenceBoundary(text)) throw new PlaylistAiOutputError(`${label} is more than one sentence; each entry must be exactly one, so that each can be checked against its own evidence.`);

    const evidenceIds = [...new Set(raw.evidenceIds as string[])];
    if (evidenceIds.length === 0) throw new PlaylistAiOutputError(`${label} cites no evidence: “${text.slice(0, 100)}”.`);
    if (evidenceIds.length > MAX_CITED_ITEMS) throw new PlaylistAiOutputError(`${label} cites more than ${MAX_CITED_ITEMS} evidence items.`);
    const unknown = evidenceIds.find((id) => !byId.has(id));
    if (unknown) throw new PlaylistAiOutputError(`${label} cites evidence that does not exist (“${unknown.slice(0, 40)}”).`);
    const cited = evidenceIds.map((id) => byId.get(id)!);
    const vocab = evidenceVocabulary(cited);

    const quotes = (raw.quotes as string[]).map((q) => q.replace(/\s+/g, " ").trim()).filter((q) => q.length > 0);
    if (quotes.length === 0 || quotes.length > MAX_QUOTES) throw new PlaylistAiOutputError(`${label} must quote between 1 and ${MAX_QUOTES} phrases from its evidence.`);
    for (const quote of quotes) {
      if (quote.length > MAX_QUOTE_LENGTH) throw new PlaylistAiOutputError(`${label} has a quotation longer than ${MAX_QUOTE_LENGTH} characters.`);
      if (!quoteIsVerbatim(quote, vocab.text)) throw new PlaylistAiOutputError(`${label} quotes “${quote.slice(0, 60)}”, which is not in the evidence it cites.`);
    }

    // A denial must be evidenced where it is said, and a quoted denial must not be dropped: this catches a sentence that flips a quoted "not".
    const sentenceDenies = hasNegation(text);
    const quoteDenies = quotes.some((q) => hasNegation(q));
    if (sentenceDenies && !quoteDenies) throw new PlaylistAiOutputError(`${label} contains a denial (“not”, “no”, “never” …) that none of its quotations shows, so it was discarded.`);
    if (quoteDenies && !sentenceDenies) throw new PlaylistAiOutputError(`${label} quotes a denial from the evidence but does not say it, so it could reverse what the evidence says; it was discarded.`);

    const unsupported = unsupportedWords(text, vocab);
    if (unsupported.length > 0) {
      throw new PlaylistAiOutputError(`${label} uses ${unsupported.slice(0, 5).map((w) => `“${w}”`).join(", ")}, which ${unsupported.length === 1 ? "is" : "are"} not in the evidence it cites, so it was discarded.`);
    }
    // The quotations must actually bear on the sentence, not pad it: at least one of its content words must occur inside a quotation.
    const quoted = new Set(quotes.flatMap((q) => tokens(q)).map(stem));
    const contentWords = tokens(text).filter((t) => !FUNCTION_WORDS.has(t.replace(/'s$/, "")) && !NEUTRAL_VOCABULARY.has(t.replace(/'s$/, "")));
    if (contentWords.length > 0 && !contentWords.some((t) => quoted.has(stem(t)))) {
      throw new PlaylistAiOutputError(`${label} quotes nothing that it actually says, so its quotations do not show what it rests on.`);
    }

    const newParagraph = raw.newParagraph === true;
    if (newParagraph && target === "SUMMARY") throw new PlaylistAiOutputError("A summary must be a single paragraph.");
    sentences.push({ text, evidenceIds, quotes, newParagraph });
  });

  const text = assemble(sentences, target);
  const limit = target === "SUMMARY" ? PLAYLIST_LIMITS.summary : PLAYLIST_LIMITS.body;
  if (text.length > limit) throw new PlaylistAiOutputError(`The draft is longer than the ${limit}-character limit for a ${target.toLowerCase()}.`);
  if (URL_OR_MARKUP.test(text)) throw new PlaylistAiOutputError("The draft contains a link or markup; plain text only is allowed.");
  return { kind: "DRAFT", text, sentences, verification: "NEEDS_HUMAN_VERIFICATION" };
}
