import { prisma } from "../client";
import { dedupeById } from "../../mmke/relationships/formatComposerCredit";
import { findPublicVideoPagesByYouTubeVideoIds } from "./youtubeVideoPageRepository";
import { findPublicCollectionsByIds } from "./collectionRepository";
import { listMusicalWorksByComposer } from "./musicalWorkRepository";
import { assembleEntityPageData } from "../../mmke/entityPage/assembleEntityPageData";
import { isRecordingPublished } from "../../mmke/catalogue/isRecordingPublished";
import type {
  Artist,
  Choir,
  Collection,
  Conductor,
  MusicalWork,
  Performance,
  PerformanceChoir,
  PerformanceConductor,
  PerformancePerformer,
  Programme,
  Recording,
  RecordingRevision,
  Venue,
} from "@prisma/client";
import type { PublicVideoPageResult } from "./youtubeVideoPageRepository";
import type { EntityPageData } from "../../mmke/entityPage/entityPageContract";

// Phase 6G-4A — the reusable canonical-relationship / media-aggregation
// layer public entity pages will eventually read from. This is the
// "reverse" direction of the traversal recordingRepository.ts's
// getCanonicalContextForRevision already does (revision -> works/
// performance/media): here we go entity -> performances/works ->
// PUBLISHED recordings -> PUBLIC videos/collections.
//
// Critical architectural rule (brief §3, §8, §16): every relationship
// resolved here comes from an explicit canonical FK/join-table row that
// Studio cataloguing already created — never from matching a YouTube
// video's title/description text, and never inferred by AI. A video with
// no MediaResource row pointing at it through this chain simply does not
// appear, no matter what its title says.
//
// Critical architectural rule (brief §10): "related in MMKE" and
// "publicly discoverable in Museum" are kept distinct. A Recording can be
// canonically related to an entity while its video is still a private,
// unlisted-unapproved, or unpublished YouTubeVideoPage — this layer only
// ever returns the subset that findPublicVideoPagesByYouTubeVideoIds (the
// existing isYouTubeVideoPagePublic gate, not a second competing
// predicate) says is genuinely public.

export interface RelatedVideoSummary extends PublicVideoPageResult {
  /** Convenience for dedupeById; equal to youtubeVideo.id. */
  id: string;
}

export interface RecordingWithPublishedRevision extends Recording {
  currentPublishedRevision: RecordingRevision;
}

export interface PerformanceWithVenueAndProgramme extends Performance {
  venue: Venue;
  programme: Programme;
  performers: (PerformancePerformer & { artist: Artist })[];
  choirs: (PerformanceChoir & { choir: Choir })[];
  conductors: (PerformanceConductor & { conductor: Conductor })[];
}

export interface RelatedContent {
  performances: PerformanceWithVenueAndProgramme[];
  programmes: Programme[];
  recordings: RecordingWithPublishedRevision[];
  videos: RelatedVideoSummary[];
  collections: Collection[];
}

export interface RelatedContentInput {
  /** Performances the entity is canonically linked to (join table or direct FK). */
  performanceIds?: string[];
  /**
   * Musical works the entity is canonically linked to (Composer only,
   * today). Also transitively pulls in any Performance whose Programme
   * includes one of these works — distinct from a Recording's own direct
   * RecordingRevisionWork attachment, which is checked separately below;
   * see recordingRepository.ts's attachWorkToRevision for why the two
   * paths are both legitimate and not the same thing.
   */
  workIds?: string[];
}

/**
 * The shared core (brief §6: "do not create eight or ten completely
 * separate implementations"). Every entity-specific function below is a
 * thin wrapper that computes its own performanceIds/workIds and defers
 * here for the actual traversal + public-visibility filtering.
 */
