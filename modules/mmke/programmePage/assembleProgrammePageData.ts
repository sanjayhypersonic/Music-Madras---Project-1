import type {
  ProgrammePageCollection,
  ProgrammePageData,
  ProgrammePageItem,
  ProgrammePagePerformance,
  ProgrammePageRecording,
  ProgrammePageVideo,
} from "./programmePageContract";

// Phase 6G-8 — pure mapping from already-loaded, already-public-filtered
// relationship data into the ProgrammePageData contract, mirroring
// modules/mmke/workPage/assembleWorkPageData.ts's role (ADR §3 boundary
// rule: no Prisma import here). The caller (modules/db's
// entityRelationshipsRepository.ts) is responsible for loading the
// canonical relationship data via resolveRelatedContent AND filtering
// media/collections down to what's genuinely public before calling this.

interface RawWork {
  id: string;
  slug: string;
  title: string;
  composer: { id: string; slug: string; name: string };
}

interface RawItem {
  id: string;
  order: number;
  movement: string | null;
  isEncore: boolean;
  musicalWork: RawWork;
}

interface RawPerformance {
  id: string;
  slug: string;
  performanceDate: Date | null;
  venue: { name: string; slug: string } | null;
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

export interface AssembleProgrammePageDataInput {
  id: string;
  slug: string;
  title: string;
  notes: string | null;
  items: RawItem[];
  performances: RawPerformance[];
  recordings: RawRecording[];
  videos: RawVideo[];
  collections: RawCollection[];
}

function toItem(item: RawItem): ProgrammePageItem {
  return {
    id: item.id,
    order: item.order,
    movement: item.movement,
    isEncore: item.isEncore,
    work: {
      id: item.musicalWork.id,
      slug: item.musicalWork.slug,
      title: item.musicalWork.title,
      composer: item.musicalWork.composer,
    },
  };
}

function toPerformance(performance: RawPerformance): ProgrammePagePerformance {
  return {
    id: performance.id,
    slug: performance.slug,
    performanceDate: performance.performanceDate,
    venue: performance.venue,
    artists: performance.performers.map((link) => link.artist.name),
    choirs: performance.choirs.map((link) => link.choir.name),
    conductors: performance.conductors.map((link) => link.conductor.name),
  };
}

function toRecording(recording: RawRecording): ProgrammePageRecording {
  return { id: recording.id, slug: recording.slug, title: recording.currentPublishedRevision?.title ?? null };
}

function toVideo(video: RawVideo): ProgrammePageVideo {
  return { slug: video.page.slug, title: video.youtubeVideo.title, thumbnailUrl: video.youtubeVideo.thumbnailUrl };
}

function toCollection(collection: RawCollection): ProgrammePageCollection {
  return { id: collection.id, slug: collection.slug, title: collection.title };
}

export function assembleProgrammePageData(input: AssembleProgrammePageDataInput): ProgrammePageData {
  return {
    id: input.id,
    slug: input.slug,
    title: input.title,
    notes: input.notes,
    items: input.items.map(toItem),
    performances: input.performances.map(toPerformance),
    recordings: input.recordings.map(toRecording),
    videos: input.videos.map(toVideo),
    collections: input.collections.map(toCollection),
  };
}
