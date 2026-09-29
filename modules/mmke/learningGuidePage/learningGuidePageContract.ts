// Phase 6G-17 — the public /learning/[slug] page's data contract, mirroring
// modules/mmke/collectionPage/collectionPageContract.ts's approach: a
// LearningGuide has its own strong identity and canonical relationships
// (LearningGuideWork/LearningGuideRecording) rather than being reached via
// a Performance, so it gets its own contract and its own Recording context
// shape (surfaced per-Recording, never a fabricated top-level relationship)
// — the exact same pattern Collection already established. Pure types
// only, Prisma-free (ADR §3 boundary rule).

export interface LearningGuidePageComposer {
  id: string;
  slug: string;
  name: string;
}

export interface LearningGuidePageWork {
  id: string;
  slug: string;
  title: string;
  composer: LearningGuidePageComposer;
}

/** A Recording's own performance context, surfaced only when it genuinely exists — never fabricated, mirrors CollectionPageRecordingContext exactly. */
export interface LearningGuidePageRecordingContext {
  programme: { id: string; slug: string; title: string } | null;
  performance: { id: string; slug: string; performanceDate: Date | null } | null;
  venue: { id: string; slug: string; name: string } | null;
  artists: { id: string; slug: string; name: string }[];
  choirs: { id: string; slug: string; name: string }[];
  conductors: { id: string; slug: string; name: string }[];
}

export interface LearningGuidePageRecording {
  id: string;
  slug: string;
  title: string | null;
  context: LearningGuidePageRecordingContext;
}

export interface LearningGuidePageData {
  id: string;
  slug: string;
  title: string;
  difficultyLevel: string | null;
  /** The guide's own stored editorial content — rendered as-is, never rewritten or summarized. */
  contentMarkdown: string | null;
  estimatedReadingTimeMinutes: number | null;
  updatedAt: Date;

  /** Canonical Musical Works this guide discusses (LearningGuideWork), non-archived only. */
  works: LearningGuidePageWork[];
  /** Deduped by id across `works` — every Composer whose work this guide discusses. */
  composers: LearningGuidePageComposer[];
  /** Canonical Recordings this guide discusses (LearningGuideRecording), publicly published only. */
  recordings: LearningGuidePageRecording[];
}

/** One row of the public /learning index — published, non-archived Learning Guides only. */
export interface LearningGuideSummary {
  id: string;
  slug: string;
  title: string;
  difficultyLevel: string | null;
  estimatedReadingTimeMinutes: number | null;
  /** A mechanical excerpt of the guide's own content — never AI-generated or rewritten. */
  excerpt: string | null;
}

export interface LearningGuideIndexPage {
  items: LearningGuideSummary[];
  total: number;
  page: number;
  pageSize: number;
}
