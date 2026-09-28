import { prisma } from "../client";
import { dedupeById } from "../../mmke/relationships/formatComposerCredit";
import { findPublicVideoPagesByYouTubeVideoIds } from "./youtubeVideoPageRepository";
import { findPublicCollectionsByIds } from "./collectionRepository";
import { listMusicalWorksByComposer } from "./musicalWorkRepository";
import { assembleEntityPageData } from "../../mmke/entityPage/assembleEntityPageData";
import { isRecordingPublished } from "../../mmke/catalogue/isRecordingPublished";
import { getPublishedRecordingContextBySlug } from "./recordingRepository";
import { assembleRecordingPageData } from "../../mmke/recordingPage/assembleRecordingPageData";
import type { RecordingPageData } from "../../mmke/recordingPage/recordingPageContract";
import { assembleWorkPageData } from "../../mmke/workPage/assembleWorkPageData";
import type { WorkPageData } from "../../mmke/workPage/workPageContract";
import { assembleProgrammePageData } from "../../mmke/programmePage/assembleProgrammePageData";
import type { ProgrammePageData } from "../../mmke/programmePage/programmePageContract";
import { assemblePerformancePageData } from "../../mmke/performancePage/assemblePerformancePageData";
import type { PerformancePageData } from "../../mmke/performancePage/performancePageContract";
import { assembleCollectionPageData } from "../../mmke/collectionPage/assembleCollectionPageData";
import type { CollectionPageData } from "../../mmke/collectionPage/collectionPageContract";
import { assembleOrganisationPageData } from "../../mmke/organisationPage/assembleOrganisationPageData";
import type { OrganisationPageData } from "../../mmke/organisationPage/organisationPageContract";
import { listOccasionsForEntity } from "./occasionRepository";
import { listSourcesForEntity } from "./sourceRepository";
import { listRightsForEntity } from "./rightsInformationRepository";
import type {
  Artist,
  Choir,
  Collection,
  Composer,
  Conductor,
  MusicalWork,
  Performance,
  PerformanceChoir,
  PerformanceConductor,
  PerformancePerformer,
  Programme,
  ProgrammeItem,
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
  // Phase 6G-6: widened from a flat Programme to include its ordered items
  // + each item's MusicalWork + Composer — the Venue page needs "works
  // performed here" / "composers performed here," derived from these
  // performances rather than a second query (brief: "do not reinvent the
  // existing relationship resolver"). Composer/Choir/Conductor/Artist
  // callers below simply don't read the extra nesting.
  programme: Programme & { items: (ProgrammeItem & { musicalWork: MusicalWork & { composer: Composer } })[] };
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
            programme: { include: { items: { include: { musicalWork: { include: { composer: true } } }, orderBy: { order: "asc" } } } },
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
    venueDetails: null,
    works: content.works,
    composers: null,
    programmes: content.programmes,
    performances: content.performances,
    recordings: content.recordings,
    videos: content.videos,
    collections: content.collections,
  });
}

export async function getVenueEntityPageData(slug: string): Promise<EntityPageData | null> {
  const venue = await prisma.venue.findUnique({ where: { slug }, include: { organisation: true } });
  if (!venue || venue.archivedAt !== null) return null;

  const content = await getVenueRelatedContent(venue.id);

  // Phase 6G-6: "works performed here" / "composers performed here" are
  // derived from this venue's own performances' programme items — never a
  // separate query, per PerformanceWithVenueAndProgramme's widened shape
  // above. Deduped since the same work/composer can recur across many
  // performances at the same venue.
  const worksPerformedHere = dedupeById(content.performances.flatMap((p) => p.programme.items.map((item) => item.musicalWork)));
  const composersPerformedHere = dedupeById(worksPerformedHere.map((work) => work.composer));

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
    venueDetails: {
      type: venue.type,
      address: venue.address,
      city: venue.city,
      country: venue.country,
      organisation: venue.organisation ? { id: venue.organisation.id, slug: venue.organisation.slug, name: venue.organisation.name } : null,
    },
    works: worksPerformedHere.map((work) => ({ id: work.id, slug: work.slug, title: work.title })),
    composers: composersPerformedHere.map((composer) => ({ id: composer.id, slug: composer.slug, name: composer.name })),
    programmes: content.programmes,
    performances: content.performances,
    recordings: content.recordings,
    videos: content.videos,
    collections: content.collections,
  });
}

