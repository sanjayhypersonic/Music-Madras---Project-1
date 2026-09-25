// Phase 6G-10 — the public /collections/[slug] page's data contract,
// mirroring modules/mmke/programmePage/programmePageContract.ts's
// approach: a Collection has its own strong identity (an ordered,
// editorially curated membership of Recordings and Works) that doesn't
// fit EntityPageData's generic "related items" shape, so it gets its own
// contract. Unlike Programme/Performance (which are resolved via the
// shared resolveRelatedContent core, scoped by performanceIds/workIds),
// a Collection is never reached through a Performance — it links
// directly to Recording and MusicalWork via CollectionRecording/
// CollectionWork — so this contract's assembler has its own dedicated
// Collection-rooted traversal instead. Pure types only, Prisma-free
// (ADR §3 boundary rule).

export interface CollectionPageComposer {
  id: string;
  slug: string;
  name: string;
}

export interface CollectionPageWork {
  id: string;
  slug: string;
  title: string;
  composer: CollectionPageComposer;
}

/** A Recording's own performance context, surfaced only when it genuinely exists — never fabricated, never a separate top-level section. */
export interface CollectionPageRecordingContext {
  programme: { id: string; slug: string; title: string } | null;
  performance: { id: string; slug: string; performanceDate: Date | null } | null;
  venue: { id: string; slug: string; name: string } | null;
  artists: { id: string; slug: string; name: string }[];
  choirs: { id: string; slug: string; name: string }[];
  conductors: { id: string; slug: string; name: string }[];
}

/** A published Recording belonging to this Collection — always links to the existing /recordings/[slug] route. */
export interface CollectionPageRecording {
  id: string;
  slug: string;
  title: string | null;
  order: number;
  context: CollectionPageRecordingContext;
}

export interface CollectionPageWorkItem {
  order: number;
  work: CollectionPageWork;
}

/** A publicly discoverable MusicMadras video — always links to the existing /videos/[slug] route. */
export interface CollectionPageVideo {
  slug: string;
  title: string | null;
  thumbnailUrl: string | null;
}

export interface CollectionPageData {
  id: string;
  slug: string;
  title: string;
  description: string | null;

  recordings: CollectionPageRecording[];
  works: CollectionPageWorkItem[];
  /** Deduped by id across `works` — every Composer whose work this Collection features. */
  composers: CollectionPageComposer[];

  /** MusicMadras media — publicly discoverable only (never raw sync data, never inferred from title/keyword matching). */
  videos: CollectionPageVideo[];
}

/** One page of the public /collections index — published, non-archived Collections only. */
export interface CollectionSummary {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  recordingCount: number;
  workCount: number;
}

export interface CollectionIndexPage {
  items: CollectionSummary[];
  total: number;
  page: number;
  pageSize: number;
}
