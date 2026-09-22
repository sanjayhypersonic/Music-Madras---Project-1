import { prisma } from "../client";
import type { ObservabilityState, Prisma, VideoPageStatus, YouTubeVideo } from "@prisma/client";

// YouTubeVideo persistence (Phase 6F). This module never decides *what*
// to write — that judgment (whether an editorially-owned field is safe to
// overwrite, what the observability state should become) belongs to
// modules/youtube/sync-engine. It only knows how to identify a video by
// its immutable YouTube ID and persist whatever fields it is told to.
//
// Split into "ensure identity" (idempotent, keyed only by youtubeVideoId
// — a video's real, stable identity per the Phase 6F brief) and "update
// fields" (a plain field-level write) so the sync engine can resolve
// field-ownership *after* knowing the row's internal id but *before*
// deciding which fields are safe to write.

export interface YouTubeVideoIdentity {
  id: string;
  youtubeVideoId: string;
  observabilityState: ObservabilityState;
}

export async function ensureYouTubeVideoIdentity(
  youtubeVideoId: string
): Promise<{ id: string; isNew: boolean; observabilityState: ObservabilityState }> {
  const existing = await prisma.youTubeVideo.findUnique({
    where: { youtubeVideoId },
    select: { id: true, observabilityState: true },
  });
  if (existing) {
    return { id: existing.id, isNew: false, observabilityState: existing.observabilityState };
  }

  const created = await prisma.youTubeVideo.create({
    data: { youtubeVideoId },
    select: { id: true, observabilityState: true },
  });
  return { id: created.id, isNew: true, observabilityState: created.observabilityState };
}

export function updateYouTubeVideoFields(
  id: string,
  fields: Prisma.YouTubeVideoUncheckedUpdateInput
): Promise<YouTubeVideo> {
  return prisma.youTubeVideo.update({ where: { id }, data: fields });
}

export function findYouTubeVideoByYoutubeId(youtubeVideoId: string): Promise<YouTubeVideo | null> {
  return prisma.youTubeVideo.findUnique({ where: { youtubeVideoId } });
}

export function listYouTubeVideoIdentities(): Promise<YouTubeVideoIdentity[]> {
  return prisma.youTubeVideo.findMany({
    select: { id: true, youtubeVideoId: true, observabilityState: true },
  });
}

export function setYouTubeVideoObservability(id: string, state: ObservabilityState): Promise<YouTubeVideo> {
  return prisma.youTubeVideo.update({ where: { id }, data: { observabilityState: state } });
}

// Phase 6G-1C — Studio-facing reads only, added because nothing before now
// needed a full-field list or an id lookup of YouTubeVideo. Both are pure
// reads; neither writes anything, and neither is used by the sync engine.

export function findYouTubeVideoById(id: string): Promise<YouTubeVideo | null> {
  return prisma.youTubeVideo.findUnique({ where: { id } });
}

export interface YouTubeVideoCataloguePageSummary {
  id: string;
  slug: string;
  status: VideoPageStatus;
  archivedAt: Date | null;
}

export interface YouTubeVideoForStudioCatalogue {
  id: string;
  youtubeVideoId: string;
  title: string | null;
  thumbnailUrl: string | null;
  publishedAt: Date | null;
  durationSeconds: number | null;
  privacyStatus: string | null;
  observabilityState: ObservabilityState;
  currentViewCount: number | null;
  currentLikeCount: number | null;
  currentCommentCount: number | null;
  videoPage: YouTubeVideoCataloguePageSummary | null;
}

/**
 * The Studio video catalogue list (Phase 6G-1C) — every synchronized
 * video plus, where one exists, a summary of its YouTubeVideoPage. This
 * is an internal Studio view: it deliberately does not apply the public
 * visibility gate (modules/mmke/catalogue/isYouTubeVideoPagePublic) —
 * unlisted/private videos are shown here on purpose, per the brief.
 */
export function listYouTubeVideosForStudioCatalogue(): Promise<YouTubeVideoForStudioCatalogue[]> {
  return prisma.youTubeVideo.findMany({
    select: {
      id: true,
      youtubeVideoId: true,
      title: true,
      thumbnailUrl: true,
      publishedAt: true,
      durationSeconds: true,
      privacyStatus: true,
      observabilityState: true,
      currentViewCount: true,
      currentLikeCount: true,
      currentCommentCount: true,
      videoPage: { select: { id: true, slug: true, status: true, archivedAt: true } },
    },
    orderBy: { publishedAt: "desc" },
  });
}
