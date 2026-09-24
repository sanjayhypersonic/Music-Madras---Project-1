// Phase 6G-8 — the public /performances/[slug] page's data contract,
// mirroring modules/mmke/programmePage/programmePageContract.ts's
// approach: a Performance has its own strong identity (one canonical
// Programme, one canonical Venue, a date, and its own participants) that
// doesn't fit EntityPageData's generic "related items" shape, so it gets
// its own contract. Programme and Venue are both required, non-nullable
// scalar FKs on the real Performance model — never optional here. Pure
// types only, Prisma-free (ADR §3 boundary rule).

export interface PerformancePageComposer {
  id: string;
  slug: string;
  name: string;
}

export interface PerformancePageWork {
  id: string;
  slug: string;
  title: string;
  composer: PerformancePageComposer;
}

export interface PerformancePageProgrammeItem {
  id: string;
  order: number;
  movement: string | null;
  isEncore: boolean;
  work: PerformancePageWork;
}

export interface PerformancePageProgramme {
  id: string;
  slug: string;
  title: string;
  items: PerformancePageProgrammeItem[];
}

export interface PerformancePageOrganisation {
  id: string;
  name: string;
}

export interface PerformancePageVenue {
  id: string;
  slug: string;
  name: string;
  organisation: PerformancePageOrganisation | null;
}

export interface PerformancePagePerformer {
  id: string;
  name: string;
  role: string | null;
}

/** A published Recording of this Performance — always links to the existing /recordings/[slug] route. */
export interface PerformancePageRecording {
  id: string;
  slug: string;
  title: string | null;
}

/** A publicly discoverable MusicMadras video — always links to the existing /videos/[slug] route. */
export interface PerformancePageVideo {
  slug: string;
  title: string | null;
  thumbnailUrl: string | null;
}

/** A publicly published MusicMadras Collection — no public /collections/[slug] route exists yet, so identity only, never a link. */
export interface PerformancePageCollection {
  id: string;
  slug: string;
  title: string;
}

export interface PerformancePageData {
  id: string;
  slug: string;
  performanceDate: Date | null;
  programme: PerformancePageProgramme;
  venue: PerformancePageVenue;

  /** No public route exists for any of these entity types (brief: do not create Artist/Choir/Conductor routes) — identity only. */
  artists: PerformancePagePerformer[];
  choirs: { id: string; name: string }[];
  conductors: { id: string; name: string }[];

  recordings: PerformancePageRecording[];
  videos: PerformancePageVideo[];
  collections: PerformancePageCollection[];
}
