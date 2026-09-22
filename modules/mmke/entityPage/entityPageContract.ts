// Phase 6G-4A — the reusable public entity-page data contract (brief §11).
// Pure types only, Prisma-free (ADR §3 boundary rule): modules/db's
// entityRelationshipsRepository.ts assembles the real Prisma data and
// hands it to assembleEntityPageData.ts (also Prisma-free) to shape into
// this contract. No public page reads Prisma models directly.
//
// Deliberately conservative: only fields that already exist on a real
// canonical model appear here. Nothing here is fabricated, and every
// section supports being empty (brief §11 — "the contract should support
// empty sections gracefully").

export type EntityType = "composer" | "choir" | "conductor" | "artist" | "venue";

export interface EntityPageRelatedWork {
  id: string;
  slug: string;
  title: string;
}

export interface EntityPageRelatedProgramme {
  id: string;
  slug: string;
  title: string;
}

export interface EntityPageRelatedPerformance {
  id: string;
  performanceDate: Date | null;
  venueName: string | null;
}

export interface EntityPageRelatedRecording {
  id: string;
  slug: string;
  title: string | null;
}

/** A publicly discoverable recording — always links to the existing /videos/[slug] route. */
export interface EntityPageRelatedVideo {
  slug: string;
  title: string | null;
}

export interface EntityPageRelatedCollection {
  id: string;
  slug: string;
  title: string;
}

/**
 * ARCHIVE INFORMATION vs MUSICMADRAS MEDIA (brief §12) are kept as
 * distinct top-level groups in this contract on purpose, not flattened
 * into one list — a future page renders them as visually separate
 * sections rather than implying a video IS the entity's biography.
 */
export interface EntityPageData {
  entityType: EntityType;
  id: string;
  slug: string;
  name: string;
  /** Archive information — biography/description, where the source model has one. */
  description: string | null;

  // Archive relationships.
  relatedWorks: EntityPageRelatedWork[] | null;
  relatedProgrammes: EntityPageRelatedProgramme[];
  relatedPerformances: EntityPageRelatedPerformance[];
  relatedRecordings: EntityPageRelatedRecording[];

  // MusicMadras media — publicly discoverable only (never raw sync data).
  relatedVideos: EntityPageRelatedVideo[];
  relatedCollections: EntityPageRelatedCollection[];
}
