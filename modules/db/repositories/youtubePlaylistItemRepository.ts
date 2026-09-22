import { prisma } from "../client";
import type { ObservabilityState, YouTubePlaylistItem } from "@prisma/client";

// YouTubePlaylistItem persistence (Phase 6F). Identity here is the
// `[playlistId, youtubeVideoId]` pair (both internal MMKE row ids, per the
// schema's own unique constraint) — a video may appear in at most one
// item row per playlist, matching both the schema constraint and reality
// (YouTube doesn't offer duplicate entries of the same video within one
// playlist). `position` is the one field this table has that
// FieldOwnership actually tracks (ADR §16.1); membership itself
// (existence of the row) is a create/observability concern, not a field.

export interface YouTubePlaylistItemIdentity {
  id: string;
  youtubeVideoId: string;
  position: number;
  observabilityState: ObservabilityState;
}

export async function ensureYouTubePlaylistItem(
  playlistId: string,
  youtubeVideoId: string
): Promise<{ id: string; isNew: boolean; position: number; observabilityState: ObservabilityState }> {
  const existing = await prisma.youTubePlaylistItem.findUnique({
    where: { playlistId_youtubeVideoId: { playlistId, youtubeVideoId } },
    select: { id: true, position: true, observabilityState: true },
  });
  if (existing) {
    return { id: existing.id, isNew: false, position: existing.position, observabilityState: existing.observabilityState };
  }

  const created = await prisma.youTubePlaylistItem.create({
    data: { playlistId, youtubeVideoId, position: 0 },
    select: { id: true, position: true, observabilityState: true },
  });
  return { id: created.id, isNew: true, position: created.position, observabilityState: created.observabilityState };
}

export function updateYouTubePlaylistItemFields(
  id: string,
  fields: { position?: number; etag?: string | null }
): Promise<YouTubePlaylistItem> {
  return prisma.youTubePlaylistItem.update({ where: { id }, data: fields });
}

export function listYouTubePlaylistItemIdentities(playlistId: string): Promise<YouTubePlaylistItemIdentity[]> {
  return prisma.youTubePlaylistItem.findMany({
    where: { playlistId },
    select: { id: true, youtubeVideoId: true, position: true, observabilityState: true },
  });
}

export function setYouTubePlaylistItemObservability(id: string, state: ObservabilityState): Promise<YouTubePlaylistItem> {
  return prisma.youTubePlaylistItem.update({ where: { id }, data: { observabilityState: state } });
}
