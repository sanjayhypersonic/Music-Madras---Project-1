import type { CompletenessReportItem, RecordingReadiness } from "../completeness/checkRecordingRevisionCompleteness";

// Phase 6H-3 — the RecordingContext contract established conceptually in
// docs/content-intelligence-architecture.md (Phase 6H-2 §20), now given a
// concrete shape from real repository fields. Pure types only, Prisma-free
// (ADR §3 boundary rule), mirroring modules/mmke/recordingPage/recordingPageContract.ts's
// role. This is an INPUT contract for a future Content Intelligence layer —
// it contains no AI-generated content, no suggestions, and nothing that
// isn't already stored today.

/** Which revision the context was assembled from. Neither mode is "more correct" — a future Studio action picks the one it needs (Phase 6H-3, brief Step 13). */
export type RecordingContextMode = "PUBLISHED" | "DRAFT";

export type ContextSourceType =
  | "CANONICAL_MMKE"
  | "YOUTUBE_METADATA"
  | "APPROVED_EDITORIAL"
  | "APPROVED_EXTERNAL_SOURCE";

/**
 * Static classification of which source tier (6H-1 §5, 6H-2 §22) each
 * RecordingContext section draws from. Deliberately never AI_GENERATED —
 * this assembler is an INPUT layer; there is no AI-generated content at
 * this stage (brief Step 5). A future Content Intelligence consumer cites
 * a specific fact using this map plus the entity id already present in
 * that section — no separate per-field provenance wrapper is needed.
 */
export const RECORDING_CONTEXT_SOURCE_MAP = {
  identity: "CANONICAL_MMKE",
  works: "CANONICAL_MMKE",
  performance: "CANONICAL_MMKE",
  participants: "CANONICAL_MMKE",
  venue: "CANONICAL_MMKE",
  editorial: "APPROVED_EDITORIAL",
  media: "YOUTUBE_METADATA",
  collections: "CANONICAL_MMKE",
  learningGuides: "CANONICAL_MMKE",
  provenance: "APPROVED_EXTERNAL_SOURCE",
} as const satisfies Record<string, ContextSourceType>;

export interface RecordingContextComposer {
  id: string;
  slug: string;
  name: string;
  era: string | null;
  bornDate: string | null;
  diedDate: string | null;
  /** APPROVED_EDITORIAL — human-authored, never generated (6H-1 §3D). */
  biography: string | null;
}

export interface RecordingContextWork {
  id: string;
  slug: string;
  title: string;
  alternateTitles: string[];
  catalogueNumber: string | null;
  keySignature: string | null;
  language: string | null;
  /** APPROVED_EDITORIAL. No arranger field exists on MusicalWork today — not fabricated. */
  notes: string | null;
  composer: RecordingContextComposer;
}

export interface RecordingContextOrganisation {
  id: string;
  slug: string;
  name: string;
  /** APPROVED_EDITORIAL. */
  description: string | null;
}

export interface RecordingContextVenue {
  id: string;
  slug: string;
  name: string;
  type: string;
  address: string | null;
  city: string | null;
  country: string | null;
  organisation: RecordingContextOrganisation | null;
  // Deliberately NO description/biography field: Venue has none in the
  // schema today (6H-1 §3D/§4) — this is a model gap, surfaced explicitly
  // in RecordingContext.completeness.gaps, never faked as null-as-unknown.
}

export interface RecordingContextParticipant {
  id: string;
  slug: string;
  name: string;
  /** APPROVED_EDITORIAL, where the underlying model has such a field. */
  description: string | null;
  /** Only meaningful for a performer's role on this Performance; null for choirs/conductors. */
  role: string | null;
}

export interface RecordingContextProgrammeItem {
  workId: string;
  workTitle: string;
  movement: string | null;
  isEncore: boolean;
}

export interface RecordingContextProgramme {
  id: string;
  slug: string;
  title: string;
  /** APPROVED_EDITORIAL. May include works beyond what this specific recording captured (RecordingRevisionWork vs. Programme membership are distinct — 6H-1 §3B). */
  notes: string | null;
  items: RecordingContextProgrammeItem[];
}

export interface RecordingContextPerformance {
  id: string;
  slug: string;
  performanceDate: Date | null;
  /** Non-nullable at the schema level — every Performance has exactly one Venue. */
  venue: RecordingContextVenue;
  programme: RecordingContextProgramme | null;
  performers: RecordingContextParticipant[];
  choirs: RecordingContextParticipant[];
  conductors: RecordingContextParticipant[];
}

