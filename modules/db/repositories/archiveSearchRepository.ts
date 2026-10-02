import { prisma } from "../client";
import { isRecordingPublished } from "../../mmke/catalogue/isRecordingPublished";
import { findPublicVideoPagesByYouTubeVideoIds } from "./youtubeVideoPageRepository";
import {
  eligibleArtistWhere,
  eligibleChoirWhere,
  eligibleComposerWhere,
  eligibleConductorWhere,
  eligibleOrganisationWhere,
  eligiblePerformanceWhere,
  eligibleProgrammeWhere,
  eligibleVenueWhere,
  eligibleWorkWhere,
} from "./publicEligibility";
import type {
  ArchiveSearchAllResult,
  ArchiveSearchPage,
  ArchiveSearchResultArtist,
  ArchiveSearchResultChoir,
  ArchiveSearchResultComposer,
  ArchiveSearchResultConductor,
  ArchiveSearchResultOrganisation,
  ArchiveSearchResultPerformance,
  ArchiveSearchResultProgramme,
  ArchiveSearchResultRecording,
  ArchiveSearchResultVenue,
  ArchiveSearchResultWork,
} from "../../mmke/archiveSearch/archiveSearchContract";

// Phase 6G-7 — the public /archive search's sole data source. Every
// function here is database-side (Postgres ILIKE via Prisma's
// `mode: "insensitive"`), bounded (skip/take), and reuses the exact same
// public-visibility rules every other public page already uses:
// Phase 6J-1 eligibility (publicEligibility.ts — an entity is searchable only while
// reachable from a published Recording) for every catalogue entity, isRecordingPublished
// (Phase 6G-5A, never a second predicate) for Recording. No query ever
// touches YouTube directly or fetches an entire table into memory.
//
// Deliberately one function per entity type rather than a single
// polymorphic query — each entity's canonical searchable fields and
// visibility rule are different, and this keeps every one of them a
// plain, readable, independently-testable Prisma call. searchArchiveAll
// composes them; nothing duplicates their logic.

export const ARCHIVE_PAGE_SIZE = 20;
/** The capped per-type count shown in the "all types" / no-filter discovery view — deliberately small, never paginated. */
export const ARCHIVE_ALL_TYPES_LIMIT = 6;

function clampPage(page: number): number {
  return Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
}

export async function searchComposers(
  query: string | undefined,
  page = 1,
  pageSize = ARCHIVE_PAGE_SIZE
): Promise<ArchiveSearchPage<ArchiveSearchResultComposer>> {
  const currentPage = clampPage(page);
  const where = {
    ...eligibleComposerWhere,
    ...(query ? { name: { contains: query, mode: "insensitive" as const } } : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.composer.findMany({
      where,
      orderBy: query ? { name: "asc" } : { createdAt: "desc" },
      skip: (currentPage - 1) * pageSize,
      take: pageSize,
    }),
    prisma.composer.count({ where }),
  ]);

  const items: ArchiveSearchResultComposer[] = rows.map((composer) => ({
    entityType: "composer",
    id: composer.id,
    slug: composer.slug,
    name: composer.name,
    bornDate: composer.bornDate,
    diedDate: composer.diedDate,
    era: composer.era,
    biography: composer.biography,
  }));

  return { items, total, page: currentPage, pageSize };
}

export async function searchWorks(
  query: string | undefined,
  page = 1,
  pageSize = ARCHIVE_PAGE_SIZE
): Promise<ArchiveSearchPage<ArchiveSearchResultWork>> {
  const currentPage = clampPage(page);
  const where = {
    AND: [
      eligibleWorkWhere,
      ...(query
        ? [
            {
              OR: [
                { title: { contains: query, mode: "insensitive" as const } },
                { alternateTitles: { has: query } },
              ],
            },
          ]
        : []),
    ],
  };

  const [rows, total] = await Promise.all([
    prisma.musicalWork.findMany({
      where,
      include: { composer: true },
      orderBy: query ? { title: "asc" } : { createdAt: "desc" },
      skip: (currentPage - 1) * pageSize,
      take: pageSize,
    }),
    prisma.musicalWork.count({ where }),
  ]);

  const items: ArchiveSearchResultWork[] = rows.map((work) => ({
    entityType: "work",
    id: work.id,
    slug: work.slug,
    title: work.title,
    composerName: work.composer.name,
    composerSlug: work.composer.slug,
    catalogueNumber: work.catalogueNumber,
  }));

  return { items, total, page: currentPage, pageSize };
}