// ---------------------------------------------------------------------------
// Phase 6G-6 — MusicalWork gets its own bespoke assembly (WorkPageData),
// not a third EntityType, for the same reason Recording did in 6G-5B: a
// Work has one canonical Composer plus its own scalar catalogue fields
// (alternateTitles, catalogueNumber, keySignature, language, notes) that
// don't fit EntityPageData's generic "related items" shape. The
// relationship graph itself is still resolveRelatedContent, unchanged —
// never a second traversal implementation.
// ---------------------------------------------------------------------------

/**
 * The public /works/[slug] page's sole data source. Returns null for a
 * nonexistent or archived Work (never distinguishes the two, same
 * convention as every other public entity-page function above).
 */
export async function getPublicWorkPageData(slug: string): Promise<WorkPageData | null> {
  const work = await prisma.musicalWork.findUnique({ where: { slug }, include: { composer: true } });
  if (!work || work.archivedAt !== null) return null;

  const content = await resolveRelatedContent({ workIds: [work.id] });

  return assembleWorkPageData({
    id: work.id,
    slug: work.slug,
    title: work.title,
    alternateTitles: work.alternateTitles,
    language: work.language,
    notes: work.notes,
    catalogueNumber: work.catalogueNumber,
    keySignature: work.keySignature,
    composer: { id: work.composer.id, slug: work.composer.slug, name: work.composer.name },
    programmes: content.programmes,
    performances: content.performances,
    recordings: content.recordings,
    videos: content.videos,
    collections: content.collections,
  });
}

// ---------------------------------------------------------------------------
// Phase 6G-9 — Artist/Choir/Conductor get real public entity pages,
// completing the participant side of the archive graph. These reuse the
// generic EntityPageData contract exactly like Composer/Venue (their
// shape — one canonical identity + several typed related-lists — fits
// cleanly, unlike Work/Recording/Programme/Performance's stronger own
// identity). getArtistRelatedContent/getChoirRelatedContent/
// getConductorRelatedContent already existed (used since 6G-4A to derive
// OTHER entities' "related participants" sections) — this is the first
// time they're used as a page's own root subject.
// ---------------------------------------------------------------------------

export async function getArtistEntityPageData(slug: string): Promise<EntityPageData | null> {
  const artist = await prisma.artist.findUnique({ where: { slug } });
  if (!artist || artist.archivedAt !== null) return null;

  const content = await getArtistRelatedContent(artist.id);

  return assembleEntityPageData({
    entityType: "artist",
    id: artist.id,
    slug: artist.slug,
    name: artist.name,
    description: artist.biography,
    lifespan: null,
    venueDetails: null,
    secondaryDetail: artist.instrument,
    works: null,
    composers: null,
    programmes: content.programmes,
    performances: content.performances,
    recordings: content.recordings,
    videos: content.videos,
    collections: content.collections,
  });
}

export async function getChoirEntityPageData(slug: string): Promise<EntityPageData | null> {
  const choir = await prisma.choir.findUnique({ where: { slug } });
  if (!choir || choir.archivedAt !== null) return null;

  const content = await getChoirRelatedContent(choir.id);

  return assembleEntityPageData({
    entityType: "choir",
    id: choir.id,
    slug: choir.slug,
    name: choir.name,
    description: choir.description,
    lifespan: null,
    venueDetails: null,
    secondaryDetail: choir.directorName,
    works: null,
    composers: null,
    programmes: content.programmes,
    performances: content.performances,
    recordings: content.recordings,
    videos: content.videos,
    collections: content.collections,
  });
}

