// Archive search ranking — pure and deterministic (Prisma-free, ADR §3 boundary rule). Explainable by one sentence: a title that IS the query comes first,
// then titles that START with it, then titles with a WORD that starts with it, then titles that merely contain it, then records that matched on some other
// field (a description, a city); within each tier, alphabetical by title, then by id so the order never changes between two identical requests.
// No scoring model, no AI, no popularity signal.

/** Comparison form: Unicode-normalised, case-folded, whitespace collapsed; accents are ignored on LATIN letters only (never on other scripts, where marks carry meaning). */
export function normaliseForRanking(text: string): string {
  return text
    .normalize("NFKC")
    .normalize("NFD")
    .replace(/(\p{Script=Latin})\p{M}+/gu, "$1")
    .normalize("NFC")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export const RELEVANCE_TIERS = { EXACT: 0, PREFIX: 1, WORD_PREFIX: 2, CONTAINS: 3, OTHER_FIELD: 4 } as const;
export type RelevanceTier = (typeof RELEVANCE_TIERS)[keyof typeof RELEVANCE_TIERS];

/** How strongly `label` (the record's display title) matches `query`. Lower is better. A record that matched on another field gets OTHER_FIELD. */
export function relevanceTier(query: string, label: string): RelevanceTier {
  const q = normaliseForRanking(query);
  const l = normaliseForRanking(label);
  if (q.length === 0) return RELEVANCE_TIERS.OTHER_FIELD;
  if (l === q) return RELEVANCE_TIERS.EXACT;
  if (l.startsWith(q)) return RELEVANCE_TIERS.PREFIX;
  if (l.split(" ").some((word) => word.startsWith(q))) return RELEVANCE_TIERS.WORD_PREFIX;
  if (l.includes(q)) return RELEVANCE_TIERS.CONTAINS;
  return RELEVANCE_TIERS.OTHER_FIELD;
}

export interface RankCandidate {
  id: string;
  label: string;
}

/** The candidates in relevance order, each id once (a record reached through two query paths appears a single time). */
export function rankCandidates(query: string, candidates: readonly RankCandidate[]): string[] {
  const seen = new Set<string>();
  const unique: Array<RankCandidate & { tier: RelevanceTier; key: string }> = [];
  for (const c of candidates) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    unique.push({ ...c, tier: relevanceTier(query, c.label), key: normaliseForRanking(c.label) });
  }
  unique.sort((a, b) => a.tier - b.tier || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return unique.map((c) => c.id);
}
