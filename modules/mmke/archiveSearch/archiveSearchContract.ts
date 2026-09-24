// Phase 6G-7 — the public /archive search's data contract. Pure types
// only, Prisma-free (ADR §3 boundary rule). Deliberately conservative:
// only fields that already exist on a real canonical model appear here,
// and every entity type carries only what a search RESULT card actually
// needs to render (not the full entity-page payload — that's what
// clicking through to /composers/[slug] etc. is for).
//
// Extensible by design: adding a new searchable entity type means adding
// one more variant here, one more search function in
// modules/db/repositories/archiveSearchRepository.ts, and one more branch
// in the archive page's rendering — never a rewrite of the existing ones.

export type ArchiveEntityType = "composer" | "work" | "recording" | "venue";

export interface ArchiveSearchResultComposer {
  entityType: "composer";
  id: string;
  slug: string;
  name: string;
  bornDate: string | null;
  diedDate: string | null;
  era: string | null;
  biography: string | null;
}

export interface ArchiveSearchResultWork {
  entityType: "work";
  id: string;
  slug: string;
  title: string;
  composerName: string;
  composerSlug: string;
  catalogueNumber: string | null;
}

export interface ArchiveSearchResultRecording {
  entityType: "recording";
  id: string;
  slug: string;
  title: string | null;
  programmeTitle: string | null;
  venueName: string | null;
  thumbnailUrl: string | null;
}

export interface ArchiveSearchResultVenue {
  entityType: "venue";
  id: string;
  slug: string;
  name: string;
  venueType: string;
  city: string | null;
  country: string | null;
}

export type ArchiveSearchResult =
  | ArchiveSearchResultComposer
  | ArchiveSearchResultWork
  | ArchiveSearchResultRecording
  | ArchiveSearchResultVenue;

/** One entity type's page of results, for the single-type paginated view. */
export interface ArchiveSearchPage<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** The capped, multi-type view used for the "all types" / discovery mode — never paginated, deliberately small per type. */
export interface ArchiveSearchAllResult {
  composers: ArchiveSearchPage<ArchiveSearchResultComposer>;
  works: ArchiveSearchPage<ArchiveSearchResultWork>;
  recordings: ArchiveSearchPage<ArchiveSearchResultRecording>;
  venues: ArchiveSearchPage<ArchiveSearchResultVenue>;
}
