// Phase 6G-8 — the public /programmes/[slug] page's data contract,
// mirroring modules/mmke/workPage/workPageContract.ts's approach: a
// Programme has its own strong identity (an ordered list of works/
// movements/encores) that doesn't fit EntityPageData's generic "related
// items" shape, so it gets its own contract rather than a third instance
// of EntityType. The relationship graph itself (Performance/Recording/
// Video/Collection) is still resolved by the shared resolveRelatedContent
// core — this contract just shapes the result differently. Pure types
// only, Prisma-free (ADR §3 boundary rule).

export interface ProgrammePageComposer {
  id: string;
  slug: string;
  name: string;
}

export interface ProgrammePageWork {
  id: string;
  slug: string;
  title: string;
  composer: ProgrammePageComposer;
}

export interface ProgrammePageItem {
  id: string;
  order: number;
  movement: string | null;
  isEncore: boolean;
  work: ProgrammePageWork;
}

export interface ProgrammePagePerformance {
  id: string;
  /** Phase 6G-8: links to the existing /performances/[slug] route. */
  slug: string;
  performanceDate: Date | null;
  venue: { name: string; slug: string } | null;
  artists: string[];
  choirs: string[];
  conductors: string[];
}

/** A published Recording of this Programme — always links to the existing /recordings/[slug] route. */
export interface ProgrammePageRecording {
  id: string;
  slug: string;
  title: string | null;
}

/** A publicly discoverable MusicMadras video — always links to the existing /videos/[slug] route. */
export interface ProgrammePageVideo {
  slug: string;
  title: string | null;
  thumbnailUrl: string | null;
}

/** A publicly published MusicMadras Collection — no public /collections/[slug] route exists yet, so identity only, never a link. */
export interface ProgrammePageCollection {
  id: string;
  slug: string;
  title: string;
}

export interface ProgrammePageData {
  id: string;
  slug: string;
  title: string;
  notes: string | null;

  items: ProgrammePageItem[];
  performances: ProgrammePagePerformance[];
  recordings: ProgrammePageRecording[];
  videos: ProgrammePageVideo[];
  collections: ProgrammePageCollection[];
}
