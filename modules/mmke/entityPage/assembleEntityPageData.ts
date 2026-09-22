import type {
  EntityPageData,
  EntityPageLifespan,
  EntityPageRelatedCollection,
  EntityPageRelatedParticipants,
  EntityPageRelatedPerformance,
  EntityPageRelatedProgramme,
  EntityPageRelatedRecording,
  EntityPageRelatedVideo,
  EntityPageRelatedWork,
  EntityType,
} from "./entityPageContract";

// Phase 6G-4A/6G-4B — pure mapping from already-loaded relationship data
// into the EntityPageData contract (ADR §3 boundary rule: no Prisma
// import here; modules/db/repositories/entityRelationshipsRepository.ts
// does the actual querying and passes plain data in). Every input type
// below is a narrow structural subset of the real Prisma model — the
// real model naturally satisfies it — so this function is testable with
// plain object literals and never needs a database.

interface RawWork {
  id: string;
  slug: string;
  title: string;
}

interface RawProgramme {
  id: string;
  slug: string;
  title: string;
}

interface RawPerformance {
  id: string;
  performanceDate: Date | null;
  venue: { name: string } | null;
  performers: { artist: { name: string } }[];
  choirs: { choir: { name: string } }[];
  conductors: { conductor: { name: string } }[];
}

interface RawRecording {
  id: string;
  slug: string;
  currentPublishedRevision: { title: string | null } | null;
}

interface RawVideo {
  page: { slug: string };
  youtubeVideo: { title: string | null; thumbnailUrl: string | null };
}

interface RawCollection {
  id: string;
  slug: string;
  title: string;
}

export interface AssembleEntityPageDataInput {
  entityType: EntityType;
  id: string;
  slug: string;
  name: string;
  description: string | null;
  /** Only Composer pages populate this today; every other entity type passes null. */
  lifespan: EntityPageLifespan | null;
  /** Only Composer pages populate this today; every other entity type passes null. */
  works: RawWork[] | null;
  programmes: RawProgramme[];
  performances: RawPerformance[];
  recordings: RawRecording[];
  videos: RawVideo[];
  collections: RawCollection[];
}

function toWork(work: RawWork): EntityPageRelatedWork {
  return { id: work.id, slug: work.slug, title: work.title };
}

function toProgramme(programme: RawProgramme): EntityPageRelatedProgramme {
  return { id: programme.id, slug: programme.slug, title: programme.title };
}

function toPerformance(performance: RawPerformance): EntityPageRelatedPerformance {
  return {
    id: performance.id,
    performanceDate: performance.performanceDate,
    venueName: performance.venue?.name ?? null,
    artists: performance.performers.map((link) => link.artist.name),
    choirs: performance.choirs.map((link) => link.choir.name),
    conductors: performance.conductors.map((link) => link.conductor.name),
  };
}

function toRecording(recording: RawRecording): EntityPageRelatedRecording {
  return { id: recording.id, slug: recording.slug, title: recording.currentPublishedRevision?.title ?? null };
}

function toVideo(video: RawVideo): EntityPageRelatedVideo {
  return { slug: video.page.slug, title: video.youtubeVideo.title, thumbnailUrl: video.youtubeVideo.thumbnailUrl };
}

function toCollection(collection: RawCollection): EntityPageRelatedCollection {
  return { id: collection.id, slug: collection.slug, title: collection.title };
}

function dedupeStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

/** Derived, not separately queried (brief §5I) — deduped by name across every relatedPerformance. */
function deriveRelatedParticipants(performances: RawPerformance[]): EntityPageRelatedParticipants {
  return {
    artists: dedupeStrings(performances.flatMap((p) => p.performers.map((l) => l.artist.name))),
    choirs: dedupeStrings(performances.flatMap((p) => p.choirs.map((l) => l.choir.name))),
    conductors: dedupeStrings(performances.flatMap((p) => p.conductors.map((l) => l.conductor.name))),
    venues: dedupeStrings(performances.map((p) => p.venue?.name).filter((name): name is string => Boolean(name))),
  };
}

export function assembleEntityPageData(input: AssembleEntityPageDataInput): EntityPageData {
  return {
    entityType: input.entityType,
    id: input.id,
    slug: input.slug,
    name: input.name,
    description: input.description,
    lifespan: input.lifespan,
    relatedWorks: input.works ? input.works.map(toWork) : null,
    relatedProgrammes: input.programmes.map(toProgramme),
    relatedPerformances: input.performances.map(toPerformance),
    relatedRecordings: input.recordings.map(toRecording),
    relatedParticipants: deriveRelatedParticipants(input.performances),
    relatedVideos: input.videos.map(toVideo),
    relatedCollections: input.collections.map(toCollection),
  };
}