export async function getConductorEntityPageData(slug: string): Promise<EntityPageData | null> {
  const conductor = await prisma.conductor.findUnique({ where: { slug } });
  if (!conductor || conductor.archivedAt !== null) return null;

  const content = await getConductorRelatedContent(conductor.id);

  return assembleEntityPageData({
    entityType: "conductor",
    id: conductor.id,
    slug: conductor.slug,
    name: conductor.name,
    description: conductor.biography,
    lifespan: null,
    venueDetails: null,
    secondaryDetail: null,
    works: null,
    composers: null,
    programmes: content.programmes,
    performances: content.performances,
    recordings: content.recordings,
    videos: content.videos,
    collections: content.collections,
  });
}

// ---------------------------------------------------------------------------
// Phase 6G-8 — Programme gets its own bespoke assembly (ProgrammePageData),
// for the same reason Work did in 6G-6: a Programme has its own strong
// identity (an ordered list of works/movements/encores) that doesn't fit
// EntityPageData's generic "related items" shape. The relationship graph
// itself is still resolveRelatedContent, scoped to this one Programme's
// own (non-archived) performances — never a second traversal
// implementation.
// ---------------------------------------------------------------------------

/**
 * The public /programmes/[slug] page's sole data source. Returns null for
 * a nonexistent or archived Programme (never distinguishes the two, same
 * convention as every other public entity-page function in this file).
 */
export async function getPublicProgrammePageData(slug: string): Promise<ProgrammePageData | null> {
  const programme = await prisma.programme.findUnique({
    where: { slug },
    include: {
      items: {
        include: { musicalWork: { include: { composer: true } } },
        orderBy: { order: "asc" },
      },
    },
  });
  if (!programme || programme.archivedAt !== null) return null;

  const performanceRows = await prisma.performance.findMany({
    where: { programmeId: programme.id, archivedAt: null },
    select: { id: true },
  });

  const content = await resolveRelatedContent({ performanceIds: performanceRows.map((p) => p.id) });

  return assembleProgrammePageData({
    id: programme.id,
    slug: programme.slug,
    title: programme.title,
    notes: programme.notes,
    items: programme.items,
    performances: content.performances,
    recordings: content.recordings,
    videos: content.videos,
    collections: content.collections,
  });
}

// ---------------------------------------------------------------------------
// Phase 6G-8 — Performance gets its own bespoke assembly
// (PerformancePageData), for the same reason Recording did in 6G-5B: a
// Performance is built around ONE canonical Programme + Venue + its own
// participants, not a list of "related" items. Recording/video/collection
// resolution still defers to the shared resolveRelatedContent core,
// scoped to this one Performance's own id — never a second traversal
// implementation.
// ---------------------------------------------------------------------------

/**
 * The public /performances/[slug] page's sole data source. Returns null
 * for a nonexistent or archived Performance (never distinguishes the two,
 * same convention as every other public entity-page function in this
 * file).
 */
export async function getPublicPerformancePageData(slug: string): Promise<PerformancePageData | null> {
  const performance = await prisma.performance.findUnique({
    where: { slug },
    include: {
      programme: {
        include: { items: { include: { musicalWork: { include: { composer: true } } }, orderBy: { order: "asc" } } },
      },
      venue: { include: { organisation: true } },
      performers: { include: { artist: true } },
      choirs: { include: { choir: true } },
      conductors: { include: { conductor: true } },
    },
  });
  if (!performance || performance.archivedAt !== null) return null;

  const content = await resolveRelatedContent({ performanceIds: [performance.id] });

  return assemblePerformancePageData({
    id: performance.id,
    slug: performance.slug,
    performanceDate: performance.performanceDate,
    programme: performance.programme,
    venue: {
      id: performance.venue.id,
      slug: performance.venue.slug,
      name: performance.venue.name,
      organisation: performance.venue.organisation
        ? { id: performance.venue.organisation.id, slug: performance.venue.organisation.slug, name: performance.venue.organisation.name }
        : null,
    },
    performers: performance.performers,
    choirs: performance.choirs,
    conductors: performance.conductors,
    recordings: content.recordings,
    videos: content.videos,
    collections: content.collections,
  });
}

