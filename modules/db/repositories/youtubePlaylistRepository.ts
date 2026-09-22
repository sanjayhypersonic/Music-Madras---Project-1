import { prisma } from "../client";
import type { ObservabilityState, Prisma, YouTubePlaylist } from "@prisma/client";

// YouTubePlaylist persistence (Phase 6F) — mirrors youtubeVideoRepository.ts
// exactly: identity is the immutable youtubePlaylistId, field writes are a
// separate step the sync engine drives after resolving field ownership.

export interface YouTubePlaylistIdentity {
  id: string;
  youtubePlaylistId: string;
  observabilityState: ObservabilityState;
}

export async function ensureYouTubePlaylistIdentity(
  youtubePlaylistId: string
): Promise<{ id: string; isNew: boolean; observabilityState: ObservabilityState }> {
  const existing = await prisma.youTubePlaylist.findUnique({
    where: { youtubePlaylistId },
    select: { id: true, observabilityState: true },
  });
  if (existing) {
    return { id: existing.id, isNew: false, observabilityState: existing.observabilityState };
  }

  const created = await prisma.youTubePlaylist.create({
    data: { youtubePlaylistId },
    select: { id: true, observabilityState: true },
  });
  return { id: created.id, isNew: true, observabilityState: created.observabilityState };
}

export function updateYouTubePlaylistFields(
  id: string,
  fields: Prisma.YouTubePlaylistUncheckedUpdateInput
): Promise<YouTubePlaylist> {
  return prisma.youTubePlaylist.update({ where: { id }, data: fields });
}

export function findYouTubePlaylistByYoutubeId(youtubePlaylistId: string): Promise<YouTubePlaylist | null> {
  return prisma.youTubePlaylist.findUnique({ where: { youtubePlaylistId } });
}

export function listYouTubePlaylistIdentities(): Promise<YouTubePlaylistIdentity[]> {
  return prisma.youTubePlaylist.findMany({
    select: { id: true, youtubePlaylistId: true, observabilityState: true },
  });
}

export function setYouTubePlaylistObservability(id: string, state: ObservabilityState): Promise<YouTubePlaylist> {
  return prisma.youTubePlaylist.update({ where: { id }, data: { observabilityState: state } });
}
