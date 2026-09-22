// Phase 6G-3 — the Museum homepage's "Explore the Archive" taxonomy. Pure
// data, no database access: this is the conceptual MMKE knowledge model
// (composer -> work -> programme -> performance -> recording -> video,
// with related artists/choirs/conductors/venues/collections), not a list
// of implemented routes. `href` stays null until the corresponding public
// entity route actually ships — never point this at a route that does not
// exist yet.

export interface ArchiveCategory {
  key: string;
  label: string;
  description: string;
  href: string | null;
}

export const ARCHIVE_CATEGORIES: ArchiveCategory[] = [
  {
    key: "composers",
    label: "Composers",
    description: "The composers whose works have shaped Chennai's Western Classical tradition.",
    href: null,
  },
  {
    key: "works",
    label: "Musical Works",
    description: "Individual compositions performed and recorded across the archive.",
    href: null,
  },
  {
    key: "performers",
    label: "Performers",
    description: "Soloists and artists documented within Music Madras.",
    href: null,
  },
  {
    key: "choirs",
    label: "Choirs",
    description: "Choral groups from Chennai's churches and concert halls.",
    href: null,
  },
  {
    key: "conductors",
    label: "Conductors",
    description: "Conductors who have led Chennai's choirs and ensembles.",
    href: null,
  },
  {
    key: "performances",
    label: "Performances & Events",
    description: "The concerts, services and events where this music was performed.",
    href: null,
  },
  {
    key: "recordings",
    label: "Recordings",
    description: "Published recordings drawn from real Music Madras performances.",
    href: null,
  },
  {
    key: "venues",
    label: "Venues",
    description: "Churches, halls and spaces that have hosted these performances.",
    href: null,
  },
  {
    key: "collections",
    label: "Collections",
    description: "Curated groupings of recordings and works within the archive.",
    href: null,
  },
];
