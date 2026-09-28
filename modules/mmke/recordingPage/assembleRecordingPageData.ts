import type {
  RecordingPageComposer,
  RecordingPageData,
  RecordingPagePerformance,
  RecordingPageProgramme,
  RecordingPageVideo,
  RecordingPageCollection,
} from "./recordingPageContract";

// Phase 6G-5B — pure mapping from already-loaded, already-public-filtered
// relationship data into the RecordingPageData contract, mirroring
// modules/mmke/entityPage/assembleEntityPageData.ts's role (ADR §3
// boundary rule: no Prisma import here). The caller (modules/db's
// entityRelationshipsRepository.ts) is responsible for loading the
// canonical revision context AND filtering media/collections down to
// what's genuinely public before calling this — this function only shapes
// data it is handed, it never decides what's safe to show.

interface RawWork {
  id: string;
  slug: string;
  title: string;
  composer: { id: string; slug: string; name: string };
}

interface RawProgrammeItem {
  id: string;
  movement: string | null;
  isEncore: boolean;
  musicalWork: { id: string; slug: string; title: string };
}

interface RawProgramme {
  id: string;
  slug: string;
  title: string;
  items: RawProgrammeItem[];
}

interface RawPerformance {
  id: string;
  slug: string;
  performanceDate: Date | null;
  venue: { id: string; slug: string; name: string; organisation: { id: string; slug: string; name: string } | null } | null;
  performers: { artist: { id: string; slug: string; name: string }; role: string | null }[];
  choirs: { choir: { id: string; slug: string; name: string } }[];
  conductors: { conductor: { id: string; slug: string; name: string } }[];
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

export interface AssembleRecordingPageDataInput {
  id: string;
  slug: string;
  title: string | null;
  description: string | null;
  seoMetaTitle: string | null;
  seoMetaDescription: string | null;
  seoCanonicalPath: string | null;
  educationalDifficultyLevel: string | null;
  educationalListeningGuide: string | null;
  educationalAnalysis: string | null;
  works: RawWork[];
  programme: RawProgramme | null;
  performance: RawPerformance | null;
  videos: RawVideo[];
  collections: RawCollection[];
}

function toWork(work: RawWork) {
  return { id: work.id, slug: work.slug, title: work.title, composer: work.composer };
}

function toProgramme(programme: RawProgramme | null): RecordingPageProgramme | null {
  if (!programme) return null;
  return {
    id: programme.id,
    slug: programme.slug,
    title: programme.title,
    items: programme.items.map((item) => ({
      id: item.id,
      work: item.musicalWork,
      movement: item.movement,
      isEncore: item.isEncore,
    })),
  };
}

function toPerformance(performance: RawPerformance | null): RecordingPagePerformance | null {
  if (!performance) return null;
  return {
    id: performance.id,
    slug: performance.slug,
    performanceDate: performance.performanceDate,
    venue: performance.venue,
    artists: performance.performers.map((link) => ({ id: link.artist.id, slug: link.artist.slug, name: link.artist.name, role: link.role })),
    choirs: performance.choirs.map((link) => ({ id: link.choir.id, slug: link.choir.slug, name: link.choir.name })),
    conductors: performance.conductors.map((link) => ({ id: link.conductor.id, slug: link.conductor.slug, name: link.conductor.name })),
  };
}

function toVideo(video: RawVideo): RecordingPageVideo {
  return { slug: video.page.slug, title: video.youtubeVideo.title, thumbnailUrl: video.youtubeVideo.thumbnailUrl };
}

function toCollection(collection: RawCollection): RecordingPageCollection {
  return { id: collection.id, slug: collection.slug, title: collection.title };
}

function dedupeComposers(works: RawWork[]): RecordingPageComposer[] {
  const seen = new Map<string, RecordingPageComposer>();
  for (const work of works) {
    if (!seen.has(work.composer.id)) {
      seen.set(work.composer.id, work.composer);
    }
  }
  return Array.from(seen.values());
}

export function assembleRecordingPageData(input: AssembleRecordingPageDataInput): RecordingPageData {
  return {
    id: input.id,
    slug: input.slug,
    title: input.title,
    description: input.description,
    seoMetaTitle: input.seoMetaTitle,
    seoMetaDescription: input.seoMetaDescription,
    seoCanonicalPath: input.seoCanonicalPath,
    educationalDifficultyLevel: input.educationalDifficultyLevel,
    educationalListeningGuide: input.educationalListeningGuide,
    educationalAnalysis: input.educationalAnalysis,
    works: input.works.map(toWork),
    composers: dedupeComposers(input.works),
    programme: toProgramme(input.programme),
    performance: toPerformance(input.performance),
    videos: input.videos.map(toVideo),
    collections: input.collections.map(toCollection),
  };
}
