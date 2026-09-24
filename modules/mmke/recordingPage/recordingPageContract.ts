// Phase 6G-5B — the public Recording page's data contract, mirroring
// modules/mmke/entityPage/entityPageContract.ts's role for Composer/Venue:
// pure types only, Prisma-free (ADR §3 boundary rule). A separate contract
// from EntityPageData rather than a forced fit into it — a Recording page
// is built around ONE published revision's canonical content (works,
// programme, performance, media), not a list of "related" items the way
// a Composer/Venue page is. Every field here already exists on a real
// canonical model; nothing is fabricated, and every list supports being
// empty.

export interface RecordingPageComposer {
  id: string;
  slug: string;
  name: string;
}

export interface RecordingPageWork {
  id: string;
  slug: string;
  title: string;
  composer: RecordingPageComposer;
}

export interface RecordingPageProgrammeItem {
  id: string;
  work: { id: string; slug: string; title: string };
  movement: string | null;
  isEncore: boolean;
}

export interface RecordingPageProgramme {
  id: string;
  slug: string;
  title: string;
  items: RecordingPageProgrammeItem[];
}

export interface RecordingPageOrganisation {
  id: string;
  name: string;
}

export interface RecordingPageVenue {
  id: string;
  name: string;
  organisation: RecordingPageOrganisation | null;
}

export interface RecordingPagePerformer {
  id: string;
  name: string;
  role: string | null;
}

export interface RecordingPagePerformance {
  id: string;
  performanceDate: Date | null;
  venue: RecordingPageVenue | null;
  artists: RecordingPagePerformer[];
  choirs: { id: string; name: string }[];
  conductors: { id: string; name: string }[];
}

/** A publicly discoverable MusicMadras video — always links to the existing /videos/[slug] route. */
export interface RecordingPageVideo {
  slug: string;
  title: string | null;
  thumbnailUrl: string | null;
}

/** A publicly published MusicMadras Collection — no public /collections/[slug] route exists yet, so this is identity only, never a link. */
export interface RecordingPageCollection {
  id: string;
  slug: string;
  title: string;
}

export interface RecordingPageData {
  id: string;
  slug: string;
  /** From the published RecordingRevision — the one canonical content representation (ADR §5.1). */
  title: string | null;
  description: string | null;
  seoMetaTitle: string | null;
  seoMetaDescription: string | null;
  seoCanonicalPath: string | null;
  /** Only populated when the published revision's own educational fields hold real, editor-authored content — never generated. */
  educationalDifficultyLevel: string | null;
  educationalListeningGuide: string | null;
  educationalAnalysis: string | null;

  /** Works directly attached to this Recording (RecordingRevisionWork) — "what this recording features," distinct from the Programme's own running order below. */
  works: RecordingPageWork[];
  /** Deduped by id across `works` — every Composer whose work this Recording features. */
  composers: RecordingPageComposer[];
  /** The full concert programme this recording's Performance belongs to, if any — may include works beyond what this specific recording captured. */
  programme: RecordingPageProgramme | null;
  performance: RecordingPagePerformance | null;

  /** MusicMadras media — publicly discoverable only (never raw sync data, never inferred from title/keyword matching). */
  videos: RecordingPageVideo[];
  /** Publicly published, non-archived Collections only. */
  collections: RecordingPageCollection[];
}
