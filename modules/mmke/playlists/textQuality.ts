// Phase 6K lifecycle hardening (F13) — what makes a piece of editorial text OBVIOUSLY not worth publishing, in terms an editor can act on.
//
// These checks are deliberately not word counts and do not judge prose, accuracy or style. They catch only things that are demonstrably empty or
// redundant: text with no letters in it, a known placeholder, one character or one word repeated, text that merely repeats another field, and context
// notes that repeat each other. Anything else is a person's judgement; passing these checks proves NOTHING about whether a page is true or good.
// The placeholder list is small and in code on purpose (it is rubric logic, reviewed like code, and listed in the ADR's exception register).

/** Lower-case, NFKC, every run of non-letters/digits collapsed to one space, in any script. The form every comparison here is made in. */
export function comparable(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, " ")
    .trim();
}

// Whole-text placeholders, after comparable(). English only: this is a guard against the obvious, not a language detector.
const PLACEHOLDER_TEXTS: ReadonlySet<string> = new Set([
  "tbd", "tba", "tbc", "todo", "to do", "n a", "na", "none", "null", "nil", "undefined", "unknown", "nothing",
  "test", "testing", "test test", "asdf", "asdfg", "qwerty", "foo", "bar", "foo bar", "abc", "abcd", "xxx", "xx", "lorem ipsum",
  "placeholder", "sample", "example", "sample text", "example text", "text", "some text", "description", "summary", "title", "name",
  "untitled", "untitled playlist", "new playlist", "playlist", "my playlist", "draft", "write here", "type here", "enter text", "coming soon",
]);

const LOREM = /^lorem ipsum\b/;

/** Why a text is an obvious placeholder, or null when it is not. */
export function placeholderReason(text: string): string | null {
  const key = comparable(text);
  if (key === "") return "it has no letters or numbers";
  if (!/\p{L}/u.test(key)) return "it has no letters in it";
  if (PLACEHOLDER_TEXTS.has(key) || LOREM.test(key)) return "it is a placeholder";
  const compact = key.replace(/ /g, "");
  if ([...compact].length === 1) return "it is a single character";
  if (compact.length >= 3 && /^(.)\1+$/u.test(compact)) return "it is one character repeated";
  const words = key.split(" ");
  if (words.length >= 3 && new Set(words).size === 1) return "it is one word repeated";
  return null;
}

/** Two texts that say the same thing as far as a machine can tell: identical once punctuation, case and spacing are ignored. */
export function sameText(a: string, b: string): boolean {
  const x = comparable(a);
  return x !== "" && x === comparable(b);
}

/** A note that merely contains another (or is contained in it) adds nothing: the shorter must be long enough to be a statement, not a stray word. */
const MIN_CONTAINED_LENGTH = 12;

/**
 * Which context notes count. A note is NOT counted when it is a placeholder, repeats an earlier note exactly, or is wholly contained in (or contains) an
 * earlier counted note. Earlier notes win, so the order notes were supplied in decides which is "the duplicate". Returns the counted notes and why the
 * others were not.
 */
export function distinctMeaningfulNotes(notes: readonly string[]): { counted: string[]; ignored: Array<{ index: number; reason: string }> } {
  const counted: string[] = [];
  const keys: string[] = [];
  const ignored: Array<{ index: number; reason: string }> = [];
  notes.forEach((note, index) => {
    const placeholder = placeholderReason(note);
    if (placeholder) {
      ignored.push({ index, reason: placeholder });
      return;
    }
    const key = comparable(note);
    const clash = keys.find((k) => k === key || (Math.min(k.length, key.length) >= MIN_CONTAINED_LENGTH && (k.includes(key) || key.includes(k))));
    if (clash !== undefined) {
      ignored.push({ index, reason: "it repeats another note" });
      return;
    }
    keys.push(key);
    counted.push(note);
  });
  return { counted, ignored };
}
