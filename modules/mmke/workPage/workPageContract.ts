// Phase 6G-6 — the public /works/[slug] page's data contract, mirroring
// modules/mmke/recordingPage/recordingPageContract.ts's approach: a Work
// has its own strong identity (one canonical Composer, several own
// scalar catalogue fields) that doesn't fit EntityPageData's generic
// "related items" shape cleanly, so it gets its own contract rather than
// a third instance of EntityType. The relationship graph itself (Programme/
// Performance/Recording/Video/Collection) is still resolved by the shared
// resolveRelatedContent core — this contract just shapes the result
// differently. Pure types only, Prisma-free (ADR §3 boundary rule).

export interface WorkPageComposer {
  id: string;
  slug: string;
  name: string;
}

export interface WorkPageProgramme {
  id: string;
  slug: string;
  title: string;
}

export interface WorkPagePerformance {
  id: string;
  performanceDate: Date | null;
  venue: { name: string; slug: string } | null;
  artists: string[];
  choirs: string[];
  conductors: string[];
}

/** A published Recording of this Work — always links to the existing /recordings/[slug] route. */
export interface WorkPageRecording {
  id: string;
  slug: string;
  title: string | null;
}

/** A publicly discoverable MusicMadras video — always links to the existing /videos/[slug] route. */
export interface WorkPageVideo {
  slug: string;
  title: string | null;
  thumbnailUrl: string | null;
}

/** A publicly published MusicMadras Collection — no public /collections/[slug] route exists yet, so identity only, never a link. */
export interface WorkPageCollection {
  id: string;
  slug: string;
  title: string;
}

export interface WorkPageData {
  id: string;
  slug: string;
  title: string;
  alternateTitles: string[];
  language: string | null;
  notes: string | null;
  catalogueNumber: string | null;
  keySignature: string | null;
  composer: WorkPageComposer;

  programmes: WorkPageProgramme[];
  performances: WorkPagePerformance[];
  recordings: WorkPageRecording[];
  videos: WorkPageVideo[];
  collections: WorkPageCollection[];
}
