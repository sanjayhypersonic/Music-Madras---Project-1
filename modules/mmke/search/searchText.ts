// Phase 6K lifecycle hardening (F20) — how visitor-typed search text is prepared before it reaches a database `contains` filter.
//
// Prisma's `contains` / `mode: "insensitive"` compiles to ILIKE with the text between % signs and does NOT escape LIKE wildcards: a visitor typing "%" or
// "_" would match every row, and a long run of them is a needless pattern for the database to evaluate. The text is parameterised (there is no SQL injection
// here), but it must be treated as a literal. Every public search goes through these two functions: bound the length, then escape the wildcards.
// Pure and Prisma-free (ADR §3 boundary rule).

/** The most characters of a search that are used; the rest is ignored. A bound on the work a single request can ask of the database, not editorial policy. */
export const SEARCH_MAX_LENGTH = 100;

/** Whitespace collapsed, trimmed, and cut to SEARCH_MAX_LENGTH characters (by code point, so a character is never split). Undefined when nothing is left. */
export function normaliseSearchText(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  // Control characters (a NUL byte in particular, which PostgreSQL rejects as an invalid text value and which would otherwise become an unhandled error) are just spaces.
  const trimmed = [...raw.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim()].slice(0, SEARCH_MAX_LENGTH).join("").trim();
  return trimmed === "" ? undefined : trimmed;
}

/** Makes "%", "_" and "\" literal in a LIKE pattern (PostgreSQL's default escape character is the backslash). */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

/** The text to hand to a `contains` filter: bounded, whitespace-normalised and escaped. An empty search yields an empty string (the caller does not filter on it). */
export function likeNeedle(raw: string | undefined | null): string {
  return escapeLikePattern(normaliseSearchText(raw) ?? "");
}
