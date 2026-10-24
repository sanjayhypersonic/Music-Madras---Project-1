import { prisma } from "../client";
import type { ExposureHoldName, VideoExposureFacts } from "../../mmke/catalogue/videoExposure";
import {
  classifyRecordingVisibility,
  countVisibility,
  inView,
  type DraftRevisionFacts,
  type PublishedRevisionFacts,
  type RecordingVisibility,
  type RecordingVisibilityFacts,
  type VisibilityCounts,
  type VisibilityView,
} from "../../mmke/recordingVisibility/recordingVisibility";

// The Studio "Recording public visibility" workspace's loader. READ-ONLY: it contains no create/update/delete, takes no lock and writes no audit entry, and
// opening the page changes nothing. It reads each Recording through its OWN published-revision pointer (never by revision status) and reads the open draft
// only to explain what stops an unpublished Recording from being published. It never reads Sources, Rights or Occasions, so the frozen legacy
// Recording-level relationship rows (entityType "RECORDING") cannot reach it. The rules themselves live in modules/mmke/recordingVisibility (which reuses
// isRecordingPublished, isVideoExposed and the publish gate); this file only gathers facts.
//
// Bounded by design: Recordings are scanned in batches of SCAN_BATCH, newest-updated first, up to SCAN_CAP; the video facts for each batch are ONE query
// (no per-Recording queries). Past the cap the counts say so rather than pretend to be totals.

export const SCAN_BATCH = 250;
/** A technical bound, not a product setting. Past it the workspace reports the counts for the most recently updated Recordings and says so. */
export const SCAN_CAP = 2000;
export const VISIBILITY_PAGE_SIZE = 25;

export interface RecordingVisibilityRow {
  id: string;
  slug: string;
  status: string;
  updatedAt: Date;
  visibility: RecordingVisibility;
}

export interface RecordingVisibilityWorkspace {
  view: VisibilityView;
  counts: VisibilityCounts;
  /** Every Recording in the database. */
  totalRecordings: number;
  /** True when more Recordings exist than were scanned (counts then cover only the most recently updated). */
  truncated: boolean;
  /** Recordings in the chosen view, and the page of them shown. */
  viewTotal: number;
  page: number;
  pageSize: number;
  rows: RecordingVisibilityRow[];
}

const BATCH_SELECT = {
  id: true,
  slug: true,
  status: true,
  updatedAt: true,
  currentPublishedRevisionId: true,
  currentDraftRevisionId: true,
  currentPublishedRevision: {
    select: {
      id: true,
      recordingId: true,
      revisionStatus: true,
      title: true,
      works: { select: { musicalWork: { select: { archivedAt: true, composer: { select: { archivedAt: true } } } } } },
      performance: { select: { archivedAt: true, programme: { select: { archivedAt: true } }, venue: { select: { archivedAt: true } } } },
      mediaResources: { select: { provider: true, youtubeVideoId: true } },
    },
  },
  currentDraftRevision: {
    select: {
      id: true,
      title: true,
      performanceId: true,
      _count: { select: { works: true } },
      mediaResources: { select: { role: true } },
    },
  },
} as const;

type BatchRow = Awaited<ReturnType<typeof loadBatch>>[number];

function loadBatch(skip: number, take: number) {
  return prisma.recording.findMany({ select: BATCH_SELECT, orderBy: [{ updatedAt: "desc" }, { id: "asc" }], skip, take });
}

/** The exposure facts the shared rule needs, for a set of videos, in one query. Same shape youtubeVideoPageRepository feeds isVideoExposed. */
async function loadVideoFacts(videoIds: string[]): Promise<Map<string, VideoExposureFacts>> {
  const facts = new Map<string, VideoExposureFacts>();
  if (videoIds.length === 0) return facts;
  const videos = await prisma.youTubeVideo.findMany({
    where: { id: { in: videoIds } },
    select: {
      id: true,
      privacyStatus: true,
      observabilityState: true,
      exposureReview: { select: { holdReason: true } },
      videoPage: {
        select: {
          status: true,
          archivedAt: true,
          unlistedPublicationApprovedAt: true,
          exposureApprovals: { where: { revokedAt: null }, select: { scope: true, playlistPageId: true } },
        },
      },
    },
  });
  for (const video of videos) {
    facts.set(video.id, {
      page: video.videoPage ? { status: video.videoPage.status, archivedAt: video.videoPage.archivedAt, unlistedPublicationApprovedAt: video.videoPage.unlistedPublicationApprovedAt } : null,
      youtubeVideo: { privacyStatus: video.privacyStatus, observabilityState: video.observabilityState },
      activeApprovals: video.videoPage?.exposureApprovals ?? [],
      hold: (video.exposureReview?.holdReason ?? null) as ExposureHoldName | null,
    });
  }
  return facts;
}

