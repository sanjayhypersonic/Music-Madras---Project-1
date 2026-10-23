import { prisma } from "../client";
import { isRecordingPublished } from "../../mmke/catalogue/isRecordingPublished";
import { likeNeedle } from "../../mmke/search/searchText";
import { rankCandidates, type RankCandidate } from "../../mmke/search/searchRanking";
import { findPublicVideoPagesByYouTubeVideoIds } from "./youtubeVideoPageRepository";
import { PUBLIC_COLLECTION_WHERE } from "./collectionRepository";
import { PUBLIC_LEARNING_GUIDE_WHERE } from "./learningGuideRepository";
import { filterPublicOccasionIds } from "./occasionPageRepository";
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
  ArchiveSearchResultCollection,
  ArchiveSearchResultComposer,
  ArchiveSearchResultConductor,
  ArchiveSearchResultGuide,
  ArchiveSearchResultOccasion,
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

/** How many candidates per tier are ranked in memory for one query (a technical bound, so no query scans or sorts an unbounded set). */
export const RANK_CANDIDATE_CAP = 500;

interface RankedPageArgs<Row extends { id: string }> {
  query: string | undefined;
  page: number;
  pageSize: number;
  /** No query: the original browse order (newest first), one page. */
  plain: () => Promise<Row[]>;
  count: () => Promise<number>;
  /** Id + display title of matching records; `prefixOnly` narrows to titles that START with the query. Always ordered by title. */
  candidates: (prefixOnly: boolean, take: number) => Promise<RankCandidate[]>;
  /** Full rows for exactly these ids (the ids are already visibility-checked: they came from `candidates`). */
  load: (ids: string[]) => Promise<Row[]>;
}

/**
 * One page of results in RELEVANCE order (searchRanking.ts: exact title, prefix, word prefix, contains, other field; then alphabetical). Candidates come
 * from two bounded queries — titles that start with the query (so an exact or prefix match is never crowded out of the cap by alphabetically earlier weaker
 * matches) and every match — are merged without duplicates, ranked in memory, and only the page's rows are loaded. `total` is the database count of
 * matches. With no query the original browse order is used unchanged.
 */
async function rankedPage<Row extends { id: string }>(args: RankedPageArgs<Row>): Promise<{ rows: Row[]; total: number }> {
  if (!args.query) {
    const [rows, total] = await Promise.all([args.plain(), args.count()]);
    return { rows, total };
  }
  const [prefix, all, total] = await Promise.all([args.candidates(true, RANK_CANDIDATE_CAP), args.candidates(false, RANK_CANDIDATE_CAP), args.count()]);
  const ordered = rankCandidates(args.query, [...prefix, ...all]);
  const start = (args.page - 1) * args.pageSize;
  const ids = ordered.slice(start, start + args.pageSize);
  const loaded = ids.length > 0 ? await args.load(ids) : [];
  const byId = new Map(loaded.map((row) => [row.id, row]));
  return { rows: ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : [])), total };
}

