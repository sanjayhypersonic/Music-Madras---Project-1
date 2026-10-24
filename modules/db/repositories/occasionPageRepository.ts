import { prisma } from "../client";
import { isPlausibleSlug } from "../../mmke/slug/isPlausibleSlug";
import { isRecordingPubliclyVisible } from "../../mmke/catalogue/isRecordingPublished";
import type { OccasionPageCollection, OccasionPagePerformance, OccasionPageProgramme, OccasionPageRecording, PublicOccasionPageData } from "../../mmke/occasionPage/occasionPageContract";
import { findPublicCollectionsByIds } from "./collectionRepository";
import { listEntitiesForOccasion, listEntitiesForOccasions } from "./occasionRepository";
import { PUBLISHED_REVISION_WHERE, RECORDING_NOT_HELD_WHERE, eligiblePerformanceWhere, eligibleProgrammeWhere } from "./publicEligibility";

// Public Occasion pages — the reader behind /occasions/[slug], its sitemap entry and archive search. ONE definition of "public": getPublicOccasionPageData
// returns null unless the Occasion is active and something public is attached to it; filterPublicOccasionIds is its set-based twin (a constant number of
// queries for any number of Occasions) used by the sitemap and archive search, and a test pins that the two never disagree.
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

export async function getPublicOccasionPageData(slug: string): Promise<PublicOccasionPageData | null> {
  if (!isPlausibleSlug(slug)) return null; // a slug no page could have (control characters, absurd length): not found, never a database error
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
            where: { id: { in: recordingIds }, status: "PUBLISHED", ...RECORDING_NOT_HELD_WHERE },
            include: { currentPublishedRevision: { select: { title: true } } },
            orderBy: [{ createdAt: "desc" }, { id: "asc" }],
            take: LIST_LIMIT,
          })
        )
          .filter((r) => isRecordingPubliclyVisible(r))
          .map((r) => ({ id: r.id, slug: r.slug, title: r.currentPublishedRevision?.title ?? null }));

  // Reachability: an Occasion with nothing public attached is not public (and never an empty page).
  if (performances.length + programmes.length + recordings.length + collections.length === 0) return null;

  return { id: occasion.id, slug: occasion.slug, name: occasion.name, description: occasion.description, performances, programmes, recordings, collections, lastModified: occasion.updatedAt };
}

/**
 * Which of these Occasions are PUBLIC — the set-based twin of getPublicOccasionPageData's "something public is attached" rule, in a constant number of queries
 * however many Occasions are asked about (archive search and the sitemap use it). An Occasion is public when it is active and at least one of these holds:
 * an eligible Performance is attached directly or belongs to an attached Programme (an eligible attached Programme always has such a Performance); a
 * published, non-archived Collection is attached; or a published Recording's PUBLISHED revision carries it. A test pins the equivalence with the page reader.
 */
export async function filterPublicOccasionIds(occasionIds: readonly string[]): Promise<Set<string>> {
  const ids = [...new Set(occasionIds)];
  if (ids.length === 0) return new Set();
  const active = (await prisma.occasion.findMany({ where: { id: { in: ids }, archivedAt: null }, select: { id: true } })).map((o) => o.id);
  if (active.length === 0) return new Set();

  const links = await listEntitiesForOccasions(active);
  const of = (type: "PROGRAMME" | "PERFORMANCE" | "COLLECTION") => links.filter((l) => l.entityType === type);
  const performanceIds = of("PERFORMANCE").map((l) => l.entityId);
  const programmeIds = of("PROGRAMME").map((l) => l.entityId);
  const collectionIds = of("COLLECTION").map((l) => l.entityId);

  const [performances, collections, revisionLinks] = await Promise.all([
    performanceIds.length + programmeIds.length === 0
      ? Promise.resolve([])
      : prisma.performance.findMany({
          where: { AND: [eligiblePerformanceWhere, { OR: [{ id: { in: performanceIds } }, { programmeId: { in: programmeIds } }] }] },
          select: { id: true, programmeId: true },
        }),
    findPublicCollectionsByIds(collectionIds),
    prisma.recordingRevisionOccasion.findMany({ where: { occasionId: { in: active }, revision: PUBLISHED_REVISION_WHERE }, select: { occasionId: true, revision: { select: { recordingId: true } } } }),
  ]);
  const recordingIds = [...new Set(revisionLinks.map((l) => l.revision.recordingId))];
  const publishedRecordingIds = new Set(
    recordingIds.length === 0
      ? []
      : (await prisma.recording.findMany({ where: { id: { in: recordingIds }, status: "PUBLISHED", ...RECORDING_NOT_HELD_WHERE }, include: { currentPublishedRevision: { select: { title: true } } } })).filter((r) => isRecordingPubliclyVisible(r)).map((r) => r.id)
  );

  const eligiblePerformanceIds = new Set(performances.map((p) => p.id));
  const programmeHasEligiblePerformance = new Set(performances.map((p) => p.programmeId));
  const publicCollectionIds = new Set(collections.map((c) => c.id));

  const publicIds = new Set<string>();
  for (const link of links) {
    if (link.entityType === "PERFORMANCE" && eligiblePerformanceIds.has(link.entityId)) publicIds.add(link.occasionId);
    else if (link.entityType === "PROGRAMME" && programmeHasEligiblePerformance.has(link.entityId)) publicIds.add(link.occasionId);
    else if (link.entityType === "COLLECTION" && publicCollectionIds.has(link.entityId)) publicIds.add(link.occasionId);
  }
  for (const link of revisionLinks) if (publishedRecordingIds.has(link.revision.recordingId)) publicIds.add(link.occasionId);
  return publicIds;
}

export interface OccasionSitemapEntry {
  slug: string;
  updatedAt: Date;
}

/** The Occasions that have a public page (one set-based check, not one query set per Occasion). Occasions are a small curated list, bounded anyway. */
export async function listPublicOccasionSitemapEntries(): Promise<OccasionSitemapEntry[]> {
  const active = await prisma.occasion.findMany({ where: { archivedAt: null }, select: { id: true, slug: true, updatedAt: true }, orderBy: { slug: "asc" }, take: SITEMAP_MAX_OCCASIONS });
  const publicIds = await filterPublicOccasionIds(active.map((o) => o.id));
  return active.filter((o) => publicIds.has(o.id)).map((o) => ({ slug: o.slug, updatedAt: o.updatedAt }));
}