export async function searchVenues(
  query: string | undefined,
  page = 1,
  pageSize = ARCHIVE_PAGE_SIZE
): Promise<ArchiveSearchPage<ArchiveSearchResultVenue>> {
  const currentPage = clampPage(page);
  const where = {
    ...eligibleVenueWhere,
    ...(query
      ? {
          OR: [
            { name: { contains: query, mode: "insensitive" as const } },
            { city: { contains: query, mode: "insensitive" as const } },
            { country: { contains: query, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.venue.findMany({
      where,
      orderBy: query ? { name: "asc" } : { createdAt: "desc" },
      skip: (currentPage - 1) * pageSize,
      take: pageSize,
    }),
    prisma.venue.count({ where }),
  ]);

  const items: ArchiveSearchResultVenue[] = rows.map((venue) => ({
    entityType: "venue",
    id: venue.id,
    slug: venue.slug,
    name: venue.name,
    venueType: venue.type,
    city: venue.city,
    country: venue.country,
  }));

  return { items, total, page: currentPage, pageSize };
}

/**
 * Recording search: the where-clause's `status: "PUBLISHED"` is a cheap
 * coarse filter; isRecordingPublished (Phase 6G-5A) is re-applied as the
 * authoritative gate afterward, exactly the same defense-in-depth pattern
 * entityRelationshipsRepository.ts's resolveRelatedContent already uses —
 * never a second, independently-invented publication rule.
 */
export async function searchRecordings(
  query: string | undefined,
  page = 1,
  pageSize = ARCHIVE_PAGE_SIZE
): Promise<ArchiveSearchPage<ArchiveSearchResultRecording>> {
  const currentPage = clampPage(page);
  const where = {
    status: "PUBLISHED" as const,
    ...(query
      ? {
          currentPublishedRevision: {
            OR: [
              { title: { contains: query, mode: "insensitive" as const } },
              { description: { contains: query, mode: "insensitive" as const } },
            ],
          },
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.recording.findMany({
      where,
      include: {
        currentPublishedRevision: {
          include: {
            performance: { include: { venue: true, programme: true } },
            mediaResources: true,
          },
        },
      },
      orderBy: { updatedAt: "desc" },
      skip: (currentPage - 1) * pageSize,
      take: pageSize,
    }),
    prisma.recording.count({ where }),
  ]);

  const published = rows.filter((recording) => isRecordingPublished(recording) && recording.currentPublishedRevision);

  const candidateYouTubeVideoIds = Array.from(
    new Set(
      published.flatMap((recording) =>
        (recording.currentPublishedRevision?.mediaResources ?? [])
          .filter((media) => media.provider === "YOUTUBE" && media.youtubeVideoId !== null)
          .map((media) => media.youtubeVideoId as string)
      )
    )
  );
  const publicVideoPages =
    candidateYouTubeVideoIds.length > 0 ? await findPublicVideoPagesByYouTubeVideoIds(candidateYouTubeVideoIds) : [];
  const thumbnailByYouTubeVideoId = new Map(publicVideoPages.map((result) => [result.youtubeVideo.id, result.youtubeVideo.thumbnailUrl]));

  const items: ArchiveSearchResultRecording[] = published.map((recording) => {
    const revision = recording.currentPublishedRevision!;
    const publicMedia = revision.mediaResources.find(
      (media) => media.youtubeVideoId && thumbnailByYouTubeVideoId.has(media.youtubeVideoId)
    );
    return {
      entityType: "recording",
      id: recording.id,
      slug: recording.slug,
      title: revision.title,
      programmeTitle: revision.performance?.programme.title ?? null,
      venueName: revision.performance?.venue.name ?? null,
      thumbnailUrl: publicMedia?.youtubeVideoId ? (thumbnailByYouTubeVideoId.get(publicMedia.youtubeVideoId) ?? null) : null,
    };
  });

  // `total` counts every row matching the coarse where-clause; since
  // status: "PUBLISHED" already implies currentPublishedRevisionId is set
  // (publishCurrentDraft's own invariant — see recordingRepository.ts),
  // isRecordingPublished never actually excludes anything this count
  // already included, so `total` and `items.length` stay consistent with
  // ordinary pagination.
  return { items, total, page: currentPage, pageSize };
}

/**
 * Programme search — Phase 6G-8, now that /programmes/[slug] exists.
 * Follows the exact same where/Promise.all/map shape as searchWorks above:
 * archivedAt-null visibility, DB-side ILIKE across Programme's own
 * canonical fields (title, notes — never a keyword match against
 * unrelated entities or YouTube data). The first few work titles are
 * included as a factual preview only, capped and never a substitute for
 * the full Programme page.
 */
export async function searchProgrammes(
  query: string | undefined,
  page = 1,
  pageSize = ARCHIVE_PAGE_SIZE
): Promise<ArchiveSearchPage<ArchiveSearchResultProgramme>> {
  const currentPage = clampPage(page);
  const where = {
    ...eligibleProgrammeWhere,
    ...(query
      ? {
          OR: [
            { title: { contains: query, mode: "insensitive" as const } },
            { notes: { contains: query, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.programme.findMany({
      where,
      // The preview never names an archived Work (or a Work of an archived Composer).
      include: {
        items: {
          where: { musicalWork: { archivedAt: null, composer: { archivedAt: null } } },
          include: { musicalWork: true },
          orderBy: { order: "asc" },
          take: 3,
        },
      },
      orderBy: query ? { title: "asc" } : { createdAt: "desc" },
      skip: (currentPage - 1) * pageSize,
      take: pageSize,
    }),
    prisma.programme.count({ where }),
  ]);

  const items: ArchiveSearchResultProgramme[] = rows.map((programme) => ({
    entityType: "programme",
    id: programme.id,
    slug: programme.slug,
    title: programme.title,
    notes: programme.notes,
    workTitles: programme.items.map((item) => item.musicalWork.title),
  }));

  return { items, total, page: currentPage, pageSize };
}

/**
 * Performance search — Phase 6G-8, now that /performances/[slug] exists.
 * A Performance has no title/name field of its own (brief: "use actual
 * canonical fields available"), so its only real searchable text is its
 * required Programme's title and required Venue's name, via canonical
 * relation filters — never a keyword match against an unrelated entity.
 */
export async function searchPerformances(
  query: string | undefined,
  page = 1,
  pageSize = ARCHIVE_PAGE_SIZE
): Promise<ArchiveSearchPage<ArchiveSearchResultPerformance>> {
  const currentPage = clampPage(page);
  const where = {
    ...eligiblePerformanceWhere,
    ...(query
      ? {
          OR: [
            { programme: { title: { contains: query, mode: "insensitive" as const } } },
            { venue: { name: { contains: query, mode: "insensitive" as const } } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.performance.findMany({
      where,
      include: { programme: true, venue: true },
      orderBy: query ? { performanceDate: "desc" } : { createdAt: "desc" },
      skip: (currentPage - 1) * pageSize,
      take: pageSize,
    }),
    prisma.performance.count({ where }),
  ]);

  const items: ArchiveSearchResultPerformance[] = rows.map((performance) => ({
    entityType: "performance",
    id: performance.id,
    slug: performance.slug,
    programmeTitle: performance.programme.title,
    venueName: performance.venue.name,
    performanceDate: performance.performanceDate,
  }));

  return { items, total, page: currentPage, pageSize };
}

/**
 * Artist/Choir/Conductor search — Phase 6G-9, now that
 * /artists|choirs|conductors/[slug] exist. Unlike Performance, these
 * three entities have their own real canonical `name` field (plus a
 * secondary text field each), so they follow the same direct-field-OR
 * pattern as searchComposers/searchVenues, not searchPerformances'
 * relation-only workaround.
 */
export async function searchArtists(
  query: string | undefined,
  page = 1,
  pageSize = ARCHIVE_PAGE_SIZE
): Promise<ArchiveSearchPage<ArchiveSearchResultArtist>> {
  const currentPage = clampPage(page);
  const where = {
    ...eligibleArtistWhere,
    ...(query
      ? {
          OR: [
            { name: { contains: query, mode: "insensitive" as const } },
            { instrument: { contains: query, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.artist.findMany({
      where,
      orderBy: query ? { name: "asc" } : { createdAt: "desc" },
      skip: (currentPage - 1) * pageSize,
      take: pageSize,
    }),
    prisma.artist.count({ where }),
  ]);

  const items: ArchiveSearchResultArtist[] = rows.map((artist) => ({
    entityType: "artist",
    id: artist.id,
    slug: artist.slug,
    name: artist.name,
    instrument: artist.instrument,
    biography: artist.biography,
  }));

  return { items, total, page: currentPage, pageSize };
}

export async function searchChoirs(
  query: string | undefined,
  page = 1,
  pageSize = ARCHIVE_PAGE_SIZE
): Promise<ArchiveSearchPage<ArchiveSearchResultChoir>> {
  const currentPage = clampPage(page);
  const where = {
    ...eligibleChoirWhere,
    ...(query
      ? {
          OR: [
            { name: { contains: query, mode: "insensitive" as const } },
            { directorName: { contains: query, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.choir.findMany({
      where,
      orderBy: query ? { name: "asc" } : { createdAt: "desc" },
      skip: (currentPage - 1) * pageSize,
      take: pageSize,
    }),
    prisma.choir.count({ where }),
  ]);

  const items: ArchiveSearchResultChoir[] = rows.map((choir) => ({
    entityType: "choir",
    id: choir.id,
    slug: choir.slug,
    name: choir.name,
    directorName: choir.directorName,
    description: choir.description,
  }));

  return { items, total, page: currentPage, pageSize };
}

export async function searchConductors(
  query: string | undefined,
  page = 1,
  pageSize = ARCHIVE_PAGE_SIZE
): Promise<ArchiveSearchPage<ArchiveSearchResultConductor>> {
  const currentPage = clampPage(page);
  const where = {
    ...eligibleConductorWhere,
    ...(query ? { name: { contains: query, mode: "insensitive" as const } } : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.conductor.findMany({
      where,
      orderBy: query ? { name: "asc" } : { createdAt: "desc" },
      skip: (currentPage - 1) * pageSize,
      take: pageSize,
    }),
    prisma.conductor.count({ where }),
  ]);

  const items: ArchiveSearchResultConductor[] = rows.map((conductor) => ({
    entityType: "conductor",
    id: conductor.id,
    slug: conductor.slug,
    name: conductor.name,
    biography: conductor.biography,
  }));

  return { items, total, page: currentPage, pageSize };
}

/**
 * Organisation search — Phase 6G-14, now that /organisations/[slug]
 * exists. Follows the exact same where/Promise.all/map shape as
 * searchConductors above: archivedAt-null visibility, DB-side ILIKE
 * across Organisation's own canonical fields (name, description).
 */
export async function searchOrganisations(
  query: string | undefined,
  page = 1,
  pageSize = ARCHIVE_PAGE_SIZE
): Promise<ArchiveSearchPage<ArchiveSearchResultOrganisation>> {
  const currentPage = clampPage(page);
  const where = {
    ...eligibleOrganisationWhere,
    ...(query
      ? {
          OR: [
            { name: { contains: query, mode: "insensitive" as const } },
            { description: { contains: query, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.organisation.findMany({
      where,
      orderBy: query ? { name: "asc" } : { createdAt: "desc" },
      skip: (currentPage - 1) * pageSize,
      take: pageSize,
    }),
    prisma.organisation.count({ where }),
  ]);

  const items: ArchiveSearchResultOrganisation[] = rows.map((organisation) => ({
    entityType: "organisation",
    id: organisation.id,
    slug: organisation.slug,
    name: organisation.name,
    description: organisation.description,
  }));

  return { items, total, page: currentPage, pageSize };
}

/**
 * The combined "all supported entity types" view — composes the
 * single-type search functions above rather than a separate query
 * implementation, so a future entity type is one new function away, not
 * a rewrite. Deliberately capped and never paginated (brief §6/§9): this
 * is the discovery/overview mode, not exhaustive search.
 */
export async function searchArchiveAll(query: string | undefined, limitPerType = ARCHIVE_ALL_TYPES_LIMIT): Promise<ArchiveSearchAllResult> {
  const [composers, works, recordings, venues, programmes, performances, artists, choirs, conductors, organisations] = await Promise.all([
    searchComposers(query, 1, limitPerType),
    searchWorks(query, 1, limitPerType),
    searchRecordings(query, 1, limitPerType),
    searchVenues(query, 1, limitPerType),
    searchProgrammes(query, 1, limitPerType),
    searchPerformances(query, 1, limitPerType),
    searchArtists(query, 1, limitPerType),
    searchChoirs(query, 1, limitPerType),
    searchConductors(query, 1, limitPerType),
    searchOrganisations(query, 1, limitPerType),
  ]);

  return { composers, works, recordings, venues, programmes, performances, artists, choirs, conductors, organisations };
}
