// Phase 6K-1 — the editorial content blocks the public Museum knows how to place. This registry is the TECHNICAL BINDING between a
// place on a page and a stored EditorialContent row (matched by slug): the code decides WHERE a block can appear and which fields it
// uses; the words themselves are stored content with a draft/publish lifecycle and are never defined here. A block that has not been
// created and published simply renders nothing (no placeholder copy is invented in code). Listed in the exception register
// (docs/architecture/ADR-0002-settings-editorial-and-visibility.md).

export interface EditorialBlockDefinition {
  /** The stored slug the code looks the block up by. Part of the code↔content contract; never shown to visitors. */
  slug: string;
  /** What Studio calls it. */
  label: string;
  /** What the block is for, shown to the editor. */
  purpose: string;
  /** Where it appears on the public site. */
  usedOn: string;
  /** Whether the block has a body (paragraphs and simple headings). */
  usesBody: boolean;
  /** Whether the block carries SEO title and description. */
  usesSeo: boolean;
}

export const EDITORIAL_BLOCKS: readonly EditorialBlockDefinition[] = [
  {
    slug: "museum-home-intro",
    label: "Homepage introduction",
    purpose: "The opening statement of the Museum homepage: what Music Madras is and why it exists.",
    usedOn: "Homepage, beneath the logo",
    usesBody: true,
    usesSeo: false,
  },
  {
    slug: "museum-home-story",
    label: "Homepage story",
    purpose: "The longer account of what Music Madras preserves and how the archive grows.",
    usedOn: "Homepage, story section",
    usesBody: true,
    usesSeo: false,
  },
  {
    slug: "museum-footer-tagline",
    label: "Footer tagline",
    purpose: "One line of text shown in the Museum footer. Put the line in the title field.",
    usedOn: "Footer of every public page",
    usesBody: false,
    usesSeo: false,
  },
  {
    slug: "museum-site-seo",
    label: "Site title and description (SEO)",
    purpose: "The default search title and description for the homepage and for pages that have none of their own.",
    usedOn: "Homepage metadata",
    usesBody: false,
    usesSeo: true,
  },
  {
    slug: "museum-videos-intro",
    label: "Videos page introduction",
    purpose: "A short introduction above the public video catalogue.",
    usedOn: "/videos",
    usesBody: true,
    usesSeo: false,
  },
  {
    slug: "museum-playlists-intro",
    label: "Playlists page introduction",
    purpose: "A short introduction above the public playlist index.",
    usedOn: "/playlists",
    usesBody: true,
    usesSeo: false,
  },
];

export function findEditorialBlock(slug: string): EditorialBlockDefinition | undefined {
  return EDITORIAL_BLOCKS.find((block) => block.slug === slug);
}

/** Validation limits for editorial fields (data-integrity rules, kept in code). */
export const EDITORIAL_LIMITS = {
  title: 160,
  body: 12000,
  seoTitle: 120,
  seoDescription: 320,
} as const;

export interface EditorialFields {
  title: string;
  body: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
}

/** Problems that stop a draft being saved at all (limits). */
export function validateEditorialFieldLimits(fields: EditorialFields): string[] {
  const problems: string[] = [];
  if (fields.title.length > EDITORIAL_LIMITS.title) problems.push(`The title is longer than ${EDITORIAL_LIMITS.title} characters.`);
  if ((fields.body ?? "").length > EDITORIAL_LIMITS.body) problems.push(`The body is longer than ${EDITORIAL_LIMITS.body} characters.`);
  if ((fields.seoTitle ?? "").length > EDITORIAL_LIMITS.seoTitle) problems.push(`The SEO title is longer than ${EDITORIAL_LIMITS.seoTitle} characters.`);
  if ((fields.seoDescription ?? "").length > EDITORIAL_LIMITS.seoDescription) problems.push(`The SEO description is longer than ${EDITORIAL_LIMITS.seoDescription} characters.`);
  return problems;
}

/** Problems that stop a draft being PUBLISHED: what this block needs in order to be worth showing. */
export function listPublishProblems(block: EditorialBlockDefinition, fields: EditorialFields): string[] {
  const problems = [...validateEditorialFieldLimits(fields)];
  if (!fields.title.trim()) problems.push("A title is required.");
  if (block.usesBody && !(fields.body ?? "").trim()) problems.push("A body is required for this block.");
  if (block.usesSeo) {
    if (!(fields.seoTitle ?? "").trim()) problems.push("An SEO title is required for this block.");
    if (!(fields.seoDescription ?? "").trim()) problems.push("An SEO description is required for this block.");
  }
  return problems;
}
