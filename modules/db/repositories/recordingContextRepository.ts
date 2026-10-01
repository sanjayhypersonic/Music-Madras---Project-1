import { prisma } from "../client";
import { dedupeById } from "../../mmke/relationships/formatComposerCredit";
import { checkRecordingRevisionCompleteness, computeRecordingReadiness } from "../../mmke/completeness/checkRecordingRevisionCompleteness";
import { assembleRecordingContext } from "../../mmke/contentIntelligence/assembleRecordingContext";
import type { RecordingContext, RecordingContextMode } from "../../mmke/contentIntelligence/recordingContextContract";
import { findPublicVideoPagesByYouTubeVideoIds } from "./youtubeVideoPageRepository";
import { findPublicCollectionsByIds } from "./collectionRepository";
import { listPublicLearningGuidesForRecording } from "./learningGuideRepository";
import { listApprovedSourcesForEntity } from "./sourceRepository";
import { listRightsForEntity } from "./rightsInformationRepository";
import { CitationBackedSourceRetrievalAdapter } from "../../ai/retrieval/citationBackedSourceRetrievalAdapter";
import type { SourceRetrievalAdapter } from "../../ai/retrieval/sourceRetrievalAdapter";

// Phase 6H-3 — Recording Context Assembler (docs/content-intelligence-architecture.md,
// Phase 6H-3 section). This is the architectural seam between Music
// Madras's canonical data and a future Content Intelligence layer: a
// deterministic, READ-ONLY snapshot of everything already known about one
// Recording revision, assembled entirely from existing repository
// functions (recordingRepository's own getCanonicalContextForRevision
// lacks Venue.organisation — the same reason getPublishedRecordingContextBySlug
// already runs its own fresh query instead of widening that function — so
// this repository does the same, keyed by an explicit revision rather than
// a published-only slug so it can serve both modes below).
//
// This module performs ONLY read queries (findUnique/findMany). It never
// creates, updates, deletes, archives, publishes, or writes an audit log
// entry. It has no dependency on any AI/LLM provider and makes no network
// call beyond the existing database connection.

export type RecordingContextResult =
  | { ok: true; context: RecordingContext }
  | { ok: false; reason: "NOT_FOUND" }
  | { ok: false; reason: "ARCHIVED" }
  | { ok: false; reason: "NO_DRAFT_REVISION" }
  | { ok: false; reason: "NO_PUBLISHED_REVISION" };

// Phase 6H-8 — the default, real Source Retrieval Adapter. A caller (tests
// only — never Studio/gateway code) may inject a different adapter, e.g.
// FakeSourceRetrievalAdapter, exactly as getConfiguredAIProvider's
// singleton is never substituted in production code either.
const defaultSourceRetrievalAdapter: SourceRetrievalAdapter = new CitationBackedSourceRetrievalAdapter();

/**
 * The Recording Context Assembler's entry point. Keyed by the canonical
 * Recording id (an internal Studio-facing service — never a public slug
 * lookup) and an explicit mode, defaulting to PUBLISHED as the safer
 * choice (brief Step 13/14): a caller must deliberately opt into DRAFT to
 * see in-progress content.
 *
 * Deliberately distinguishes NOT_FOUND / ARCHIVED / NO_DRAFT_REVISION /
 * NO_PUBLISHED_REVISION rather than collapsing them into one null, unlike
 * the public-page repositories (e.g. getPublicRecordingPageData) — those
 * intentionally hide *why* a slug isn't public from anonymous visitors,
 * but this is an internal service where a future Studio caller needs to
 * know which of these applies (brief Step 17).
 */
