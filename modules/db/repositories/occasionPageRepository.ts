import { prisma } from "../client";
import { isRecordingPublished } from "../../mmke/catalogue/isRecordingPublished";
import type { OccasionPageCollection, OccasionPagePerformance, OccasionPageProgramme, OccasionPageRecording, PublicOccasionPageData } from "../../mmke/occasionPage/occasionPageContract";
import { findPublicCollectionsByIds } from "./collectionRepository";
import { listEntitiesForOccasion } from "./occasionRepository";
import { PUBLISHED_REVISION_WHERE, eligiblePerformanceWhere, eligibleProgrammeWhere } from "./publicEligibility";

// Public Occasion pages — the reader behind /occasions/[slug] and its sitemap entry. ONE definition of "public": getPublicOccasionPageData returns
// null unless the Occasion is active and something public is attached to it, and the sitemap is built by calling this very function, so the page and the
// sitemap cannot disagree.
//
// What counts as attached (all of it filtered by the shared eligibility rules, so a public page never links to something whose own page would 404):
//   - a Performance attached directly, or any Performance of an attached Programme   -> eligible Performances only (publicEligibility.ts)
//   - a Programme attached directly                                                  -> eligible Programmes only
//   - a Collection attached directly                                                 -> PUBLISHED, non-archived Collections only
//   - a Recording: its PUBLISHED revision carries the Occasion (revision-scoped since Phase 6L), or it records a listed Performance
//                                                                                    -> published Recordings only (isRecordingPublished)
// A DRAFT revision's occasion never appears (only the revision the Recording currently publishes is read), and the frozen legacy Recording-level rows are
// never read. An archived Occasion is not public at all.

/** A technical bound on each list, so one heavily used Occasion cannot make an unbounded page. Not a product setting. */
const LIST_LIMIT = 200;
const SITEMAP_MAX_OCCASIONS = 500;
const SITEMAP_CONCURRENCY = 10;

export async function getPublicOccasionPageData(slug: string): Promise<PublicOccasionPageData | null> {
  const occasion = await prisma.occasion.findFirst({ where: { slug, archivedAt: null } });
  if (!occasion) return null;

  const links = await listEntitiesForOccasion(occasion.id);
  const idsOf = (type: "PROGRAMME" | "PERFORMANCE" | "COLLECTION") => links.filter((l) => l.entityType === type).map((l) => l.entityId);
  const taggedPerformanceIds = idsOf("PERFORMANCE");
  const taggedProgrammeIds = idsOf("PROGRAMME");
  const taggedCollectionIds = idsOf("COLLECTION");

  const [performanceRows, programmeRows, collectionRows, taggedRevisions] = await Promise.all([
    taggedPerformanceIds.length + taggedProgrammeIds.length === 0
      ? Promise.resolve([])
      : prisma.performance.findMany({
          where: { AND: [eligiblePerformanceWhere, { OR: [{ id: { in: taggedPerformanceIds } }, { programmeId: { in: taggedProgrammeIds } }] }] },
          select: { id: true, slug: true, performanceDate: true, venue: { select: { name: true, slug: true } }, programme: { select: { title: true } } },
          orderBy: [{ performanceDate: { sort: "desc", nulls: "last" } }, { id: "asc" }],
          take: LIST_LIMIT,
        }),
    taggedProgrammeIds.length === 0
      ? Promise.resolve([])
      : prisma.programme.findMany({ where: { AND: [eligibleProgrammeWhere, { id: { in: taggedProgrammeIds } }] }, select: { id: true, slug: true, title: true }, orderBy: [{ title: "asc" }, { id: "asc" }], take: LIST_LIMIT }),
    findPublicCollectionsByIds(taggedCollectionIds),
    prisma.recordingRevisionOccasion.findMany({ where: { occasionId: occasion.id, revision: PUBLISHED_REVISION_WHERE }, select: { revision: { select: { recordingId: true } } }, take: LIST_LIMIT }),
  ]);

  const performances: OccasionPagePerformance[] = performanceRows.map((p) => ({
    id: p.id,
    slug: p.slug,
    performanceDate: p.performanceDate,
    venueName: p.venue.name,
    venueSlug: p.venue.slug,
    programmeTitle: p.programme.title,
  }));
  const programmes: OccasionPageProgramme[] = programmeRows.map((p) => ({ id: p.id, slug: p.slug, title: p.title }));
  const collections: OccasionPageCollection[] = collectionRows.map((c) => ({ id: c.id, slug: c.slug, title: c.title }));

  // Recordings: those whose published revision carries the Occasion, plus the published Recordings of the listed Performances.
  const performanceIds = performances.map((p) => p.id);
  const ofPerformances =
    performanceIds.length === 0
      ? []
      : await prisma.recordingRevision.findMany({ where: { AND: [PUBLISHED_REVISION_WHERE, { performanceId: { in: performanceIds } }] }, select: { recordingId: true }, take: LIST_LIMIT });
  const recordingIds = [...new Set([...taggedRevisions.map((r) => r.revision.recordingId), ...ofPerformances.map((r) => r.recordingId)])];
  const recordings: OccasionPageRecording[] =
    recordingIds.length === 0
      ? []
      : (
          await prisma.recording.findMany({
            where: { id: { in: recordingIds }, status: "PUBLISHED" },
            include: { currentPublishedRevision: { select: { title: true } } },
            orderBy: [{ createdAt: "desc" }, { id: "asc" }],
            take: LIST_LIMIT,
          })
        )
          .filter((r) => isRecordingPublished(r))
          .map((r) => ({ id: r.id, slug: r.slug, title: r.currentPublishedRevision?.title ?? null }));

  // Reachability: an Occasion with nothing public attached is not public (and never an empty page).
  if (performances.length + programmes.length + recordings.length + collections.length === 0) return null;

  return { id: occasion.id, slug: occasion.slug, name: occasion.name, description: occasion.description, performances, programmes, recordings, collections, lastModified: occasion.updatedAt };
}

export interface OccasionSitemapEntry {
  slug: string;
  updatedAt: Date;
}

/** The Occasions that have a public page, built by calling the page's own reader so the two can never disagree. Occasions are a small curated list. */
export async function listPublicOccasionSitemapEntries(): Promise<OccasionSitemapEntry[]> {
  const active = await prisma.occasion.findMany({ where: { archivedAt: null }, select: { slug: true, updatedAt: true }, orderBy: { slug: "asc" }, take: SITEMAP_MAX_OCCASIONS });
  const entries: OccasionSitemapEntry[] = [];
  for (let offset = 0; offset < active.length; offset += SITEMAP_CONCURRENCY) {
    const chunk = active.slice(offset, offset + SITEMAP_CONCURRENCY);
    const pages = await Promise.all(chunk.map((o) => getPublicOccasionPageData(o.slug)));
    chunk.forEach((o, i) => {
      if (pages[i]) entries.push(o);
    });
  }
  return entries;
}