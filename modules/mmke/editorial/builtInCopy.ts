import type { EditorialFields } from "./editorialBlocks";

// Phase 6K-3 — TRANSITIONAL built-in copy, listed in the exception register (docs/architecture/ADR-0002-settings-editorial-and-visibility.md).
//
// This is the wording the homepage and footer carried before editorial blocks existed. It is shown ONLY while the matching block has never
// been published, so the live site does not go blank on the day the block system ships. Studio labels it plainly as built-in text and offers
// "Start a draft from the built-in text"; once the block is published its own words replace this, and if an editor later takes the block off
// the site on purpose, nothing is shown (the built-in text does not come back). A block with no entry here simply renders nothing until it
// is published. Do NOT add copy to this file for new blocks: create the block and publish it in Studio instead.

export const BUILT_IN_COPY: Readonly<Record<string, EditorialFields>> = {
  "museum-home-intro": {
    title: "Preserving Chennai’s Musical Heritage",
    body: "Music Madras documents and preserves Chennai’s Western Classical Music tradition — its composers, performers, choirs, conductors, venues and recordings — so the city’s concert life remains discoverable for generations to come.",
    seoTitle: null,
    seoDescription: null,
  },
  "museum-home-story": {
    title: "What Music Madras Preserves",
    body: "Music Madras exists to document more than a video library. Behind every recording is a performance — a programme, a venue, an ensemble, and the people who brought it to life. Over time, the archive will connect composers to the musical works they wrote, works to the programmes and performances that featured them, and performances to the recordings and places where they took place.\n\nChennai’s Western Classical Music tradition has been carried for decades by choirs, ensembles, soloists and conductors performing in churches, halls and schools across the city. Music Madras is building the record of that tradition — performance by performance, recording by recording.",
    seoTitle: null,
    seoDescription: null,
  },
  "museum-footer-tagline": {
    title: "Music Madras — Music. People. Heritage. Chennai.",
    body: null,
    seoTitle: null,
    seoDescription: null,
  },
  "museum-site-seo": {
    title: "Site title and description",
    body: null,
    seoTitle: "Music Madras — Preserving Chennai’s Musical Heritage",
    seoDescription:
      "Music Madras is a growing digital archive documenting Chennai’s Western Classical Music heritage — its composers, performers, choirs, venues, performances and recordings.",
  },
};

export function findBuiltInCopy(slug: string): EditorialFields | null {
  return BUILT_IN_COPY[slug] ?? null;
}
