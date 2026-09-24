import type {
  PerformancePageCollection,
  PerformancePageData,
  PerformancePagePerformer,
  PerformancePageProgrammeItem,
  PerformancePageRecording,
  PerformancePageVideo,
} from "./performancePageContract";

// Phase 6G-8 — pure mapping from already-loaded, already-public-filtered
// relationship data into the PerformancePageData contract, mirroring
// modules/mmke/programmePage/assembleProgrammePageData.ts's role (ADR §3
// boundary rule: no Prisma import here). The caller (modules/db's
// entityRelationshipsRepository.ts) is responsible for loading the
// canonical relationship data AND filtering media/collections down to
// what's genuinely public before calling this.

interface RawWork {
  id: string;
  slug: string;
  title: string;
  composer: { id: string; slug: string; name: string };
}

interface RawProgrammeItem {
  id: string;
  order: number;
  movement: string | null;
  isEncore: boolean;
  musicalWork: RawWork;
}

interface RawProgramme {
  id: string;
  slug: string;
  title: string;
  items: RawProgrammeItem[];
}

interface RawOrganisation {
  id: string;
  name: string;
}

interface RawVenue {
  id: string;
  slug: string;
  name: string;
  organisation: RawOrganisation | null;
}

interface RawPerformer {
  artist: { id: string; name: string };
  role: string | null;
}

interface RawChoirLink {
  choir: { id: string; name: string };
}

interface RawConductorLink {
  conductor: { id: string; name: string };
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

export interface AssemblePerformancePageDataInput {
  id: string;
  slug: string;
  performanceDate: Date | null;
  programme: RawProgramme;
  venue: RawVenue;
  performers: RawPerformer[];
  choirs: RawChoirLink[];
  conductors: RawConductorLink[];
  recordings: RawRecording[];
  videos: RawVideo[];
  collections: RawCollection[];
}

function toProgrammeItem(item: RawProgrammeItem): PerformancePageProgrammeItem {
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

function toPerformer(performer: RawPerformer): PerformancePagePerformer {
  return { id: performer.artist.id, name: performer.artist.name, role: performer.role };
}

function toRecording(recording: RawRecording): PerformancePageRecording {
  return { id: recording.id, slug: recording.slug, title: recording.currentPublishedRevision?.title ?? null };
}

function toVideo(video: RawVideo): PerformancePageVideo {
  return { slug: video.page.slug, title: video.youtubeVideo.title, thumbnailUrl: video.youtubeVideo.thumbnailUrl };
}

function toCollection(collection: RawCollection): PerformancePageCollection {
  return { id: collection.id, slug: collection.slug, title: collection.title };
}

export function assemblePerformancePageData(input: AssemblePerformancePageDataInput): PerformancePageData {
  return {
    id: input.id,
    slug: input.slug,
    performanceDate: input.performanceDate,
    programme: {
      id: input.programme.id,
      slug: input.programme.slug,
      title: input.programme.title,
      items: input.programme.items.map(toProgrammeItem),
    },
    venue: input.venue,
    artists: input.performers.map(toPerformer),
    choirs: input.choirs.map((link) => link.choir),
    conductors: input.conductors.map((link) => link.conductor),
    recordings: input.recordings.map(toRecording),
    videos: input.videos.map(toVideo),
    collections: input.collections.map(toCollection),
  };
}
