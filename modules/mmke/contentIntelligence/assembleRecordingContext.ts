import { dedupeById } from "../relationships/formatComposerCredit";
import type { CompletenessReportItem, RecordingReadiness } from "../completeness/checkRecordingRevisionCompleteness";
import type {
  RecordingContext,
  RecordingContextComposer,
  RecordingContextGap,
  RecordingContextMode,
  RecordingContextParticipant,
  RecordingContextRightsInformation,
  RecordingContextSource,
  RecordingContextWork,
  RecordingContextYouTubeVideo,
} from "./recordingContextContract";

// Phase 6H-3 — pure mapping from already-loaded, already-scoped
// relationship data into the RecordingContext contract, mirroring
// modules/mmke/recordingPage/assembleRecordingPageData.ts's role (ADR §3
// boundary rule: no Prisma import here). The caller
// (modules/db/repositories/recordingContextRepository.ts) is responsible
// for loading the canonical revision and filtering
// collections/learningGuides to what is genuinely public — this function
// only shapes and derives from data it is handed; it never queries or
// decides what is safe to expose.
//
// This function performs no I/O and is fully deterministic: identical
// input always produces identical output (brief Step 9). Ordering is
// normalized here rather than left to database row order.

interface RawComposer {
  id: string;
  slug: string;
  name: string;
  era: string | null;
  bornDate: string | null;
  diedDate: string | null;
  biography: string | null;
}

interface RawWork {
  musicalWorkId: string;
  musicalWork: {
    id: string;
    slug: string;
    title: string;
    alternateTitles: string[];
    catalogueNumber: string | null;
    keySignature: string | null;
    language: string | null;
    notes: string | null;
    composer: RawComposer;
  };
}

interface RawArtist {
  id: string;
  slug: string;
  name: string;
  biography: string | null;
}

interface RawChoir {
  id: string;
  slug: string;
  name: string;
  description: string | null;
}

interface RawConductor {
  id: string;
  slug: string;
  name: string;
  biography: string | null;
}

interface RawOrganisation {
  id: string;
  slug: string;
  name: string;
  description: string | null;
}

interface RawVenue {
  id: string;
  slug: string;
  name: string;
  type: string;
  address: string | null;
  city: string | null;
  country: string | null;
  organisation: RawOrganisation | null;
}

interface RawProgrammeItem {
  movement: string | null;
  isEncore: boolean;
  musicalWork: { id: string; title: string };
}

interface RawProgramme {
  id: string;
  slug: string;
  title: string;
  notes: string | null;
  items: RawProgrammeItem[];
}

interface RawPerformance {
  id: string;
  slug: string;
  performanceDate: Date | null;
  venue: RawVenue;
  programme: RawProgramme | null;
  performers: { role: string | null; artist: RawArtist }[];
  choirs: { choir: RawChoir }[];
  conductors: { conductor: RawConductor }[];
}

interface RawYouTubeVideo {
  id: string;
  youtubeVideoId: string;
  title: string | null;
  description: string | null;
  publishedAt: Date | null;
  durationSeconds: number | null;
  thumbnailUrl: string | null;
}

interface RawMediaResource {
  provider: string;
  youtubeVideoId: string | null;
  youtubeVideo: RawYouTubeVideo | null;
}

interface RawRevision {
  id: string;
  revisionNumber: number;
  revisionStatus: string;
  title: string | null;
  description: string | null;
  seoMetaTitle: string | null;
  seoMetaDescription: string | null;
  educationalDifficultyLevel: string | null;
  educationalListeningGuide: string | null;
  educationalAnalysis: string | null;
  works: RawWork[];
  mediaResources: RawMediaResource[];
  performance: RawPerformance | null;
}

interface RawEntitySourceLink {
  entityType: string;
  entityId: string;
  source: {
    id: string;
    title: string | null;
    url: string | null;
    publisher: string | null;
    /** Phase 6H-8 — present because the caller only ever supplies already-APPROVED sources (recordingContextRepository.ts's listApprovedSourcesForEntity). */
    citations: { id: string; text: string | null }[];
  };
}

interface RawEntityRightsLink {
  entityType: string;
  entityId: string;
  rightsInformation: { id: string; holder: string | null; licenseType: string | null };
}

