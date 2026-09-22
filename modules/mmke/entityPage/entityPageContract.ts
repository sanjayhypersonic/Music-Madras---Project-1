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
  /** Participant names only (brief §5E) — not links, since no public route exists yet for any of these entity types. */
  artists: string[];
  choirs: string[];
  conductors: string[];
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
  thumbnailUrl: string | null;
}

export interface EntityPageRelatedCollection {
  id: string;
  slug: string;
  title: string;
}

/**
 * Composer-only identity fields (brief §5B — "lifespan/dates if actual
 * data exists"). Null for every other entity type today; kept as its own
 * optional block rather than three loose top-level fields so the contract
 * stays obviously entity-specific-safe.
 */
export interface EntityPageLifespan {
  bornDate: string | null;
  diedDate: string | null;
  era: string | null;
}

/**
 * Related people/places (brief §5I), deduped by name across every
 * relatedPerformance — plain names, not links, since none of these
 * entity types have a public route yet.
 */
export interface EntityPageRelatedParticipants {
  artists: string[];
  choirs: string[];
  conductors: string[];
  venues: string[];
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
  /** Composer-only today (brief §5B); null for every other entity type. */
  lifespan: EntityPageLifespan | null;

  // Archive relationships.
  relatedWorks: EntityPageRelatedWork[] | null;
  relatedProgrammes: EntityPageRelatedProgramme[];
  relatedPerformances: EntityPageRelatedPerformance[];
  relatedRecordings: EntityPageRelatedRecording[];
  relatedParticipants: EntityPageRelatedParticipants;

  // MusicMadras media — publicly discoverable only (never raw sync data).
  relatedVideos: EntityPageRelatedVideo[];
  relatedCollections: EntityPageRelatedCollection[];
}