// ---------------------------------------------------------------------------
// Phase 6G-5B — the first non-"related content" public entity page: a
// Recording page is built around ONE published revision's own canonical
// content, not a list of related items, so it gets its own dedicated
// assembly (RecordingPageData, assembleRecordingPageData) rather than a
// third instance of the EntityPageData contract above. Public-visibility
// filtering for media and collections reuses the exact same sanctioned
// gates every other public page already uses — never a new predicate.
// ---------------------------------------------------------------------------

/**
 * The public /recordings/[slug] page's sole data source. Returns null for
 * a nonexistent, unpublished, or archived Recording (never distinguishes
 * "doesn't exist" from "isn't public" — same as getComposerEntityPageData/
 * getVenueEntityPageData above, so the route can render a real 404
 * either way).
 */
export async function getPublicRecordingPageData(slug: string): Promise<RecordingPageData | null> {
  const context = await getPublishedRecordingContextBySlug(slug);
  if (!context) return null;

  const { recording, revision } = context;

  const candidateYouTubeVideoIds = Array.from(
    new Set(
      revision.mediaResources
        .filter((media) => media.provider === "YOUTUBE" && media.youtubeVideoId !== null)
        .map((media) => media.youtubeVideoId as string)
    )
  );
  const publicVideoPages = await findPublicVideoPagesByYouTubeVideoIds(candidateYouTubeVideoIds);
  const videos = dedupeById(publicVideoPages.map((result) => ({ id: result.youtubeVideo.id, ...result })));

  const collectionLinks = await prisma.collectionRecording.findMany({
    where: { recordingId: recording.id },
    select: { collectionId: true },
  });
  const collections = await findPublicCollectionsByIds(collectionLinks.map((link) => link.collectionId));

  return assembleRecordingPageData({
    id: recording.id,
    slug: recording.slug,
    title: revision.title,
    description: revision.description,
    seoMetaTitle: revision.seoMetaTitle,
    seoMetaDescription: revision.seoMetaDescription,
    seoCanonicalPath: revision.seoCanonicalPath,
    educationalDifficultyLevel: revision.educationalDifficultyLevel,
    educationalListeningGuide: revision.educationalListeningGuide,
    educationalAnalysis: revision.educationalAnalysis,
    works: revision.works.map((link) => ({
      id: link.musicalWork.id,
      slug: link.musicalWork.slug,
      title: link.musicalWork.title,
      composer: { id: link.musicalWork.composer.id, slug: link.musicalWork.composer.slug, name: link.musicalWork.composer.name },
    })),
    programme: revision.performance?.programme
      ? {
          id: revision.performance.programme.id,
          slug: revision.performance.programme.slug,
          title: revision.performance.programme.title,
          items: revision.performance.programme.items,
        }
      : null,
    performance: revision.performance
      ? {
          id: revision.performance.id,
          slug: revision.performance.slug,
          performanceDate: revision.performance.performanceDate,
          venue: revision.performance.venue
            ? {
                id: revision.performance.venue.id,
                slug: revision.performance.venue.slug,
                name: revision.performance.venue.name,
                organisation: revision.performance.venue.organisation,
              }
            : null,
          performers: revision.performance.performers,
          choirs: revision.performance.choirs,
          conductors: revision.performance.conductors,
        }
      : null,
    videos,
    collections,
  });
}

