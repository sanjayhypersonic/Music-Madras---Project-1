import { prisma } from "../client";
import { dedupeById } from "../../mmke/relationships/formatComposerCredit";
import { findPublicVideoPagesByYouTubeVideoIds } from "./youtubeVideoPageRepository";
import { findPublicCollectionsByIds } from "./collectionRepository";
import {
  RECORDING_NOT_HELD_WHERE,
  eligibleArtistWhere,
  eligibleChoirWhere,
  eligibleComposerWhere,
  eligibleConductorWhere,
  eligibleOrganisationWhere,
  eligiblePerformanceWhere,
  eligibleProgrammeWhere,
  eligibleVenueWhere,
  eligibleWorkWhere,
  isActivePerformance,
  isActiveRef,
  isActiveWork,
} from "./publicEligibility";
import { assembleEntityPageData } from "../../mmke/entityPage/assembleEntityPageData";
import { isRecordingPubliclyVisible } from "../../mmke/catalogue/isRecordingPublished";
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
import { loadPublishedRecordingRelationships } from "./recordingRelationshipReadersRepository";
import { recordOperationalIncidentSafely } from "./operationalIncidentRepository";

/** A technical bound: how many inconsistent Recordings one page build records as incidents (all of them are still logged and omitted). */
const MAX_INCIDENTS_PER_PAGE_BUILD = 25;
import { listPublicLearningGuidesForRecording, listPublicLearningGuidesForWorkIds } from "./learningGuideRepository";
import { assembleLearningGuidePageData } from "../../mmke/learningGuidePage/assembleLearningGuidePageData";
import type { LearningGuidePageData } from "../../mmke/learningGuidePage/learningGuidePageContract";
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
/**
 * Phase 6J-1: the Performance as the public may see it. A Performance reaches
 * here only if it is ELIGIBLE (publicEligibility.ts), so its own Programme and
 * Venue are active; this drops the archived parts of what hangs off it —
 * archived participants and programme items for archived Works/Composers — so
 * a public page never renders a link to an entity whose own page would 404.
 */
function toPublicPerformance<T extends PerformanceWithVenueAndProgramme>(performance: T): T {
  return {
    ...performance,
    programme: { ...performance.programme, items: performance.programme.items.filter((item) => isActiveWork(item.musicalWork)) },
    performers: performance.performers.filter((link) => isActiveRef(link.artist)),
    choirs: performance.choirs.filter((link) => isActiveRef(link.choir)),
    conductors: performance.conductors.filter((link) => isActiveRef(link.conductor)),
  };
}