export interface AssembleRecordingContextInput {
  recording: { id: string; slug: string; status: string };
  revision: RawRevision;
  mode: RecordingContextMode;
  /** Internal YouTubeVideo.id -> the public /videos/[slug] slug, only for videos that are genuinely public right now. */
  publicSlugByVideoId: Map<string, string>;
  collections: { id: string; slug: string; title: string }[];
  learningGuides: { id: string; slug: string; title: string }[];
  sources: RawEntitySourceLink[];
  rights: RawEntityRightsLink[];
  completenessReport: CompletenessReportItem[];
  readiness: RecordingReadiness;
}

function toComposer(composer: RawComposer): RecordingContextComposer {
  return {
    id: composer.id,
    slug: composer.slug,
    name: composer.name,
    era: composer.era,
    bornDate: composer.bornDate,
    diedDate: composer.diedDate,
    biography: composer.biography,
  };
}

function toWork(work: RawWork): RecordingContextWork {
  const w = work.musicalWork;
  return {
    id: w.id,
    slug: w.slug,
    title: w.title,
    alternateTitles: w.alternateTitles,
    catalogueNumber: w.catalogueNumber,
    keySignature: w.keySignature,
    language: w.language,
    notes: w.notes,
    composer: toComposer(w.composer),
  };
}

function toParticipant(entity: { id: string; slug: string; name: string; biography?: string | null; description?: string | null }, role: string | null): RecordingContextParticipant {
  return {
    id: entity.id,
    slug: entity.slug,
    name: entity.name,
    description: entity.biography ?? entity.description ?? null,
    role,
  };
}

