import type { WorkPageData, WorkPagePerformance, WorkPageVideo, WorkPageCollection } from "./workPageContract";

// Phase 6G-6 — pure mapping from already-loaded, already-public-filtered
// relationship data into the WorkPageData contract, mirroring
// modules/mmke/recordingPage/assembleRecordingPageData.ts's role (ADR §3
// boundary rule: no Prisma import here). The caller (modules/db's
// entityRelationshipsRepository.ts) is responsible for loading the
// canonical relationship data via resolveRelatedContent AND filtering
// media/collections down to what's genuinely public before calling this.

interface RawPerformance {
  id: string;
  performanceDate: Date | null;
  venue: { name: string; slug: string } | null;
  performers: { artist: { name: string } }[];
  choirs: { choir: { name: string } }[];
  conductors: { conductor: { name: string } }[];
}

interface RawProgramme {
  id: string;
  slug: string;
  title: string;
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

export interface AssembleWorkPageDataInput {
  id: string;
  slug: string;
  title: string;
  alternateTitles: string[];
  language: string | null;
  notes: string | null;
  catalogueNumber: string | null;
  keySignature: string | null;
  composer: { id: string; slug: string; name: string };
  programmes: RawProgramme[];
  performances: RawPerformance[];
  recordings: RawRecording[];
  videos: RawVideo[];
  collections: RawCollection[];
}

function toProgramme(programme: RawProgramme) {
  return { id: programme.id, slug: programme.slug, title: programme.title };
}

function toPerformance(performance: RawPerformance): WorkPagePerformance {
  return {
    id: performance.id,
    performanceDate: performance.performanceDate,
    venue: performance.venue,
    artists: performance.performers.map((link) => link.artist.name),
    choirs: performance.choirs.map((link) => link.choir.name),
    conductors: performance.conductors.map((link) => link.conductor.name),
  };
}

function toRecording(recording: RawRecording) {
  return { id: recording.id, slug: recording.slug, title: recording.currentPublishedRevision?.title ?? null };
}

function toVideo(video: RawVideo): WorkPageVideo {
  return { slug: video.page.slug, title: video.youtubeVideo.title, thumbnailUrl: video.youtubeVideo.thumbnailUrl };
}

function toCollection(collection: RawCollection): WorkPageCollection {
  return { id: collection.id, slug: collection.slug, title: collection.title };
}

export function assembleWorkPageData(input: AssembleWorkPageDataInput): WorkPageData {
  return {
    id: input.id,
    slug: input.slug,
    title: input.title,
    alternateTitles: input.alternateTitles,
    language: input.language,
    notes: input.notes,
    catalogueNumber: input.catalogueNumber,
    keySignature: input.keySignature,
    composer: input.composer,
    programmes: input.programmes.map(toProgramme),
    performances: input.performances.map(toPerformance),
    recordings: input.recordings.map(toRecording),
    videos: input.videos.map(toVideo),
    collections: input.collections.map(toCollection),
  };
}