export async function resolveRelatedContent(input: RelatedContentInput): Promise<RelatedContent> {
  const explicitPerformanceIds = input.performanceIds ?? [];
  const workIds = input.workIds ?? [];

  // Phase 6J-1: only ELIGIBLE Performances (reachable from a published
  // Recording) are ever related publicly — a draft-only Performance, an
  // orphan fixture, or one whose Programme/Venue is archived never resurfaces.
  const performancesFromWorks =
    workIds.length > 0
      ? await prisma.performance.findMany({
          where: { AND: [eligiblePerformanceWhere, { programme: { items: { some: { musicalWorkId: { in: workIds } } } } }] },
          select: { id: true },
        })
      : [];

  const allPerformanceIds = Array.from(
    new Set([...explicitPerformanceIds, ...performancesFromWorks.map((p) => p.id)])
  );

  const performances = (
    allPerformanceIds.length > 0
      ? await prisma.performance.findMany({
          where: { AND: [{ id: { in: allPerformanceIds } }, eligiblePerformanceWhere] },
          include: {
            venue: true,
            programme: { include: { items: { include: { musicalWork: { include: { composer: true } } }, orderBy: { order: "asc" } } } },
            performers: { include: { artist: true } },
            choirs: { include: { choir: true } },
            conductors: { include: { conductor: true } },
          },
          orderBy: { createdAt: "desc" },
        })
      : []
  ).map(toPublicPerformance);

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
            where: { status: "PUBLISHED", ...RECORDING_NOT_HELD_WHERE, currentPublishedRevisionId: { in: candidateRevisionIds } },
            include: { currentPublishedRevision: true },
            orderBy: { createdAt: "desc" },
          })
        ).filter((r) => isRecordingPubliclyVisible(r)) as RecordingWithPublishedRevision[])
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
  // Phase 6J-1: only the composer's publicly ELIGIBLE works are listed (and so
  // linked) — never an archived work, or one no published content reaches.
  const works = await prisma.musicalWork.findMany({
    where: { AND: [{ composerId }, eligibleWorkWhere] },
    orderBy: { title: "asc" },
  });
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
  const performances = await prisma.performance.findMany({ where: { AND: [{ venueId }, eligiblePerformanceWhere] }, select: { id: true } });
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
  // Phase 6J-1: a Composer is public only while eligible (an active work that
  // published content reaches) — see publicEligibility.ts.
  const composer = await prisma.composer.findFirst({ where: { AND: [{ slug }, eligibleComposerWhere] } });
  if (!composer) return null;

  const content = await getComposerRelatedContent(composer.id);

  // Phase 6G-17: reverse discovery via Composer -> MusicalWork -> LearningGuide
  // only — never resolveRelatedContent (which many other entity types also
  // use; extending it there would leak LearningGuides onto pages the brief
  // never asked for).
  const learningGuides = await listPublicLearningGuidesForWorkIds(content.works.map((w) => w.id));

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
    learningGuides: learningGuides.map((g) => ({ id: g.id, slug: g.slug, title: g.title })),
  });
}