export async function getRecordingContext(
  recordingId: string,
  mode: RecordingContextMode = "PUBLISHED",
  sourceRetrievalAdapter: SourceRetrievalAdapter = defaultSourceRetrievalAdapter
): Promise<RecordingContextResult> {
  const recording = await prisma.recording.findUnique({
    where: { id: recordingId },
    select: { id: true, slug: true, status: true, currentDraftRevisionId: true, currentPublishedRevisionId: true },
  });

  if (!recording) {
    return { ok: false, reason: "NOT_FOUND" };
  }
  if (recording.status === "ARCHIVED") {
    return { ok: false, reason: "ARCHIVED" };
  }

  const revisionId = mode === "DRAFT" ? recording.currentDraftRevisionId : recording.currentPublishedRevisionId;
  if (!revisionId) {
    return { ok: false, reason: mode === "DRAFT" ? "NO_DRAFT_REVISION" : "NO_PUBLISHED_REVISION" };
  }

  const revision = await prisma.recordingRevision.findUnique({
    where: { id: revisionId },
    include: {
      works: {
        include: { musicalWork: { include: { composer: true } } },
        orderBy: { order: "asc" },
      },
      mediaResources: {
        include: { youtubeVideo: true },
        orderBy: { createdAt: "asc" },
      },
      performance: {
        include: {
          venue: { include: { organisation: true } },
          programme: {
            include: { items: { include: { musicalWork: true }, orderBy: { order: "asc" } } },
          },
          performers: { include: { artist: true } },
          choirs: { include: { choir: true } },
          conductors: { include: { conductor: true } },
        },
      },
    },
  });

  if (!revision) {
    // Defensive only — the Recording's own pointer named this revision id,
    // so this should not happen given the existing onDelete rules. Never
    // fabricate content if it does.
    return { ok: false, reason: mode === "DRAFT" ? "NO_DRAFT_REVISION" : "NO_PUBLISHED_REVISION" };
  }

  // A YouTube video's title/description/duration are included as source
  // data regardless of whether it has a public page yet (6H-1 §3A) — the
  // public slug below is a convenience reference only, never a gate on
  // inclusion.
  const youtubeVideoIds = Array.from(
    new Set(
      revision.mediaResources
        .filter((media) => media.provider === "YOUTUBE" && media.youtubeVideoId !== null)
        .map((media) => media.youtubeVideoId as string)
    )
  );
  const publicVideoPages = await findPublicVideoPagesByYouTubeVideoIds(youtubeVideoIds);
  const publicSlugByVideoId = new Map(publicVideoPages.map((result) => [result.youtubeVideo.id, result.page.slug]));

  const collectionLinks = await prisma.collectionRecording.findMany({
    where: { recordingId },
    select: { collectionId: true },
  });
  const collections = await findPublicCollectionsByIds(collectionLinks.map((link) => link.collectionId));
  const learningGuides = await listPublicLearningGuidesForRecording(recordingId);

  // Provenance: Recording + each attached Work + each Work's Composer —
  // the only three entity types Source/RightsInformation support
  // (modules/mmke/provenance/provenanceEntityType.ts, unchanged, not
  // widened in this phase). Sources are read via listApprovedSourcesForEntity
  // (Phase 6H-8) — an UNREVIEWED/REJECTED/DISABLED Source, and its Citation
  // content, must never reach the AI gateway; RightsInformation has no
  // approval concept and is unaffected.
  const composerIds = dedupeById(revision.works.map((link) => link.musicalWork.composer)).map((c) => c.id);
  const workIds = revision.works.map((link) => link.musicalWorkId);

  const [recordingSources, workSources, composerSources, recordingRights, workRights, composerRights] = await Promise.all([
    listApprovedSourcesForEntity("RECORDING", recordingId),
    Promise.all(workIds.map((id) => listApprovedSourcesForEntity("WORK", id))).then((lists) => lists.flat()),
    Promise.all(composerIds.map((id) => listApprovedSourcesForEntity("COMPOSER", id))).then((lists) => lists.flat()),
    listRightsForEntity("RECORDING", recordingId),
    Promise.all(workIds.map((id) => listRightsForEntity("WORK", id))).then((lists) => lists.flat()),
    Promise.all(composerIds.map((id) => listRightsForEntity("COMPOSER", id))).then((lists) => lists.flat()),
  ]);

  // Phase 6H-8 — Evidence Normalization: fetch each APPROVED source's
  // current Citation content through the Source Retrieval Adapter (never a
  // direct Prisma read for this part — see sourceRetrievalAdapter.ts). A
  // retrieval failure (defensive only; the adapter re-checks approval
  // itself) degrades to "no citation text for this source" rather than
  // failing the whole context — the Source's own metadata is still
  // included, and a source with no evidence text is simply weaker evidence,
  // not a broken request.
  const allApprovedSourceLinks = [...recordingSources, ...workSources, ...composerSources];
  const uniqueApprovedSourceIds = Array.from(new Set(allApprovedSourceLinks.map((link) => link.sourceId)));
  const retrievalResults = await Promise.all(
    uniqueApprovedSourceIds.map((sourceId) => sourceRetrievalAdapter.retrieve({ sourceId }))
  );
  const citationsBySourceId = new Map<string, { id: string; text: string | null }[]>();
  for (const result of retrievalResults) {
    if (result.ok) {
      citationsBySourceId.set(result.sourceId, result.citations);
    }
  }
  const withRetrievedCitations = <T extends { source: { id: string } }>(links: T[]) =>
    links.map((link) => ({ ...link, source: { ...link.source, citations: citationsBySourceId.get(link.source.id) ?? [] } }));

  const participantCount =
    (revision.performance?.performers.length ?? 0) +
    (revision.performance?.choirs.length ?? 0) +
    (revision.performance?.conductors.length ?? 0);
  const hasPrimaryVideo = revision.mediaResources.some((media) => media.role === "PRIMARY_VIDEO");

  // Reuses the existing pure completeness checker directly (never a second
  // completeness system, brief Step 7) — Venue is a required, non-nullable
  // field on Performance, so "hasVenue" is equivalent to "hasPerformance."
  const completenessReport = checkRecordingRevisionCompleteness({
    title: revision.title,
    linkedWorkCount: revision.works.length,
    hasPerformance: revision.performance !== null,
    hasVenue: revision.performance !== null,
    participantCount,
    hasPrimaryVideo,
    hasEducationalContent: Boolean(revision.educationalListeningGuide || revision.educationalAnalysis),
    hasSeoMetaTitle: Boolean(revision.seoMetaTitle),
  });

  const context = assembleRecordingContext({
    recording: { id: recording.id, slug: recording.slug, status: recording.status },
    revision,
    mode,
    publicSlugByVideoId,
    collections,
    learningGuides,
    sources: withRetrievedCitations(allApprovedSourceLinks),
    rights: [...recordingRights, ...workRights, ...composerRights],
    completenessReport,
    readiness: computeRecordingReadiness(completenessReport),
  });

  return { ok: true, context };
}