function sortByNameThenId<T extends { name: string; id: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

function toVenue(venue: RawVenue) {
  return {
    id: venue.id,
    slug: venue.slug,
    name: venue.name,
    type: venue.type,
    address: venue.address,
    city: venue.city,
    country: venue.country,
    organisation: venue.organisation
      ? { id: venue.organisation.id, slug: venue.organisation.slug, name: venue.organisation.name, description: venue.organisation.description }
      : null,
  };
}

function toProgramme(programme: RawProgramme | null) {
  if (!programme) return null;
  return {
    id: programme.id,
    slug: programme.slug,
    title: programme.title,
    notes: programme.notes,
    items: programme.items.map((item) => ({
      workId: item.musicalWork.id,
      workTitle: item.musicalWork.title,
      movement: item.movement,
      isEncore: item.isEncore,
    })),
  };
}

function toPerformance(performance: RawPerformance | null) {
  if (!performance) return null;
  return {
    id: performance.id,
    slug: performance.slug,
    performanceDate: performance.performanceDate,
    venue: toVenue(performance.venue),
    programme: toProgramme(performance.programme),
    performers: sortByNameThenId(performance.performers.map((link) => toParticipant(link.artist, link.role))),
    choirs: sortByNameThenId(performance.choirs.map((link) => toParticipant(link.choir, null))),
    conductors: sortByNameThenId(performance.conductors.map((link) => toParticipant(link.conductor, null))),
  };
}

function toVideo(media: RawMediaResource, publicSlugByVideoId: Map<string, string>): RecordingContextYouTubeVideo | null {
  if (media.provider !== "YOUTUBE" || !media.youtubeVideo) return null;
  const video = media.youtubeVideo;
  return {
    id: video.id,
    youtubeVideoId: video.youtubeVideoId,
    title: video.title,
    description: video.description,
    publishedAt: video.publishedAt,
    durationSeconds: video.durationSeconds,
    thumbnailUrl: video.thumbnailUrl,
    publicSlug: publicSlugByVideoId.get(video.id) ?? null,
  };
}

function toSource(link: RawEntitySourceLink): RecordingContextSource {
  return {
    id: link.source.id,
    title: link.source.title,
    url: link.source.url,
    publisher: link.source.publisher,
    approvalState: "APPROVED",
    citations: [...link.source.citations]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((citation) => ({ id: citation.id, text: citation.text })),
    attachedTo: { entityType: link.entityType, entityId: link.entityId },
  };
}

function toRights(link: RawEntityRightsLink): RecordingContextRightsInformation {
  return {
    id: link.rightsInformation.id,
    holder: link.rightsInformation.holder,
    licenseType: link.rightsInformation.licenseType,
    attachedTo: { entityType: link.entityType, entityId: link.entityId },
  };
}

function deriveGaps(input: {
  workCount: number;
  performance: ReturnType<typeof toPerformance>;
  media: RecordingContextYouTubeVideo[];
  hasProvenance: boolean;
  editorial: { description: string | null; educationalListeningGuide: string | null; educationalAnalysis: string | null };
}): RecordingContextGap[] {
  const gaps: RecordingContextGap[] = [];

  if (input.workCount === 0) {
    gaps.push({ field: "WORK", state: "MISSING", detail: "No MusicalWork is directly attached to this recording revision." });
  }

  if (!input.performance) {
    gaps.push({
      field: "PERFORMANCE",
      state: "MISSING",
      detail: "No Performance is linked to this recording revision — no date, venue, or participant information is available.",
    });
  } else {
    const participantCount = input.performance.performers.length + input.performance.choirs.length + input.performance.conductors.length;
    if (participantCount === 0) {
      gaps.push({ field: "PARTICIPANTS", state: "MISSING", detail: "The linked Performance has no performers, choirs, or conductors attached." });
    }
    gaps.push({
      field: "EDITORIAL_CONTENT",
      state: "NOT_APPLICABLE",
      detail:
        "Venue has no description/biography field in the schema — this is a model gap, not missing content (docs/content-intelligence-architecture.md, Phase 6H-1 §3D/§4).",
    });
  }

  if (input.media.length === 0) {
    gaps.push({ field: "MEDIA", state: "MISSING", detail: "No YouTube video is attached to this recording revision." });
  }

  if (!input.hasProvenance) {
    gaps.push({
      field: "PROVENANCE",
      state: "MISSING",
      detail: "No Source or RightsInformation is attached to this recording, its works, or their composers.",
    });
  }

  if (!input.editorial.description && !input.editorial.educationalListeningGuide && !input.editorial.educationalAnalysis) {
    gaps.push({ field: "EDITORIAL_CONTENT", state: "MISSING", detail: "No editorial prose (description, listening guide, or analysis) exists on this revision yet." });
  }

  return gaps;
}

export function assembleRecordingContext(input: AssembleRecordingContextInput): RecordingContext {
  const works = input.revision.works.map(toWork);
  const composers = dedupeById(works.map((w) => w.composer)).sort((a, b) => a.id.localeCompare(b.id));

  const media = input.revision.mediaResources
    .map((m) => toVideo(m, input.publicSlugByVideoId))
    .filter((v): v is RecordingContextYouTubeVideo => v !== null)
    .sort((a, b) => (a.publishedAt?.getTime() ?? 0) - (b.publishedAt?.getTime() ?? 0) || a.id.localeCompare(b.id));

  const performance = toPerformance(input.revision.performance);

  const editorial = {
    description: input.revision.description,
    educationalDifficultyLevel: input.revision.educationalDifficultyLevel,
    educationalListeningGuide: input.revision.educationalListeningGuide,
    educationalAnalysis: input.revision.educationalAnalysis,
    seoMetaTitle: input.revision.seoMetaTitle,
    seoMetaDescription: input.revision.seoMetaDescription,
  };

  const sources = input.sources.map(toSource).sort((a, b) => a.id.localeCompare(b.id) || a.attachedTo.entityId.localeCompare(b.attachedTo.entityId));
  const rights = input.rights.map(toRights).sort((a, b) => a.id.localeCompare(b.id) || a.attachedTo.entityId.localeCompare(b.attachedTo.entityId));
  const hasProvenance = sources.length > 0 || rights.length > 0;

  const collections = [...input.collections].sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
  const learningGuides = [...input.learningGuides].sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));

  return {
    identity: {
      recordingId: input.recording.id,
      slug: input.recording.slug,
      status: input.recording.status,
      revisionId: input.revision.id,
      revisionNumber: input.revision.revisionNumber,
      revisionStatus: input.revision.revisionStatus,
      mode: input.mode,
      title: input.revision.title,
    },
    works,
    composers,
    performance,
    editorial,
    media,
    collections,
    learningGuides,
    provenance: { sources, rights },
    completeness: {
      report: input.completenessReport,
      readiness: input.readiness,
      hasProvenance,
      gaps: deriveGaps({ workCount: works.length, performance, media, hasProvenance, editorial }),
    },
  };
}