// ---------------------------------------------------------------------------
// Phase 6G-10 — Collection gets its own bespoke assembly (CollectionPageData),
// for the same reason Programme/Performance/Recording did: a Collection is
// built around its own canonical, editorially-ordered membership
// (CollectionRecording/CollectionWork), never reached via a Performance —
// so resolveRelatedContent's Performance-rooted traversal has no entry
// point for it. This is the first Collection-rooted traversal in the
// codebase; every other place Collection appears (Composer, Venue, Work,
// Programme, Performance, Artist, Choir, Conductor, Recording pages) only
// ever reaches it as a *leaf* via findPublicCollectionsByIds. Recording
// visibility within a Collection is re-checked independently via
// isRecordingPublished (never a second predicate) — a Recording being
// linked to a published Collection does not itself make the Recording
// public, and vice versa.
// ---------------------------------------------------------------------------

/**
 * The public /collections/[slug] page's sole data source. Returns null
 * for a nonexistent, unpublished, or archived Collection (never
 * distinguishes the three, same convention as every other public
 * entity-page function in this file).
 */
export async function getPublicCollectionPageData(slug: string): Promise<CollectionPageData | null> {
  const collection = await prisma.collection.findUnique({
    where: { slug },
    include: {
      recordingLinks: {
        orderBy: { order: "asc" },
        include: {
          recording: {
            include: {
              currentPublishedRevision: {
                include: {
                  works: { include: { musicalWork: { include: { composer: true } } } },
                  mediaResources: true,
                  performance: {
                    include: {
                      programme: true,
                      venue: true,
                      performers: { include: { artist: true } },
                      choirs: { include: { choir: true } },
                      conductors: { include: { conductor: true } },
                    },
                  },
                },
              },
            },
          },
        },
      },
      workLinks: {
        orderBy: { order: "asc" },
        include: { musicalWork: { include: { composer: true } } },
      },
    },
  });

  if (!collection || collection.status !== "PUBLISHED" || collection.archivedAt !== null) return null;

  const publishedRecordingLinks = collection.recordingLinks.filter(
    (link) => link.recording.currentPublishedRevision !== null && isRecordingPublished(link.recording)
  );

  // Archived Works are never publicly shown, same convention as every
  // other public page's catalogue-visibility rule.
  const activeWorkLinks = collection.workLinks.filter((link) => link.musicalWork.archivedAt === null);

  const candidateYouTubeVideoIds = Array.from(
    new Set(
      publishedRecordingLinks.flatMap((link) =>
        (link.recording.currentPublishedRevision?.mediaResources ?? [])
          .filter((media) => media.provider === "YOUTUBE" && media.youtubeVideoId !== null)
          .map((media) => media.youtubeVideoId as string)
      )
    )
  );
  const publicVideoPages = await findPublicVideoPagesByYouTubeVideoIds(candidateYouTubeVideoIds);
  const videos = dedupeById(publicVideoPages.map((result) => ({ id: result.youtubeVideo.id, ...result })));

  return assembleCollectionPageData({
    id: collection.id,
    slug: collection.slug,
    title: collection.title,
    description: collection.description,
    recordings: publishedRecordingLinks.map((link) => {
      const revision = link.recording.currentPublishedRevision!;
      return {
        id: link.recording.id,
        slug: link.recording.slug,
        title: revision.title,
        order: link.order,
        performance: revision.performance
          ? {
              id: revision.performance.id,
              slug: revision.performance.slug,
              performanceDate: revision.performance.performanceDate,
              programme: revision.performance.programme
                ? {
                    id: revision.performance.programme.id,
                    slug: revision.performance.programme.slug,
                    title: revision.performance.programme.title,
                  }
                : null,
              venue: revision.performance.venue
                ? { id: revision.performance.venue.id, slug: revision.performance.venue.slug, name: revision.performance.venue.name }
                : null,
              performers: revision.performance.performers,
              choirs: revision.performance.choirs,
              conductors: revision.performance.conductors,
            }
          : null,
        works: revision.works.map((link) => link.musicalWork),
      };
    }),
    works: activeWorkLinks.map((link) => ({ order: link.order, musicalWork: link.musicalWork })),
    videos,
  });
}