export async function getVenueEntityPageData(slug: string): Promise<EntityPageData | null> {
  const venue = await prisma.venue.findFirst({ where: { AND: [{ slug }, eligibleVenueWhere] }, include: { organisation: true } });
  if (!venue) return null;
  // An archived Organisation is not linked (its own page would 404).
  const venueOrganisation = venue.organisation && isActiveRef(venue.organisation) ? venue.organisation : null;

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
      organisation: venueOrganisation ? { id: venueOrganisation.id, slug: venueOrganisation.slug, name: venueOrganisation.name } : null,
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
  const work = await prisma.musicalWork.findFirst({ where: { AND: [{ slug }, eligibleWorkWhere] }, include: { composer: true } });
  if (!work) return null;

  const content = await resolveRelatedContent({ workIds: [work.id] });
  const learningGuides = await listPublicLearningGuidesForWorkIds([work.id]);

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
    learningGuides: learningGuides.map((g) => ({ id: g.id, slug: g.slug, title: g.title })),
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
  const artist = await prisma.artist.findFirst({ where: { AND: [{ slug }, eligibleArtistWhere] } });
  if (!artist) return null;

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
  const choir = await prisma.choir.findFirst({ where: { AND: [{ slug }, eligibleChoirWhere] } });
  if (!choir) return null;

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
  const conductor = await prisma.conductor.findFirst({ where: { AND: [{ slug }, eligibleConductorWhere] } });
  if (!conductor) return null;

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
  const programme = await prisma.programme.findFirst({
    where: { AND: [{ slug }, eligibleProgrammeWhere] },
    include: {
      items: {
        include: { musicalWork: { include: { composer: true } } },
        orderBy: { order: "asc" },
      },
    },
  });
  if (!programme) return null;
  // Items for an archived Work (or Composer) are omitted, never linked to a 404.
  const activeItems = programme.items.filter((item) => isActiveWork(item.musicalWork));

  const performanceRows = await prisma.performance.findMany({
    where: { AND: [{ programmeId: programme.id }, eligiblePerformanceWhere] },
    select: { id: true },
  });

  const content = await resolveRelatedContent({ performanceIds: performanceRows.map((p) => p.id) });

  return assembleProgrammePageData({
    id: programme.id,
    slug: programme.slug,
    title: programme.title,
    notes: programme.notes,
    items: activeItems,
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
  const found = await prisma.performance.findFirst({
    where: { AND: [{ slug }, eligiblePerformanceWhere] },
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
  if (!found) return null;
  // Archived participants / programme items / organisation are omitted, never linked to a 404.
  const performance = toPublicPerformance(found);
  const organisation = found.venue.organisation && isActiveRef(found.venue.organisation) ? found.venue.organisation : null;

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
      organisation: organisation ? { id: organisation.id, slug: organisation.slug, name: organisation.name } : null,
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
  const learningGuides = await listPublicLearningGuidesForRecording(recording.id);

  // Phase 6J-1: this Recording is published, so what it references is
  // eligible by construction — except an entity archived since. Those are
  // omitted (never linked to a page that would 404): archived Works/Composers,
  // an archived Performance/Programme/Venue (the whole performance block goes),
  // archived participants, and an archived Organisation.
  const publicPerformance = revision.performance && isActivePerformance(revision.performance) ? revision.performance : null;

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
    works: revision.works
      .filter((link) => isActiveWork(link.musicalWork))
      .map((link) => ({
        id: link.musicalWork.id,
        slug: link.musicalWork.slug,
        title: link.musicalWork.title,
        composer: { id: link.musicalWork.composer.id, slug: link.musicalWork.composer.slug, name: link.musicalWork.composer.name },
      })),
    programme: publicPerformance
      ? {
          id: publicPerformance.programme.id,
          slug: publicPerformance.programme.slug,
          title: publicPerformance.programme.title,
          items: publicPerformance.programme.items.filter((item) => isActiveWork(item.musicalWork)),
        }
      : null,
    performance: publicPerformance
      ? {
          id: publicPerformance.id,
          slug: publicPerformance.slug,
          performanceDate: publicPerformance.performanceDate,
          venue: {
            id: publicPerformance.venue.id,
            slug: publicPerformance.venue.slug,
            name: publicPerformance.venue.name,
            organisation:
              publicPerformance.venue.organisation && isActiveRef(publicPerformance.venue.organisation) ? publicPerformance.venue.organisation : null,
          },
          performers: publicPerformance.performers.filter((link) => isActiveRef(link.artist)),
          choirs: publicPerformance.choirs.filter((link) => isActiveRef(link.choir)),
          conductors: publicPerformance.conductors.filter((link) => isActiveRef(link.conductor)),
        }
      : null,
    videos,
    collections,
    learningGuides: learningGuides.map((g) => ({ id: g.id, slug: g.slug, title: g.title })),
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
    (link) => link.recording.currentPublishedRevision !== null && isRecordingPubliclyVisible(link.recording)
  );

  // Archived Works (or Works of an archived Composer) are never publicly
  // shown, same convention as every other public page's catalogue-visibility rule.
  const activeWorkLinks = collection.workLinks.filter((link) => isActiveWork(link.musicalWork));

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
      const performance = revision.performance && isActivePerformance(revision.performance) ? revision.performance : null;
      return {
        id: link.recording.id,
        slug: link.recording.slug,
        title: revision.title,
        order: link.order,
        performance: performance
          ? {
              id: performance.id,
              slug: performance.slug,
              performanceDate: performance.performanceDate,
              programme: { id: performance.programme.id, slug: performance.programme.slug, title: performance.programme.title },
              venue: { id: performance.venue.id, slug: performance.venue.slug, name: performance.venue.name },
              performers: performance.performers.filter((p) => isActiveRef(p.artist)),
              choirs: performance.choirs.filter((c) => isActiveRef(c.choir)),
              conductors: performance.conductors.filter((c) => isActiveRef(c.conductor)),
            }
          : null,
        works: revision.works.filter((workLink) => isActiveWork(workLink.musicalWork)).map((workLink) => workLink.musicalWork),
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
  // Phase 6J-1: an Organisation is public only while it operates an eligible
  // Venue, and lists only its eligible Venues.
  const organisation = await prisma.organisation.findFirst({
    where: { AND: [{ slug }, eligibleOrganisationWhere] },
    include: { venues: { where: eligibleVenueWhere, orderBy: { name: "asc" } } },
  });
  if (!organisation) return null;

  const venueIds = organisation.venues.map((v) => v.id);
  const performanceRows =
    venueIds.length > 0
      ? await prisma.performance.findMany({ where: { AND: [{ venueId: { in: venueIds } }, eligiblePerformanceWhere] }, select: { id: true } })
      : [];

  const content = await resolveRelatedContent({ performanceIds: performanceRows.map((p) => p.id) });

  // Occasions: aggregated across this Organisation's own derived
  // Performances/Programmes/Recordings/Collections' existing
  // EntityOccasion attachments (Phase 6G-12) — never a direct
  // Organisation-level attachment, which does not exist. Only active
  // (non-archived) Occasions are surfaced publicly, the same convention
  // every other public page already applies to its own entities.
  // Phase 6L: a Recording's occasions, sources and rights are those of its PUBLISHED REVISION (one verified published version per Recording, read
  // through its pointer), never the legacy Recording-level rows and never a draft. A Recording whose revision data is INCONSISTENT contributes nothing
  // (its unverified links are omitted, and there is no legacy fallback) and is reported on the server log, so one bad Recording cannot take down
  // the whole public page; a Recording that is no longer published when this runs simply contributes nothing either.
  const publishedRecordings = await loadPublishedRecordingRelationships(content.recordings.map((r) => r.id), undefined, { onInconsistent: "omit" });
  for (const problem of publishedRecordings.inconsistent) {
    // Ids and a reason code only: nothing from the data itself. Observable, never silently swallowed.
    console.error(`Organisation page: the sources, rights and occasions of recording ${problem.recordingId} were omitted because its revision data is inconsistent (${problem.reason}).`);
  }
  // Also recorded as a deduplicated operational incident (Studio -> Health, with an administrator notification when it recurs). That is best-effort by
  // design: recordOperationalIncidentSafely never throws, so a failure to persist it can never take this public page down. Bounded per page build.
  await Promise.all(
    publishedRecordings.inconsistent.slice(0, MAX_INCIDENTS_PER_PAGE_BUILD).map((problem) =>
      recordOperationalIncidentSafely({ kind: "ORGANISATION_PAGE_RECORDING_OMITTED", reasonCode: problem.reason, subject: { type: "Recording", id: problem.recordingId } })
    )
  );
  const publishedRecordingSets = [...publishedRecordings.byRecording.values()];
  const occasionLinkLists = await Promise.all([
    ...content.performances.map((p) => listOccasionsForEntity("PERFORMANCE", p.id)),
    ...content.programmes.map((p) => listOccasionsForEntity("PROGRAMME", p.id)),
    ...publishedRecordingSets.map((set) => Promise.resolve(set.occasions)),
    ...content.collections.map((c) => listOccasionsForEntity("COLLECTION", c.id)),
  ]);
  const occasions = dedupeById(occasionLinkLists.flat().map((link) => link.occasion))
    .filter((occasion) => occasion.archivedAt === null)
    .map((occasion) => ({ id: occasion.id, slug: occasion.slug, name: occasion.name }));

  // Sources / Rights Information: aggregated across this Organisation's
  // own derived Recordings' existing EntitySource/EntityRights
  // attachments (Phase 6G-13 — Recording is a supported provenance entity
  // type; Organisation itself is not, and no direct Organisation-level
  // attachment is added here). Phase 6J-1: only APPROVED Sources are public
  // provenance — the same approval rule the AI evidence uses (Phase 6H-8); an
  // unreviewed, rejected or disabled Source is never shown.
  const sourceLinkLists = publishedRecordingSets.map((set) => set.sources.filter((link) => link.source.approvalState === "APPROVED"));
  const rightsLinkLists = publishedRecordingSets.map((set) => set.rights);
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

// ---------------------------------------------------------------------------
// Phase 6G-17 — LearningGuide gets its own bespoke root-resolver, for the
// same reason Collection did: it is never reached through a Performance
// (LearningGuideWork/LearningGuideRecording link directly to MusicalWork/
// Recording), so resolveRelatedContent's Performance-rooted traversal has
// no entry point for it. Programme/Performance/Venue/participant context
// is surfaced per-Recording, where it genuinely exists, rather than as an
// invented top-level LearningGuide relationship — mirrors
// getPublicCollectionPageData's own recording `context` shape exactly.
// Public visibility is the conjunction Phase 6G-17 requires:
// status === "PUBLISHED" && archivedAt === null — never "not archived"
// alone.
// ---------------------------------------------------------------------------

/**
 * The public /learning/[slug] page's sole data source. Returns null for a
 * nonexistent, unpublished (DRAFT), or archived LearningGuide (never
 * distinguishes the three, same convention as every other public
 * entity-page function in this file).
 */
export async function getPublicLearningGuidePageData(slug: string): Promise<LearningGuidePageData | null> {
  const guide = await prisma.learningGuide.findUnique({
    where: { slug },
    include: {
      workLinks: { include: { musicalWork: { include: { composer: true } } } },
      recordingLinks: {
        include: {
          recording: {
            include: {
              currentPublishedRevision: {
                include: {
                  performance: {
                    include: {
                      venue: true,
                      programme: true,
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
    },
  });

  if (!guide || guide.status !== "PUBLISHED" || guide.archivedAt !== null) return null;

  // Archived Works (or Works of an archived Composer) are never publicly
  // shown, same convention as every other public page's catalogue-visibility rule.
  const activeWorkLinks = guide.workLinks.filter((link) => isActiveWork(link.musicalWork));

  // A Recording only counts as publicly attached once it is itself
  // published — isRecordingPublished (Phase 6G-5A) is the single
  // authoritative predicate, never a second one re-derived here.
  const publishedRecordingLinks = guide.recordingLinks.filter(
    (link) => link.recording.currentPublishedRevision !== null && isRecordingPubliclyVisible(link.recording)
  );

  return assembleLearningGuidePageData({
    id: guide.id,
    slug: guide.slug,
    title: guide.title,
    difficultyLevel: guide.difficultyLevel,
    contentMarkdown: guide.contentMarkdown,
    estimatedReadingTimeMinutes: guide.estimatedReadingTimeMinutes,
    updatedAt: guide.updatedAt,
    works: activeWorkLinks.map((link) => ({
      id: link.musicalWork.id,
      slug: link.musicalWork.slug,
      title: link.musicalWork.title,
      composer: { id: link.musicalWork.composer.id, slug: link.musicalWork.composer.slug, name: link.musicalWork.composer.name },
    })),
    recordings: publishedRecordingLinks.map((link) => {
      const revision = link.recording.currentPublishedRevision!;
      const performance = revision.performance && isActivePerformance(revision.performance) ? revision.performance : null;
      return {
        id: link.recording.id,
        slug: link.recording.slug,
        title: revision.title,
        performance: performance
          ? {
              id: performance.id,
              slug: performance.slug,
              performanceDate: performance.performanceDate,
              programme: { id: performance.programme.id, slug: performance.programme.slug, title: performance.programme.title },
              venue: { id: performance.venue.id, slug: performance.venue.slug, name: performance.venue.name },
              performers: performance.performers.filter((p) => isActiveRef(p.artist)),
              choirs: performance.choirs.filter((c) => isActiveRef(c.choir)),
              conductors: performance.conductors.filter((c) => isActiveRef(c.conductor)),
            }
          : null,
      };
    }),
  });
}
