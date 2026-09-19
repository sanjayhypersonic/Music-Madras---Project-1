// Duplicate-entity prevention (brief §42, ADR §8) — pure logic, no
// database. This deliberately implements only the conservative,
// exact-normalized-match case (e.g. "Johann Sebastian Bach" typed twice
// with different casing/whitespace). Fuzzy/similarity matching (e.g.
// catching "J.S. Bach" as a likely duplicate of "Johann Sebastian Bach")
// needs a real similarity strategy — trigram matching via Postgres
// pg_trgm is the ADR's stated choice (§8) — and is meaningfully testable
// only against a real Studio entity-picker UX and real data, so it
// remains deferred (see this directory's earlier README, still accurate
// for that part).
//
// The repository calling this is expected to fetch a reasonably-scoped
// candidate list itself (e.g. "composers whose name contains any word of
// the input") and pass the plain names here — this module never touches
// Prisma.

export class DuplicateEntityError extends Error {
  constructor(entityType: string, matchedName: string) {
    super(
      `A ${entityType} named "${matchedName}" already exists. Select the existing record ` +
        `instead of creating a duplicate.`
    );
    this.name = "DuplicateEntityError";
  }
}

export function normalizeNameForComparison(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Returns the first existing name that exactly matches the candidate once
 * both are normalized (trimmed, lowercased, whitespace-collapsed), or
 * `null` if there is no such match.
 */
export function findExactNormalizedDuplicate(
  candidateName: string,
  existingNames: string[]
): string | null {
  const normalizedCandidate = normalizeNameForComparison(candidateName);
  const match = existingNames.find(
    (existing) => normalizeNameForComparison(existing) === normalizedCandidate
  );
  return match ?? null;
}
