import type { Prisma } from "@prisma/client";

// Phase 6J-1 — PUBLIC ELIGIBILITY for canonical catalogue entities.
//
// The V1 audit found that Composer, MusicalWork, Programme, Performance,
// Venue, Organisation, Artist, Choir and Conductor have no publication state
// of their own — only `archivedAt` — so any row that merely existed was
// public, indexed and in the sitemap: leftover test fixtures, and the
// Programme/Performance/Venue rows the Studio recording wizard creates for a
// DRAFT Recording.
//
// Rather than add a lifecycle column to nine models (and a second thing for
// an editor to forget), public discovery is ELIGIBILITY-BASED: a canonical
// entity is publicly discoverable only while it is reachable from published
// archive content. These fragments are the single definition of "reachable",
// reused by every public surface — direct entity URLs, archive search, the
// sitemap, and related-content links — so they cannot drift apart.
//
//   Performance   non-archived, with a non-archived Programme and Venue, and
//                 used by a revision that is some Recording's CURRENT
//                 PUBLISHED revision
//   Programme     non-archived, with an eligible Performance
//   Venue         non-archived, with an eligible Performance
//   Artist/Choir/Conductor
//                 non-archived, on an eligible Performance
//   Organisation  non-archived, operating an eligible Venue
//   MusicalWork   non-archived, by a non-archived Composer, and either on a
//                 published Recording revision, in an eligible Programme, or
//                 in a PUBLISHED Collection / LearningGuide
//   Composer      non-archived, with an eligible Work
//
// Everything stays reusable in Studio (Studio never reads these): an editor can
// pick an existing Venue or Programme for a new draft Recording at any time.
// Entities become discoverable when — and only when — a Recording that uses
// them is published, and stop being discoverable if that Recording stops being
// published (unpublish/archive). A published Recording keeps serving its
// published revision while a new draft is edited, so its entities do not flap.
//
// No schema change: eligibility is derived from relations that already exist.

/** A revision that is currently some PUBLISHED Recording's live revision. */
export const PUBLISHED_REVISION_WHERE: Prisma.RecordingRevisionWhereInput = {
  currentPublishedOf: { is: { status: "PUBLISHED" } },
};

export const eligiblePerformanceWhere: Prisma.PerformanceWhereInput = {
  archivedAt: null,
  programme: { archivedAt: null },
  venue: { archivedAt: null },
  revisions: { some: PUBLISHED_REVISION_WHERE },
};

export const eligibleProgrammeWhere: Prisma.ProgrammeWhereInput = {
  archivedAt: null,
  performances: { some: eligiblePerformanceWhere },
};

export const eligibleVenueWhere: Prisma.VenueWhereInput = {
  archivedAt: null,
  performances: { some: eligiblePerformanceWhere },
};

export const eligibleArtistWhere: Prisma.ArtistWhereInput = {
  archivedAt: null,
  performances: { some: { performance: eligiblePerformanceWhere } },
};

export const eligibleChoirWhere: Prisma.ChoirWhereInput = {
  archivedAt: null,
  performances: { some: { performance: eligiblePerformanceWhere } },
};

export const eligibleConductorWhere: Prisma.ConductorWhereInput = {
  archivedAt: null,
  performances: { some: { performance: eligiblePerformanceWhere } },
};

export const eligibleOrganisationWhere: Prisma.OrganisationWhereInput = {
  archivedAt: null,
  venues: { some: eligibleVenueWhere },
};

export const eligibleWorkWhere: Prisma.MusicalWorkWhereInput = {
  archivedAt: null,
  composer: { archivedAt: null },
  OR: [
    { recordingRevisionLinks: { some: { revision: PUBLISHED_REVISION_WHERE } } },
    { programmeItems: { some: { programme: eligibleProgrammeWhere } } },
    { collectionLinks: { some: { collection: { status: "PUBLISHED", archivedAt: null } } } },
    { learningGuideLinks: { some: { learningGuide: { status: "PUBLISHED", archivedAt: null } } } },
  ],
};

export const eligibleComposerWhere: Prisma.ComposerWhereInput = {
  archivedAt: null,
  works: { some: eligibleWorkWhere },
};

// ---------------------------------------------------------------------------
// In-memory counterparts, for relations that are already loaded. An entity that
// is archived (or whose parent is) is OMITTED from public lists — the same
// convention the Collection and Learning Guide pages already follow for
// archived Works — so a public page never renders a link that would 404.
// ---------------------------------------------------------------------------

export interface ArchivableRef {
  archivedAt: Date | null;
}

export function isActiveRef(entity: ArchivableRef): boolean {
  return entity.archivedAt === null;
}

/** A Work is publicly linkable only while neither it nor its Composer is archived. */
export function isActiveWork(work: ArchivableRef & { composer: ArchivableRef }): boolean {
  return work.archivedAt === null && work.composer.archivedAt === null;
}

/** A Performance is publicly linkable only while it, its Programme and its Venue are all active. */
export function isActivePerformance(performance: ArchivableRef & { programme: ArchivableRef; venue: ArchivableRef }): boolean {
  return performance.archivedAt === null && performance.programme.archivedAt === null && performance.venue.archivedAt === null;
}

/** Keeps only the active members of a list of entities (e.g. participants). */
export function onlyActive<T extends ArchivableRef>(entities: T[]): T[] {
  return entities.filter(isActiveRef);
}