export async function resolveRelatedContent(input: RelatedContentInput): Promise<RelatedContent> {
  const explicitPerformanceIds = input.performanceIds ?? [];
  const workIds = input.workIds ?? [];

  const performancesFromWorks =
    workIds.length > 0
      ? await prisma.performance.findMany({
          where: { archivedAt: null, programme: { items: { some: { musicalWorkId: { in: workIds } } } } },
          select: { id: true },
        })
      : [];

  const allPerformanceIds = Array.from(
    new Set([...explicitPerformanceIds, ...performancesFromWorks.map((p) => p.id)])
  );

  const performances =
    allPerformanceIds.length > 0
      ? await prisma.performance.findMany({
          where: { id: { in: allPerformanceIds }, archivedAt: null },
          include: {
            venue: true,
            programme: true,
            performers: { include: { artist: true } },
            choirs: { include: { choir: true } },
            conductors: { include: { conductor: true } },
          },
          orderBy: { createdAt: "desc" },
        })
      : [];

  const programmes = dedupeById(performances.map((p) => p.programme));

  // Uses `performances` (already filtered to archivedAt: null), not the
  // raw allPerformanceIds, so an archived Performance's recording can
  // never resurface here even if a stale join-table row still points at it.
  const nonArchivedPerformanceIds = performances.map((p) => p.id);

  const [revisionsFromPerformances, revisionsFromWorks] = await Promise.all([
    nonArchivedPerformanceIds.length > 0
      ? prisma.recordingRevision.findMany({ where: { performanceId: { in: nonArchivedPerformanceIds } }, select: { id: true } })
      : Promise.resolve([]),
    workIds.length > 0
      ? prisma.recordingRevisionWork.findMany({ where: { musicalWorkId: { in: workIds } }, select: { revisionId: true } })
      : Promise.resolve([]),
  ]);

  const candidateRevisionIds = Array.from(
    new Set([...revisionsFromPerformances.map((r) => r.id), ...revisionsFromWorks.map((r) => r.revisionId)])
  );

  // A Recording only counts as "canonically related" for public purposes
  // once it is itself published AND that specific candidate revision is
  // the one currently live — a superseded or draft revision's old
  // performance/work links must not resurrect a relationship the
  // catalogue has since moved away from. The where-clause below is a
  // cheap coarse filter; isRecordingPublished (modules/mmke/catalogue,
  // Phase 6G-5A) is the single authoritative predicate for "is this
  // Recording public" — recordingRepository.ts's
  // findPublishedRecordingBySlug now defers to the exact same function,
  // so the two can no longer independently drift apart the way they did
  // before 6G-5A (that predicate used to only check
  // currentPublishedRevisionId, which an ARCHIVED Recording still
  // satisfies).
  const recordings =
    candidateRevisionIds.length > 0
      ? ((
          await prisma.recording.findMany({
            where: { status: "PUBLISHED", currentPublishedRevisionId: { in: candidateRevisionIds } },
            include: { currentPublishedRevision: true },
            orderBy: { createdAt: "desc" },
          })
        ).filter((r) => isRecordingPublished(r)) as RecordingWithPublishedRevision[])
      : [];

  const recordingIds = recordings.map((r) => r.id);
  const publishedRevisionIds = recordings.map((r) => r.currentPublishedRevisionId as string);

  const mediaResources =
    publishedRevisionIds.length > 0
      ? await prisma.mediaResource.findMany({
          where: { recordingRevisionId: { in: publishedRevisionIds }, provider: "YOUTUBE", youtubeVideoId: { not: null } },
          orderBy: { createdAt: "asc" },
        })
      : [];

  const candidateYouTubeVideoIds = Array.from(
    new Set(mediaResources.map((m) => m.youtubeVideoId).filter((id): id is string => id !== null))
  );

  const publicVideoPages = await findPublicVideoPagesByYouTubeVideoIds(candidateYouTubeVideoIds);
  const videos = dedupeById(publicVideoPages.map((result) => ({ id: result.youtubeVideo.id, ...result })));

  const [collectionIdsFromRecordings, collectionIdsFromWorks] = await Promise.all([
    recordingIds.length > 0
      ? prisma.collectionRecording.findMany({ where: { recordingId: { in: recordingIds } }, select: { collectionId: true } })
      : Promise.resolve([]),
    workIds.length > 0
      ? prisma.collectionWork.findMany({ where: { musicalWorkId: { in: workIds } }, select: { collectionId: true } })
      : Promise.resolve([]),
  ]);

  const candidateCollectionIds = Array.from(
    new Set([...collectionIdsFromRecordings.map((c) => c.collectionId), ...collectionIdsFromWorks.map((c) => c.collectionId)])
  );

  const collections = await findPublicCollectionsByIds(candidateCollectionIds);

  return { performances, programmes, recordings, videos, collections };
}

