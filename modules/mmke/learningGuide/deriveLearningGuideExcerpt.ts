// Phase 6G-17 — a pure, Prisma-free (ADR §3 boundary rule) mechanical
// derivation of a short plain-text excerpt from a LearningGuide's own
// stored contentMarkdown. This is never a summary written or rewritten by
// anyone/anything else — it is the guide's own opening text, with basic
// Markdown syntax stripped and truncated at a word boundary, exactly the
// same kind of "first N characters of body copy" excerpt any archive
// listing produces. No fact is added, inferred, or reworded.

export function deriveLearningGuideExcerpt(contentMarkdown: string | null, maxLength = 200): string | null {
  if (!contentMarkdown) return null;

  const plainText = contentMarkdown
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_`>]/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();

  if (plainText.length === 0) return null;
  if (plainText.length <= maxLength) return plainText;

  const truncated = plainText.slice(0, maxLength);
  const lastSpace = truncated.lastIndexOf(" ");
  const base = lastSpace > 0 ? truncated.slice(0, lastSpace) : truncated;
  return `${base.trim()}…`;
}
