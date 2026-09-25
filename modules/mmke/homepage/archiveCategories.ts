// Phase 6G-3 — the Museum homepage's "Explore the Archive" taxonomy. Pure
// data, no database access: this is the conceptual MMKE knowledge model
// (composer -> work -> programme -> performance -> recording -> video,
// with related artists/choirs/conductors/venues/collections), not a list
// of implemented routes.
//
// Phase 6G-11: every category below now has a real, working destination —
// the nine archive-searchable entity types link to their /archive?type=
// filter (using the exact canonical ArchiveEntityType values from
// modules/mmke/archiveSearch/archiveSearchContract.ts, never invented
// aliases), and Collections links to its own dedicated /collections index
// (deliberately outside /archive search — see Phase 6G-10). `href` is no
// longer nullable: every route this data references now exists.

export interface ArchiveCategory {
  key: string;
  label: string;
  description: string;
  href: string;
}

export const ARCHIVE_CATEGORIES: ArchiveCategory[] = [
  {
    key: "composers",
    label: "Composers",
    description: "The composers whose works have shaped Chennai's Western Classical tradition.",
    href: "/archive?type=composer",
  },
  {
    key: "works",
    label: "Musical Works",
    description: "Individual compositions performed and recorded across the archive.",
    href: "/archive?type=work",
  },
  {
    key: "performers",
    label: "Performers",
    description: "Soloists and artists documented within Music Madras.",
    href: "/archive?type=artist",
  },
  {
    key: "choirs",
    label: "Choirs",
    description: "Choral groups from Chennai's churches and concert halls.",
    href: "/archive?type=choir",
  },
  {
    key: "conductors",
    label: "Conductors",
    description: "Conductors who have led Chennai's choirs and ensembles.",
    href: "/archive?type=conductor",
  },
  {
    key: "performances",
    label: "Performances & Events",
    description: "The concerts, services and events where this music was performed.",
    href: "/archive?type=performance",
  },
  {
    key: "recordings",
    label: "Recordings",
    description: "Published recordings drawn from real Music Madras performances.",
    href: "/archive?type=recording",
  },
  {
    key: "venues",
    label: "Venues",
    description: "Churches, halls and spaces that have hosted these performances.",
    href: "/archive?type=venue",
  },
  {
    key: "collections",
    label: "Collections",
    description: "Curated groupings of recordings and works within the archive.",
    href: "/collections",
  },
];

/**
 * The homepage's "Continue Exploring" pathways — Phase 6G-11. A small,
 * separately-testable data array (same rationale as ARCHIVE_CATEGORIES
 * above) rather than hardcoded JSX, so its destinations can never silently
 * drift to an unshipped route.
 */
export interface ContinueExploringLink {
  label: string;
  href: string;
}

export const CONTINUE_EXPLORING_LINKS: ContinueExploringLink[] = [
  { label: "People", href: "/archive?type=artist" },
  { label: "Music", href: "/archive?type=work" },
  { label: "Performances", href: "/archive?type=performance" },
  { label: "Places", href: "/archive?type=venue" },
  { label: "Recordings", href: "/archive?type=recording" },
];