export interface ComposerRelatedContent extends RelatedContent {
  works: MusicalWork[];
}

export async function getComposerRelatedContent(composerId: string): Promise<ComposerRelatedContent> {
  const works = await listMusicalWorksByComposer(composerId);
  const content = await resolveRelatedContent({ workIds: works.map((w) => w.id) });
  return { works, ...content };
}

export async function getChoirRelatedContent(choirId: string): Promise<RelatedContent> {
  const links = await prisma.performanceChoir.findMany({ where: { choirId }, select: { performanceId: true } });
  return resolveRelatedContent({ performanceIds: links.map((l) => l.performanceId) });
}

export async function getConductorRelatedContent(conductorId: string): Promise<RelatedContent> {
  const links = await prisma.performanceConductor.findMany({ where: { conductorId }, select: { performanceId: true } });
  return resolveRelatedContent({ performanceIds: links.map((l) => l.performanceId) });
}

export async function getArtistRelatedContent(artistId: string): Promise<RelatedContent> {
  const links = await prisma.performancePerformer.findMany({ where: { artistId }, select: { performanceId: true } });
  return resolveRelatedContent({ performanceIds: links.map((l) => l.performanceId) });
}

export async function getVenueRelatedContent(venueId: string): Promise<RelatedContent> {
  const performances = await prisma.performance.findMany({ where: { venueId, archivedAt: null }, select: { id: true } });
  return resolveRelatedContent({ performanceIds: performances.map((p) => p.id) });
}

// ---------------------------------------------------------------------------
// Entity-page data contract assembly (brief §11) — two concrete instances
// (Composer, which has `works`, and Venue, which does not) proving the
// same reusable resolveRelatedContent + assembleEntityPageData pipeline
// serves different entity shapes without a separate implementation per
// type. Not wired to any route in this phase (brief §20) — proven by the
// integration tests instead.
// ---------------------------------------------------------------------------

export async function getComposerEntityPageData(slug: string): Promise<EntityPageData | null> {
  const composer = await prisma.composer.findUnique({ where: { slug } });
  if (!composer || composer.archivedAt !== null) return null;

  const content = await getComposerRelatedContent(composer.id);

  return assembleEntityPageData({
    entityType: "composer",
    id: composer.id,
    slug: composer.slug,
    name: composer.name,
    description: composer.biography,
    lifespan: { bornDate: composer.bornDate, diedDate: composer.diedDate, era: composer.era },
    works: content.works,
    programmes: content.programmes,
    performances: content.performances,
    recordings: content.recordings,
    videos: content.videos,
    collections: content.collections,
  });
}

export async function getVenueEntityPageData(slug: string): Promise<EntityPageData | null> {
  const venue = await prisma.venue.findUnique({ where: { slug } });
  if (!venue || venue.archivedAt !== null) return null;

  const content = await getVenueRelatedContent(venue.id);

  return assembleEntityPageData({
    entityType: "venue",
    id: venue.id,
    slug: venue.slug,
    name: venue.name,
    // Venue has no biography/description-equivalent field today — null,
    // never repurposing an unrelated column (e.g. acousticProfile) to
    // fake one.
    description: null,
    lifespan: null,
    works: null,
    programmes: content.programmes,
    performances: content.performances,
    recordings: content.recordings,
    videos: content.videos,
    collections: content.collections,
  });
}
