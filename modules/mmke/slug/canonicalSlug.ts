import { slugify } from "./slugify";

// The slug rule for NEW records made from approved editorial facts (credits pipeline, 2026-11-17; project register R-31). Pure and Prisma-free.
//
//   1. The source text is the CANONICAL title (or name). When that title is written in a non-Latin script (for example Tamil), the source is its
//      transliteration instead, because slugs keep Latin letters and digits only. The long YouTube title is never a source.
//   2. slugify() as everywhere else (lowercase, diacritics stripped, every other run of characters one hyphen), so a Latin title gets exactly the slug
//      it always got, except that it is cut to at most CANONICAL_SLUG_MAX_LENGTH characters at a word boundary.
//   3. Never empty: when nothing usable is left, the caller's fallback word ("recording", "work", ...) is used.
//   4. When the slug is taken: the performance year is appended (when known), then a number: base, base-2025, base-2025-2, base-2025-3, ...
//      Without a year: base, base-2, base-3, ...
// Existing slugs are never regenerated: this is called only when a record is created.

export const CANONICAL_SLUG_MAX_LENGTH = 60;
/** A bound on collision probing; far above anything a real catalogue reaches. */
export const CANONICAL_SLUG_MAX_ATTEMPTS = 50;

export interface CanonicalSlugInput {
  /** The canonical title or name (original script kept). */
  title: string;
  /** The transliteration of a non-Latin title, when one is known. */
  transliteration?: string | null;
  /** The performance year, appended when the plain slug is taken. */
  year?: number | string | null;
  /** The word used when the title yields no Latin letters or digits (e.g. "recording"). */
  fallback: string;
}

/** True when the text contains a letter from a script other than Latin (Tamil, Cyrillic, ...). */
export function hasNonLatinScript(text: string): boolean {
  for (const ch of text) if (/\p{L}/u.test(ch) && !/\p{Script=Latin}/u.test(ch)) return true;
  return false;
}

/** Cuts a slug to `max` characters, at the last hyphen inside the limit when the cut would split a word. */
export function truncateSlug(slug: string, max = CANONICAL_SLUG_MAX_LENGTH): string {
  if (slug.length <= max) return slug;
  const cut = slug.slice(0, max);
  const boundary = slug[max] === "-" ? cut : cut.slice(0, Math.max(cut.lastIndexOf("-"), 0)) || cut;
  return boundary.replace(/-+$/g, "");
}

/** The plain slug (before any collision suffix). Never empty. */
export function canonicalSlugBase(input: CanonicalSlugInput): string {
  const title = input.title.trim();
  const translit = input.transliteration?.trim() ?? "";
  const source = hasNonLatinScript(title) && translit ? translit : title;
  return truncateSlug(slugify(source)) || slugify(input.fallback) || "record";
}

/** The slugs to try, in order: base, then base-year, then base-year-2, ... (or base-2, base-3, ... without a year). */
export function canonicalSlugCandidates(input: CanonicalSlugInput, attempts = CANONICAL_SLUG_MAX_ATTEMPTS): string[] {
  const base = canonicalSlugBase(input);
  const year = input.year === null || input.year === undefined ? "" : String(input.year).trim();
  const stem = /^\d{4}$/.test(year) ? `${base}-${year}` : base;
  const out = [base];
  if (stem !== base) out.push(stem);
  for (let n = 2; out.length < attempts; n++) out.push(`${stem}-${n}`);
  return out;
}

/** The first candidate not taken. Throws when every attempt is taken (never silently reuses a slug). */
export async function resolveCanonicalSlug(input: CanonicalSlugInput, isTaken: (slug: string) => Promise<boolean>): Promise<string> {
  for (const candidate of canonicalSlugCandidates(input)) if (!(await isTaken(candidate))) return candidate;
  throw new Error(`No free slug for "${canonicalSlugBase(input)}" after ${CANONICAL_SLUG_MAX_ATTEMPTS} attempts.`);
}
