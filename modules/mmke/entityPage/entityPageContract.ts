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

/** Phase 6G-9: an Artist/Choir/Conductor surfaced as related context — links to /artists|choirs|conductors/[slug], which now exist. */
export interface EntityPageRelatedParticipantRef {
  name: string;
  slug: string;
}

export interface EntityPageRelatedPerformance {
  id: string;
  /** Phase 6G-8: now that /performances/[slug] exists, every relatedPerformance links there. */
  slug: string;
  performanceDate: Date | null;
  venueName: string | null;
  /** Phase 6G-6: null only when there is no venue at all; non-null whenever venueName is, now that /venues/[slug] exists. */
  venueSlug: string | null;
  /** Phase 6G-9: upgraded from plain names to {name, slug} now that /artists|choirs|conductors/[slug] exist — these render as real links. */
  artists: EntityPageRelatedParticipantRef[];
  choirs: EntityPageRelatedParticipantRef[];
  conductors: EntityPageRelatedParticipantRef[];
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

/** Phase 6G-6: a composer surfaced as related context (e.g. on a Venue page) — links to /composers/[slug], which already exists. */
export interface EntityPageRelatedComposer {
  id: string;
  slug: string;
  name: string;
}

/** Phase 6G-6: a venue surfaced within relatedParticipants — links to /venues/[slug], which now exists. */
export interface EntityPageRelatedVenueRef {
  name: string;
  slug: string;
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
 * Related people/places (brief §5I), deduped by slug across every
 * relatedPerformance.
 */
export interface EntityPageRelatedParticipants {
  /** Phase 6G-9: upgraded from plain names to {name, slug} now that /artists|choirs|conductors/[slug] exist. */
  artists: EntityPageRelatedParticipantRef[];
  choirs: EntityPageRelatedParticipantRef[];
  conductors: EntityPageRelatedParticipantRef[];
  /** Phase 6G-6: upgraded from plain names to {name, slug} now that /venues/[slug] exists. */
  venues: EntityPageRelatedVenueRef[];
}

/**
 * Phase 6G-6: Venue-specific identity fields, mirroring EntityPageLifespan's
 * role for Composer — null for every entity type except Venue today.
 */
export interface EntityPageVenueDetails {
  type: string;
  address: string | null;
  city: string | null;
  country: string | null;
  /** Phase 6G-14: `slug` links to the existing /organisations/[slug] route. */
  organisation: { id: string; slug: string; name: string } | null;
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
  /** Venue-only (Phase 6G-6); null for every other entity type. */
  venueDetails: EntityPageVenueDetails | null;
  /** Phase 6G-9: a single stored factual detail specific to the entity type, where one exists — Artist's instrument, Choir's director name. Null for every other entity type (including Conductor, which has no equivalent field). */
  secondaryDetail: string | null;

  // Archive relationships.
  relatedWorks: EntityPageRelatedWork[] | null;
  /** Phase 6G-6: Venue-only today (works performed at this venue, derived from its performances' programmes); null elsewhere. */
  relatedComposers: EntityPageRelatedComposer[] | null;
  relatedProgrammes: EntityPageRelatedProgramme[];
  relatedPerformances: EntityPageRelatedPerformance[];
  relatedRecordings: EntityPageRelatedRecording[];
  relatedParticipants: EntityPageRelatedParticipants;

  // MusicMadras media — publicly discoverable only (never raw sync data).
  relatedVideos: EntityPageRelatedVideo[];
  relatedCollections: EntityPageRelatedCollection[];
}
