// Phase 6K-4 — field rules for a playlist page's editable content. These are DATA-INTEGRITY limits (they keep storage and rendering safe), not
// editorial policy: what makes a page good enough to publish is the configurable quality rubric (playlistQuality.ts), not these numbers.
// Body text uses the same safe format as every editorial block (paragraphs and "##"/"###" headings; no HTML, no Markdown).

export const PLAYLIST_LIMITS = {
  title: 160,
  summary: 1000,
  body: 12000,
  seoTitle: 120,
  seoDescription: 320,
  note: 1000,
} as const;

export interface PlaylistFields {
  title: string;
  summary: string | null;
  body: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
}

const clean = (value: string | null | undefined): string | null => {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? null : trimmed;
};

export function normalisePlaylistFields(input: { title: string; summary?: string | null; body?: string | null; seoTitle?: string | null; seoDescription?: string | null }): PlaylistFields {
  return { title: input.title.replace(/\s+/g, " ").trim(), summary: clean(input.summary), body: clean(input.body), seoTitle: clean(input.seoTitle), seoDescription: clean(input.seoDescription) };
}

/** Problems that stop a draft being saved at all. An empty title is allowed on a draft only if the caller says so (creation requires one). */
export function validatePlaylistFieldLimits(fields: PlaylistFields): string[] {
  const problems: string[] = [];
  if (fields.title.length === 0) problems.push("A title is required.");
  if (fields.title.length > PLAYLIST_LIMITS.title) problems.push(`The title is longer than ${PLAYLIST_LIMITS.title} characters.`);
  if ((fields.summary ?? "").length > PLAYLIST_LIMITS.summary) problems.push(`The summary is longer than ${PLAYLIST_LIMITS.summary} characters.`);
  if ((fields.body ?? "").length > PLAYLIST_LIMITS.body) problems.push(`The body is longer than ${PLAYLIST_LIMITS.body} characters.`);
  if ((fields.seoTitle ?? "").length > PLAYLIST_LIMITS.seoTitle) problems.push(`The search title is longer than ${PLAYLIST_LIMITS.seoTitle} characters.`);
  if ((fields.seoDescription ?? "").length > PLAYLIST_LIMITS.seoDescription) problems.push(`The search description is longer than ${PLAYLIST_LIMITS.seoDescription} characters.`);
  return problems;
}
