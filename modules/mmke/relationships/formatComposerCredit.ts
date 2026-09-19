// Pure helpers over already-loaded relationship data (ADR §3 boundary rule
// — this module never imports Prisma; modules/db/repositories does the
// actual querying, e.g. getCanonicalContextForRevision, and passes plain
// data here).

export function dedupeById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Map<string, T>();
  for (const item of items) {
    seen.set(item.id, item);
  }
  return Array.from(seen.values());
}

/**
 * Formats a human-readable composer credit line from an already-loaded
 * list of composer names, e.g. for a recording that sets multiple works
 * by different composers: ["J.S. Bach", "G.F. Handel"] -> "J.S. Bach and
 * G.F. Handel". Deduplicates by name and preserves first-seen order.
 */
export function formatComposerCredit(composerNames: string[]): string {
  const unique = Array.from(new Set(composerNames.map((name) => name.trim()).filter(Boolean)));

  if (unique.length === 0) {
    return "";
  }
  if (unique.length === 1) {
    return unique[0];
  }
  if (unique.length === 2) {
    return `${unique[0]} and ${unique[1]}`;
  }
  return `${unique.slice(0, -1).join(", ")}, and ${unique[unique.length - 1]}`;
}