export async function searchComposers(
  query: string | undefined,
  page = 1,
  pageSize = ARCHIVE_PAGE_SIZE
): Promise<ArchiveSearchPage<ArchiveSearchResultComposer>> {
  const currentPage = clampPage(page);
  const where = {
    ...eligibleComposerWhere,
    ...(query ? { name: { contains: likeNeedle(query), mode: "insensitive" as const } } : {}),
  };

  const { rows, total } = await rankedPage({
    query,
    page: currentPage,
    pageSize,
    plain: () => prisma.composer.findMany({ where, orderBy: { createdAt: "desc" }, skip: (currentPage - 1) * pageSize, take: pageSize }),
    count: () => prisma.composer.count({ where }),
    candidates: async (prefixOnly, take) =>
      (await prisma.composer.findMany({ where: prefixOnly ? { AND: [where, { name: { startsWith: likeNeedle(query!), mode: "insensitive" } }] } : where, select: { id: true, name: true }, orderBy: { name: "asc" }, take })).map((r) => ({ id: r.id, label: r.name })),
    load: (ids) => prisma.composer.findMany({ where: { id: { in: ids } } }),
  });

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
                { title: { contains: likeNeedle(query), mode: "insensitive" as const } },
                { alternateTitles: { has: query } },
              ],
            },
          ]
        : []),
    ],
  };

  const { rows, total } = await rankedPage({
    query,
    page: currentPage,
    pageSize,
    plain: () => prisma.musicalWork.findMany({ where, include: { composer: true }, orderBy: { createdAt: "desc" }, skip: (currentPage - 1) * pageSize, take: pageSize }),
    count: () => prisma.musicalWork.count({ where }),
    candidates: async (prefixOnly, take) =>
      (await prisma.musicalWork.findMany({ where: prefixOnly ? { AND: [where, { title: { startsWith: likeNeedle(query!), mode: "insensitive" } }] } : where, select: { id: true, title: true }, orderBy: { title: "asc" }, take })).map((r) => ({ id: r.id, label: r.title })),
    load: (ids) => prisma.musicalWork.findMany({ where: { id: { in: ids } }, include: { composer: true } }),
  });

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
            { name: { contains: likeNeedle(query), mode: "insensitive" as const } },
            { city: { contains: likeNeedle(query), mode: "insensitive" as const } },
            { country: { contains: likeNeedle(query), mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const { rows, total } = await rankedPage({
    query,
    page: currentPage,
    pageSize,
    plain: () => prisma.venue.findMany({ where, orderBy: { createdAt: "desc" }, skip: (currentPage - 1) * pageSize, take: pageSize }),
    count: () => prisma.venue.count({ where }),
    candidates: async (prefixOnly, take) =>
      (await prisma.venue.findMany({ where: prefixOnly ? { AND: [where, { name: { startsWith: likeNeedle(query!), mode: "insensitive" } }] } : where, select: { id: true, name: true }, orderBy: { name: "asc" }, take })).map((r) => ({ id: r.id, label: r.name })),
    load: (ids) => prisma.venue.findMany({ where: { id: { in: ids } } }),
  });

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
              { title: { contains: likeNeedle(query), mode: "insensitive" as const } },
              { description: { contains: likeNeedle(query), mode: "insensitive" as const } },
            ],
          },
        }
      : {}),
  };

  const recordingInclude = {
    currentPublishedRevision: {
      include: {
        performance: { include: { venue: true, programme: true } },
        mediaResources: true,
      },
    },
  };
  const { rows, total } = await rankedPage({
    query,
    page: currentPage,
    pageSize,
    plain: () => prisma.recording.findMany({ where, include: recordingInclude, orderBy: { updatedAt: "desc" }, skip: (currentPage - 1) * pageSize, take: pageSize }),
    count: () => prisma.recording.count({ where }),
    candidates: async (prefixOnly, take) =>
      (
        await prisma.recording.findMany({
          where: prefixOnly ? { AND: [where, { currentPublishedRevision: { title: { startsWith: likeNeedle(query!), mode: "insensitive" } } }] } : where,
          select: { id: true, currentPublishedRevision: { select: { title: true } } },
          orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
          take,
        })
      ).map((r) => ({ id: r.id, label: r.currentPublishedRevision?.title ?? "" })),
    load: (ids) => prisma.recording.findMany({ where: { id: { in: ids }, status: "PUBLISHED" }, include: recordingInclude }),
  });

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
            { title: { contains: likeNeedle(query), mode: "insensitive" as const } },
            { notes: { contains: likeNeedle(query), mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  // The preview never names an archived Work (or a Work of an archived Composer).
  const programmeInclude = {
    items: {
      where: { musicalWork: { archivedAt: null, composer: { archivedAt: null } } },
      include: { musicalWork: true },
      orderBy: { order: "asc" as const },
      take: 3,
    },
  };
  const { rows, total } = await rankedPage({
    query,
    page: currentPage,
    pageSize,
    plain: () => prisma.programme.findMany({ where, include: programmeInclude, orderBy: { createdAt: "desc" }, skip: (currentPage - 1) * pageSize, take: pageSize }),
    count: () => prisma.programme.count({ where }),
    candidates: async (prefixOnly, take) =>
      (await prisma.programme.findMany({ where: prefixOnly ? { AND: [where, { title: { startsWith: likeNeedle(query!), mode: "insensitive" } }] } : where, select: { id: true, title: true }, orderBy: { title: "asc" }, take })).map((r) => ({ id: r.id, label: r.title })),
    load: (ids) => prisma.programme.findMany({ where: { id: { in: ids } }, include: programmeInclude }),
  });

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
            { programme: { title: { contains: likeNeedle(query), mode: "insensitive" as const } } },
            { venue: { name: { contains: likeNeedle(query), mode: "insensitive" as const } } },
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
            { name: { contains: likeNeedle(query), mode: "insensitive" as const } },
            { instrument: { contains: likeNeedle(query), mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const { rows, total } = await rankedPage({
    query,
    page: currentPage,
    pageSize,
    plain: () => prisma.artist.findMany({ where, orderBy: { createdAt: "desc" }, skip: (currentPage - 1) * pageSize, take: pageSize }),
    count: () => prisma.artist.count({ where }),
    candidates: async (prefixOnly, take) =>
      (await prisma.artist.findMany({ where: prefixOnly ? { AND: [where, { name: { startsWith: likeNeedle(query!), mode: "insensitive" } }] } : where, select: { id: true, name: true }, orderBy: { name: "asc" }, take })).map((r) => ({ id: r.id, label: r.name })),
    load: (ids) => prisma.artist.findMany({ where: { id: { in: ids } } }),
  });

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
            { name: { contains: likeNeedle(query), mode: "insensitive" as const } },
            { directorName: { contains: likeNeedle(query), mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const { rows, total } = await rankedPage({
    query,
    page: currentPage,
    pageSize,
    plain: () => prisma.choir.findMany({ where, orderBy: { createdAt: "desc" }, skip: (currentPage - 1) * pageSize, take: pageSize }),
    count: () => prisma.choir.count({ where }),
    candidates: async (prefixOnly, take) =>
      (await prisma.choir.findMany({ where: prefixOnly ? { AND: [where, { name: { startsWith: likeNeedle(query!), mode: "insensitive" } }] } : where, select: { id: true, name: true }, orderBy: { name: "asc" }, take })).map((r) => ({ id: r.id, label: r.name })),
    load: (ids) => prisma.choir.findMany({ where: { id: { in: ids } } }),
  });

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
    ...(query ? { name: { contains: likeNeedle(query), mode: "insensitive" as const } } : {}),
  };

  const { rows, total } = await rankedPage({
    query,
    page: currentPage,
    pageSize,
    plain: () => prisma.conductor.findMany({ where, orderBy: { createdAt: "desc" }, skip: (currentPage - 1) * pageSize, take: pageSize }),
    count: () => prisma.conductor.count({ where }),
    candidates: async (prefixOnly, take) =>
      (await prisma.conductor.findMany({ where: prefixOnly ? { AND: [where, { name: { startsWith: likeNeedle(query!), mode: "insensitive" } }] } : where, select: { id: true, name: true }, orderBy: { name: "asc" }, take })).map((r) => ({ id: r.id, label: r.name })),
    load: (ids) => prisma.conductor.findMany({ where: { id: { in: ids } } }),
  });

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
            { name: { contains: likeNeedle(query), mode: "insensitive" as const } },
            { description: { contains: likeNeedle(query), mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const { rows, total } = await rankedPage({
    query,
    page: currentPage,
    pageSize,
    plain: () => prisma.organisation.findMany({ where, orderBy: { createdAt: "desc" }, skip: (currentPage - 1) * pageSize, take: pageSize }),
    count: () => prisma.organisation.count({ where }),
    candidates: async (prefixOnly, take) =>
      (await prisma.organisation.findMany({ where: prefixOnly ? { AND: [where, { name: { startsWith: likeNeedle(query!), mode: "insensitive" } }] } : where, select: { id: true, name: true }, orderBy: { name: "asc" }, take })).map((r) => ({ id: r.id, label: r.name })),
    load: (ids) => prisma.organisation.findMany({ where: { id: { in: ids } } }),
  });

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
 * Collection search: published, non-archived Collections only (PUBLIC_COLLECTION_WHERE, the rule /collections/[slug] itself uses), matched on the Collection's
 * own title and description.
 */
export async function searchCollections(
  query: string | undefined,
  page = 1,
  pageSize = ARCHIVE_PAGE_SIZE
): Promise<ArchiveSearchPage<ArchiveSearchResultCollection>> {
  const currentPage = clampPage(page);
  const where = {
    ...PUBLIC_COLLECTION_WHERE,
    ...(query
      ? {
          OR: [
            { title: { contains: likeNeedle(query), mode: "insensitive" as const } },
            { description: { contains: likeNeedle(query), mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const { rows, total } = await rankedPage({
    query,
    page: currentPage,
    pageSize,
    plain: () => prisma.collection.findMany({ where, orderBy: { createdAt: "desc" }, skip: (currentPage - 1) * pageSize, take: pageSize }),
    count: () => prisma.collection.count({ where }),
    candidates: async (prefixOnly, take) =>
      (await prisma.collection.findMany({ where: prefixOnly ? { AND: [where, { title: { startsWith: likeNeedle(query!), mode: "insensitive" } }] } : where, select: { id: true, title: true }, orderBy: { title: "asc" }, take })).map((r) => ({ id: r.id, label: r.title })),
    load: (ids) => prisma.collection.findMany({ where: { id: { in: ids } } }),
  });

  const items: ArchiveSearchResultCollection[] = rows.map((collection) => ({ entityType: "collection", id: collection.id, slug: collection.slug, title: collection.title, description: collection.description }));
  return { items, total, page: currentPage, pageSize };
}

/**
 * Learning-guide search: published, non-archived guides only (PUBLIC_LEARNING_GUIDE_WHERE, the rule /learning/[slug] itself uses), matched on the guide's
 * TITLE (its body is long Markdown and is deliberately not scanned on every search). A result carries a short factual line, never the body.
 */
export async function searchLearningGuides(
  query: string | undefined,
  page = 1,
  pageSize = ARCHIVE_PAGE_SIZE
): Promise<ArchiveSearchPage<ArchiveSearchResultGuide>> {
  const currentPage = clampPage(page);
  const where = {
    ...PUBLIC_LEARNING_GUIDE_WHERE,
    ...(query ? { title: { contains: likeNeedle(query), mode: "insensitive" as const } } : {}),
  };

  const { rows, total } = await rankedPage({
    query,
    page: currentPage,
    pageSize,
    plain: () => prisma.learningGuide.findMany({ where, orderBy: { createdAt: "desc" }, skip: (currentPage - 1) * pageSize, take: pageSize }),
    count: () => prisma.learningGuide.count({ where }),
    candidates: async (prefixOnly, take) =>
      (await prisma.learningGuide.findMany({ where: prefixOnly ? { AND: [where, { title: { startsWith: likeNeedle(query!), mode: "insensitive" } }] } : where, select: { id: true, title: true }, orderBy: { title: "asc" }, take })).map((r) => ({ id: r.id, label: r.title })),
    load: (ids) => prisma.learningGuide.findMany({ where: { id: { in: ids } } }),
  });

  const items: ArchiveSearchResultGuide[] = rows.map((guide) => ({
    entityType: "guide",
    id: guide.id,
    slug: guide.slug,
    title: guide.title,
    difficultyLevel: guide.difficultyLevel,
    estimatedReadingTimeMinutes: guide.estimatedReadingTimeMinutes,
  }));
  return { items, total, page: currentPage, pageSize };
}

/**
 * Occasion search: an Occasion is a result only while it has a PUBLIC page — active, with something public attached (filterPublicOccasionIds, the set-based
 * twin of the page's own rule) — so a result never leads to a 404 and an Occasion with only draft content never leaks, not even through the count. Occasions are
 * a small curated list, so the matches (bounded) are fetched, filtered to the public ones, ranked and paged in memory.
 */
export async function searchOccasions(
  query: string | undefined,
  page = 1,
  pageSize = ARCHIVE_PAGE_SIZE
): Promise<ArchiveSearchPage<ArchiveSearchResultOccasion>> {
  const currentPage = clampPage(page);
  const where = {
    archivedAt: null,
    ...(query
      ? {
          OR: [
            { name: { contains: likeNeedle(query), mode: "insensitive" as const } },
            { description: { contains: likeNeedle(query), mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const matches = await prisma.occasion.findMany({ where, orderBy: [{ name: "asc" }, { id: "asc" }], take: RANK_CANDIDATE_CAP });
  const publicIds = await filterPublicOccasionIds(matches.map((o) => o.id));
  const visible = matches.filter((o) => publicIds.has(o.id));
  const ordered = query ? rankCandidates(query, visible.map((o) => ({ id: o.id, label: o.name }))) : visible.map((o) => o.id);
  const byId = new Map(visible.map((o) => [o.id, o]));
  const start = (currentPage - 1) * pageSize;

  const items: ArchiveSearchResultOccasion[] = ordered.slice(start, start + pageSize).map((id) => {
    const occasion = byId.get(id)!;
    return { entityType: "occasion", id: occasion.id, slug: occasion.slug, name: occasion.name, description: occasion.description };
  });
  return { items, total: visible.length, page: currentPage, pageSize };
}

/**
 * The combined "all supported entity types" view — composes the
 * single-type search functions above rather than a separate query
 * implementation, so a future entity type is one new function away, not
 * a rewrite. Deliberately capped and never paginated (brief §6/§9): this
 * is the discovery/overview mode, not exhaustive search.
 */
export async function searchArchiveAll(query: string | undefined, limitPerType = ARCHIVE_ALL_TYPES_LIMIT): Promise<ArchiveSearchAllResult> {
  const [composers, works, recordings, venues, programmes, performances, artists, choirs, conductors, organisations, collections, guides, occasions] = await Promise.all([
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
    searchCollections(query, 1, limitPerType),
    searchLearningGuides(query, 1, limitPerType),
    searchOccasions(query, 1, limitPerType),
  ]);

  return { composers, works, recordings, venues, programmes, performances, artists, choirs, conductors, organisations, collections, guides, occasions };
}