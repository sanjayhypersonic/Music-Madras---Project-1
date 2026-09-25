import type {
  CollectionPageComposer,
  CollectionPageData,
  CollectionPageRecording,
  CollectionPageRecordingContext,
  CollectionPageVideo,
  CollectionPageWork,
  CollectionPageWorkItem,
} from "./collectionPageContract";

// Phase 6G-10 — pure mapping from already-loaded, already-public-filtered
// relationship data into the CollectionPageData contract, mirroring
// modules/mmke/programmePage/assembleProgrammePageData.ts's role (ADR §3
// boundary rule: no Prisma import here). The caller (modules/db's
// entityRelationshipsRepository.ts) is responsible for loading the
// canonical Collection-rooted relationship data — via CollectionRecording/
// CollectionWork, never via resolveRelatedContent's Performance-rooted
// traversal, which has no meaning for a Collection — AND filtering the
// Recordings/videos down to what's genuinely public before calling this.

interface RawComposer {
  id: string;
  slug: string;
  name: string;
}

interface RawWork {
  id: string;
  slug: string;
  title: string;
  composer: RawComposer;
}

interface RawParticipant {
  id: string;
  slug: string;
  name: string;
}

interface RawPerformance {
  id: string;
  slug: string;
  performanceDate: Date | null;
  programme: { id: string; slug: string; title: string } | null;
  venue: { id: string; slug: string; name: string } | null;
  performers: { artist: RawParticipant }[];
  choirs: { choir: RawParticipant }[];
  conductors: { conductor: RawParticipant }[];
}

interface RawCollectionRecording {
  id: string;
  slug: string;
  title: string | null;
  order: number;
  performance: RawPerformance | null;
  works: RawWork[];
}

interface RawCollectionWorkItem {
  order: number;
  musicalWork: RawWork;
}

interface RawVideo {
  page: { slug: string };
  youtubeVideo: { title: string | null; thumbnailUrl: string | null };
}

export interface AssembleCollectionPageDataInput {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  recordings: RawCollectionRecording[];
  works: RawCollectionWorkItem[];
  videos: RawVideo[];
}

function toWork(work: RawWork): CollectionPageWork {
  return { id: work.id, slug: work.slug, title: work.title, composer: work.composer };
}

function toContext(performance: RawPerformance | null): CollectionPageRecordingContext {
  if (!performance) {
    return { programme: null, performance: null, venue: null, artists: [], choirs: [], conductors: [] };
  }
  return {
    programme: performance.programme,
    performance: { id: performance.id, slug: performance.slug, performanceDate: performance.performanceDate },
    venue: performance.venue,
    artists: performance.performers.map((link) => link.artist),
    choirs: performance.choirs.map((link) => link.choir),
    conductors: performance.conductors.map((link) => link.conductor),
  };
}

function toRecording(recording: RawCollectionRecording): CollectionPageRecording {
  return {
    id: recording.id,
    slug: recording.slug,
    title: recording.title,
    order: recording.order,
    context: toContext(recording.performance),
  };
}

function toWorkItem(item: RawCollectionWorkItem): CollectionPageWorkItem {
  return { order: item.order, work: toWork(item.musicalWork) };
}

function toVideo(video: RawVideo): CollectionPageVideo {
  return { slug: video.page.slug, title: video.youtubeVideo.title, thumbnailUrl: video.youtubeVideo.thumbnailUrl };
}

/** Deduped by id — every Composer whose work this Collection features, whether attached directly (CollectionWork) or via one of its Recordings' own attached Works. */
function deriveComposers(recordings: RawCollectionRecording[], works: RawCollectionWorkItem[]): CollectionPageComposer[] {
  const seen = new Map<string, CollectionPageComposer>();
  for (const item of works) {
    seen.set(item.musicalWork.composer.id, item.musicalWork.composer);
  }
  for (const recording of recordings) {
    for (const work of recording.works) {
      seen.set(work.composer.id, work.composer);
    }
  }
  return Array.from(seen.values());
}

export function assembleCollectionPageData(input: AssembleCollectionPageDataInput): CollectionPageData {
  return {
    id: input.id,
    slug: input.slug,
    title: input.title,
    description: input.description,
    recordings: input.recordings.map(toRecording),
    works: input.works.map(toWorkItem),
    composers: deriveComposers(input.recordings, input.works),
    videos: input.videos.map(toVideo),
  };
}
