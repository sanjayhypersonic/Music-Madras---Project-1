import { dedupeById } from "../relationships/formatComposerCredit";
import type { LearningGuidePageComposer, LearningGuidePageData, LearningGuidePageRecording, LearningGuidePageWork } from "./learningGuidePageContract";

// Phase 6G-17 — pure mapping from already-loaded, already-public-filtered
// relationship data into the LearningGuidePageData contract, mirroring
// modules/mmke/collectionPage/assembleCollectionPageData.ts's role (ADR §3
// boundary rule: no Prisma import here). The caller (modules/db's
// entityRelationshipsRepository.ts) is responsible for loading the
// canonical relationship data and filtering it down to what's genuinely
// public before calling this.

interface RawWork {
  id: string;
  slug: string;
  title: string;
  composer: { id: string; slug: string; name: string };
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

interface RawRecording {
  id: string;
  slug: string;
  title: string | null;
  performance: RawPerformance | null;
}

export interface AssembleLearningGuidePageDataInput {
  id: string;
  slug: string;
  title: string;
  difficultyLevel: string | null;
  contentMarkdown: string | null;
  estimatedReadingTimeMinutes: number | null;
  updatedAt: Date;
  works: RawWork[];
  recordings: RawRecording[];
}

function toWork(work: RawWork): LearningGuidePageWork {
  return { id: work.id, slug: work.slug, title: work.title, composer: work.composer };
}

function toRecording(recording: RawRecording): LearningGuidePageRecording {
  const performance = recording.performance;
  return {
    id: recording.id,
    slug: recording.slug,
    title: recording.title,
    context: {
      programme: performance?.programme ?? null,
      performance: performance ? { id: performance.id, slug: performance.slug, performanceDate: performance.performanceDate } : null,
      venue: performance?.venue ?? null,
      artists: performance?.performers.map((link) => link.artist) ?? [],
      choirs: performance?.choirs.map((link) => link.choir) ?? [],
      conductors: performance?.conductors.map((link) => link.conductor) ?? [],
    },
  };
}

export function assembleLearningGuidePageData(input: AssembleLearningGuidePageDataInput): LearningGuidePageData {
  const composers: LearningGuidePageComposer[] = dedupeById(input.works.map((work) => work.composer));

  return {
    id: input.id,
    slug: input.slug,
    title: input.title,
    difficultyLevel: input.difficultyLevel,
    contentMarkdown: input.contentMarkdown,
    estimatedReadingTimeMinutes: input.estimatedReadingTimeMinutes,
    updatedAt: input.updatedAt,
    works: input.works.map(toWork),
    composers,
    recordings: input.recordings.map(toRecording),
  };
}
