import type {
  EntityPageRelatedCollection,
  EntityPageRelatedParticipants,
  EntityPageRelatedPerformance,
  EntityPageRelatedProgramme,
  EntityPageRelatedRecording,
  EntityPageRelatedVideo,
} from "../entityPage/entityPageContract";

// Phase 6G-14 — Organisation's own bespoke page contract, mirroring why
// Collection/Recording/Work/Programme/Performance each got their own
// contract rather than being forced into the generic EntityPageData shape
// (ADR precedent: give an entity its own contract when its shape
// genuinely differs). Organisation's shape differs in two ways the
// generic contract has no slot for: a direct list of its own Venues (the
// one real canonical FK Organisation has — Venue.organisationId), and
// Occasions/Sources/RightsInformation aggregated across its derived
// content (never a direct Organisation-level attachment, which does not
// exist).

export interface OrganisationPageVenue {
  id: string;
  slug: string;
  name: string;
}

/** Public Occasion pages: an Occasion that appears here has public content (the aggregation only surfaces active Occasions of eligible content), so /occasions/[slug] exists for it and the page links to it. */
export interface OrganisationPageOccasion {
  id: string;
  slug: string;
  name: string;
}

/** No public Source page exists — rendered as plain text, never a link. */
export interface OrganisationPageSource {
  id: string;
  title: string | null;
  url: string | null;
  publisher: string | null;
}

/** No public RightsInformation page exists — rendered as plain text, never a link. */
export interface OrganisationPageRights {
  id: string;
  holder: string | null;
  licenseType: string | null;
}

export interface OrganisationPageData {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  /** Every non-archived Venue with organisationId = this Organisation — the direct canonical relationship, not derived through performances. */
  venues: OrganisationPageVenue[];
  /** Derived transitively: Organisation -> Venue -> Performance -> Programme (resolveRelatedContent). */
  programmes: EntityPageRelatedProgramme[];
  /** Derived transitively: Organisation -> Venue -> Performance. */
  performances: EntityPageRelatedPerformance[];
  /** Derived transitively: Organisation -> Venue -> Performance -> published Recording. */
  recordings: EntityPageRelatedRecording[];
  /** Derived transitively: Organisation -> Venue -> Performance -> Recording -> Collection. */
  collections: EntityPageRelatedCollection[];
  /**
   * Aggregated across this Organisation's derived Performances/Programmes/
   * Recordings/Collections' own existing EntityOccasion attachments
   * (Phase 6G-12) — never a direct Organisation-level Occasion
   * attachment, which does not exist and is not added here.
   */
  occasions: OrganisationPageOccasion[];
  /** Artists/Choirs/Conductors performing at this Organisation's venues, derived from its performances (same shape Venue's own page already uses). */
  relatedParticipants: EntityPageRelatedParticipants;
  /** MusicMadras Videos, resolved through the same canonical Recording -> MediaResource -> YouTubeVideo -> public YouTubeVideoPage chain every other entity page uses. */
  videos: EntityPageRelatedVideo[];
  /**
   * Aggregated across this Organisation's derived Recordings' own existing
   * EntitySource attachments (Phase 6G-13 — Recording is a supported
   * provenance entity type) — never a direct Organisation-level Source
   * attachment, which does not exist and is not added here.
   */
  sources: OrganisationPageSource[];
  /** Same principle as `sources`, via EntityRights on the same derived Recordings. */
  rights: OrganisationPageRights[];
}