function publishedFacts(row: BatchRow): PublishedRevisionFacts | null {
  const revision = row.currentPublishedRevision;
  if (!revision) return null;
  return {
    id: revision.id,
    recordingId: revision.recordingId,
    revisionStatus: revision.revisionStatus,
    title: revision.title,
    works: revision.works.map((link) => ({ archived: link.musicalWork.archivedAt !== null || link.musicalWork.composer.archivedAt !== null })),
    performance: revision.performance
      ? { archived: revision.performance.archivedAt !== null, programmeArchived: revision.performance.programme.archivedAt !== null, venueArchived: revision.performance.venue.archivedAt !== null }
      : null,
    media: revision.mediaResources.map((media) => ({ provider: media.provider, youtubeVideoId: media.youtubeVideoId })),
  };
}

function draftFacts(row: BatchRow): DraftRevisionFacts | null {
  const draft = row.currentDraftRevision;
  if (!draft) return null;
  return {
    id: draft.id,
    title: draft.title,
    workCount: draft._count.works,
    hasPerformance: draft.performanceId !== null,
    hasPrimaryVideo: draft.mediaResources.some((media) => media.role === "PRIMARY_VIDEO"),
  };
}

/** Scans Recordings (bounded), classifies each with the shared rules, and returns the counts plus one page of the chosen view. */
export async function loadRecordingVisibilityWorkspace(input: { view: VisibilityView; page: number }): Promise<RecordingVisibilityWorkspace> {
  const totalRecordings = await prisma.recording.count();
  const rows: RecordingVisibilityRow[] = [];

  for (let skip = 0; skip < Math.min(totalRecordings, SCAN_CAP); skip += SCAN_BATCH) {
    const batch = await loadBatch(skip, Math.min(SCAN_BATCH, SCAN_CAP - skip));
    if (batch.length === 0) break;
    // Video facts are needed only for what a visitor can currently see: the published revision of a PUBLISHED Recording.
    const videoIds = new Set<string>();
    for (const row of batch) {
      if (row.status !== "PUBLISHED") continue;
      for (const media of row.currentPublishedRevision?.mediaResources ?? []) if (media.provider === "YOUTUBE" && media.youtubeVideoId) videoIds.add(media.youtubeVideoId);
    }
    const videos = await loadVideoFacts([...videoIds]);
    for (const row of batch) {
      const facts: RecordingVisibilityFacts = {
        id: row.id,
        slug: row.slug,
        status: row.status,
        currentPublishedRevisionId: row.currentPublishedRevisionId,
        currentDraftRevisionId: row.currentDraftRevisionId,
        published: publishedFacts(row),
        draft: draftFacts(row),
        videos,
      };
      rows.push({ id: row.id, slug: row.slug, status: row.status, updatedAt: row.updatedAt, visibility: classifyRecordingVisibility(facts) });
    }
  }

  const inChosenView = rows.filter((row) => inView(input.view, row.visibility));
  const pageCount = Math.max(1, Math.ceil(inChosenView.length / VISIBILITY_PAGE_SIZE));
  const page = Math.min(Math.max(1, Math.floor(input.page) || 1), pageCount);
  return {
    view: input.view,
    counts: countVisibility(rows.map((row) => row.visibility)),
    totalRecordings,
    truncated: totalRecordings > rows.length,
    viewTotal: inChosenView.length,
    page,
    pageSize: VISIBILITY_PAGE_SIZE,
    rows: inChosenView.slice((page - 1) * VISIBILITY_PAGE_SIZE, page * VISIBILITY_PAGE_SIZE),
  };
}
