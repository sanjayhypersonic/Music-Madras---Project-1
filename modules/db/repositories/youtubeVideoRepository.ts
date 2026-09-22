import { prisma } from "../client";
import type { ObservabilityState, Prisma, YouTubeVideo } from "@prisma/client";

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