export interface RecordingContextYouTubeVideo {
  id: string;
  youtubeVideoId: string;
  title: string | null;
  /**
   * YOUTUBE_METADATA — the channel's own raw, unedited text, preserved
   * verbatim as source data (6H-1 §3A/§3D, 6H-3 brief Step 15). Never
   * rewritten, summarized, or cleaned by this assembler.
   */
  description: string | null;
  publishedAt: Date | null;
  durationSeconds: number | null;
  thumbnailUrl: string | null;
  /**
   * The public /videos/[slug] route's slug, only when this video's page is
   * genuinely public right now — null otherwise. This is a convenience
   * reference only: `description`/`title` above are included regardless of
   * public-page status, since they remain legitimate editorial source
   * material even for a not-yet-public video (6H-1 §3A).
   */
  publicSlug: string | null;
}

export interface RecordingContextCollection {
  id: string;
  slug: string;
  title: string;
}

export interface RecordingContextLearningGuide {
  id: string;
  slug: string;
  title: string;
}

export interface RecordingContextSource {
  id: string;
  title: string | null;
  url: string | null;
  publisher: string | null;
  /** Composer, Work, or Recording — the only supported provenance entity types (6H-1 §3C). */
  attachedTo: { entityType: string; entityId: string };
}

export interface RecordingContextRightsInformation {
  id: string;
  holder: string | null;
  licenseType: string | null;
  attachedTo: { entityType: string; entityId: string };
}

export type RecordingContextGapField = "WORK" | "PERFORMANCE" | "PARTICIPANTS" | "MEDIA" | "PROVENANCE" | "EDITORIAL_CONTENT";

export interface RecordingContextGap {
  field: RecordingContextGapField;
  /**
   * MISSING = the relationship/content is genuinely absent though the
   * schema supports it. NOT_APPLICABLE = the schema has no field/relation
   * to hold it at all (e.g. Venue has no prose field) — never conflated
   * with "not stored yet" (brief Step 8).
   */
  state: "MISSING" | "NOT_APPLICABLE";
  detail: string;
}

export interface RecordingContextCompleteness {
  /** Reuses the existing checkRecordingRevisionCompleteness report as-is (brief Step 2/Step 7) — no second completeness system. */
  report: CompletenessReportItem[];
  readiness: RecordingReadiness;
  /** Additive: provenance is not one of the existing report's categories. */
  hasProvenance: boolean;
  gaps: RecordingContextGap[];
}

export interface RecordingContextIdentity {
  recordingId: string;
  slug: string;
  /** RecordingAggregateStatus, e.g. "DRAFT" | "IN_REVIEW" | "PUBLISHED" | "ARCHIVED". */
  status: string;
  revisionId: string;
  revisionNumber: number;
  /** RevisionStatus, e.g. "DRAFT" | "PUBLISHED" | "SUPERSEDED". */
  revisionStatus: string;
  mode: RecordingContextMode;
  title: string | null;
}

export interface RecordingContextEditorial {
  /** APPROVED_EDITORIAL — every field here is explicitly human-authored; several are commented "never generated" in the schema itself (6H-1 §3D). */
  description: string | null;
  educationalDifficultyLevel: string | null;
  educationalListeningGuide: string | null;
  educationalAnalysis: string | null;
  seoMetaTitle: string | null;
  seoMetaDescription: string | null;
}

/**
 * The deterministic, read-only snapshot of everything Music Madras
 * canonically knows about one Recording revision. Contains no AI-generated
 * content and no suggestions — see docs/content-intelligence-architecture.md
 * Phase 6H-3 section for the full contract, visibility rules, and what is
 * deliberately excluded (playlist context, hashtags, channel title).
 */
export interface RecordingContext {
  identity: RecordingContextIdentity;
  works: RecordingContextWork[];
  /** Deduped by id across `works`. */
  composers: RecordingContextComposer[];
  performance: RecordingContextPerformance | null;
  editorial: RecordingContextEditorial;
  media: RecordingContextYouTubeVideo[];
  collections: RecordingContextCollection[];
  learningGuides: RecordingContextLearningGuide[];
  provenance: {
    sources: RecordingContextSource[];
    rights: RecordingContextRightsInformation[];
  };
  completeness: RecordingContextCompleteness;
}