// ---------------------------------------------------------------------------
// Phase 6G-14 — Organisation gets its own bespoke root-resolver, mirroring
// Collection/Recording/Work/Programme/Performance: Organisation's shape
// (a direct list of its own Venues, plus content derived transitively
// through those venues' Performances) doesn't fit the generic
// EntityPageData contract, which has no slot for "my own Venues" as a
// top-level list. The ONLY canonical relationship Organisation has is
// Venue.organisationId (confirmed in the Phase 6G-14 preflight) — every
// other section here is derived by walking Organisation -> Venue ->
// Performance -> Programme/Recording/Collection, reusing the exact same
// resolveRelatedContent core every other entity page already uses, never
// a second, independently-invented traversal.
// ---------------------------------------------------------------------------

export async function getPublicOrganisationPageData(slug: string): Promise<OrganisationPageData | null> {
  const organisation = await prisma.organisation.findUnique({
    where: { slug },
    include: { venues: { where: { archivedAt: null }, orderBy: { name: "asc" } } },
  });
  if (!organisation || organisation.archivedAt !== null) return null;

  const venueIds = organisation.venues.map((v) => v.id);
  const performanceRows =
    venueIds.length > 0
      ? await prisma.performance.findMany({ where: { venueId: { in: venueIds }, archivedAt: null }, select: { id: true } })
      : [];

  const content = await resolveRelatedContent({ performanceIds: performanceRows.map((p) => p.id) });

  // Occasions: aggregated across this Organisation's own derived
  // Performances/Programmes/Recordings/Collections' existing
  // EntityOccasion attachments (Phase 6G-12) — never a direct
  // Organisation-level attachment, which does not exist. Only active
  // (non-archived) Occasions are surfaced publicly, the same convention
  // every other public page already applies to its own entities.
  const occasionLinkLists = await Promise.all([
    ...content.performances.map((p) => listOccasionsForEntity("PERFORMANCE", p.id)),
    ...content.programmes.map((p) => listOccasionsForEntity("PROGRAMME", p.id)),
    ...content.recordings.map((r) => listOccasionsForEntity("RECORDING", r.id)),
    ...content.collections.map((c) => listOccasionsForEntity("COLLECTION", c.id)),
  ]);
  const occasions = dedupeById(occasionLinkLists.flat().map((link) => link.occasion))
    .filter((occasion) => occasion.archivedAt === null)
    .map((occasion) => ({ id: occasion.id, name: occasion.name }));

  // Sources / Rights Information: aggregated across this Organisation's
  // own derived Recordings' existing EntitySource/EntityRights
  // attachments (Phase 6G-13 — Recording is a supported provenance entity
  // type; Organisation itself is not, and no direct Organisation-level
  // attachment is added here).
  const [sourceLinkLists, rightsLinkLists] = await Promise.all([
    Promise.all(content.recordings.map((r) => listSourcesForEntity("RECORDING", r.id))),
    Promise.all(content.recordings.map((r) => listRightsForEntity("RECORDING", r.id))),
  ]);
  const sources = dedupeById(sourceLinkLists.flat().map((link) => link.source)).map((source) => ({
    id: source.id,
    title: source.title,
    url: source.url,
    publisher: source.publisher,
  }));
  const rights = dedupeById(rightsLinkLists.flat().map((link) => link.rightsInformation)).map((rightsInformation) => ({
    id: rightsInformation.id,
    holder: rightsInformation.holder,
    licenseType: rightsInformation.licenseType,
  }));

  return assembleOrganisationPageData({
    id: organisation.id,
    slug: organisation.slug,
    name: organisation.name,
    description: organisation.description,
    venues: organisation.venues.map((venue) => ({ id: venue.id, slug: venue.slug, name: venue.name })),
    programmes: content.programmes,
    performances: content.performances,
    recordings: content.recordings,
    videos: content.videos,
    collections: content.collections,
    occasions,
    sources,
    rights,
  });
}
