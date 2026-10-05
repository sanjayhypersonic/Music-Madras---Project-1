import { prisma } from "../client";
import type { FieldOwnershipState, Prisma, SyncResourceType } from "@prisma/client";
import type { YouTubeSyncRepositoryPort, FieldOwnershipSnapshot } from "../../youtube/sync-engine/syncYouTubeChannel";
import {
  ensureYouTubeVideoIdentity,
  listYouTubeVideoIdentities,
  setYouTubeVideoObservability,
  updateYouTubeVideoFields,
} from "./youtubeVideoRepository";
import {
  ensureYouTubePlaylistIdentity,
  listYouTubePlaylistIdentities,
  setYouTubePlaylistObservability,
  updateYouTubePlaylistFields,
} from "./youtubePlaylistRepository";
import {
  ensureYouTubePlaylistItem,
  listYouTubePlaylistItemIdentities,
  setYouTubePlaylistItemObservability,
  updateYouTubePlaylistItemFields,
} from "./youtubePlaylistItemRepository";
import { findFieldOwnership, recordExternalFieldValue } from "./fieldOwnershipRepository";
import { createSyncConflict } from "./syncConflictRepository";
import { recordObservabilityTransition } from "./observabilityTransitionRepository";
import { upsertSyncCheckpoint } from "./syncCheckpointRepository";

// The real, Prisma-backed implementation of YouTubeSyncRepositoryPort
// (Phase 6F) — composes the per-table repositories that already exist,
// plus the Phase 6B ownership/conflict/observability/checkpoint
// repositories. This is the only file that knows the sync engine's port
// shape maps onto these specific tables; the engine itself
// (modules/youtube/sync-engine/syncYouTubeChannel.ts) never imports
// Prisma directly.

const VIDEO_SNAPSHOT_FIELDS = [
  "title",
  "description",
  "thumbnailUrl",
  "privacyStatus",
  "channelId",
  "embeddable",
  "durationSeconds",
  "publishedAt",
  "etag",
  "currentViewCount",
  "currentLikeCount",
  "currentCommentCount",
] as const;

const PLAYLIST_SNAPSHOT_FIELDS = ["title", "description", "thumbnailUrl", "privacyStatus", "channelId", "publishedAt", "etag"] as const;

export function buildYouTubeSyncRepository(syncJobRunId: string | null): YouTubeSyncRepositoryPort {
  return {
    async ensureVideoIdentity(youtubeVideoId) {
      return ensureYouTubeVideoIdentity(youtubeVideoId);
    },
    async getVideoSnapshot(id) {
      const row = await prisma.youTubeVideo.findUnique({ where: { id } });
      if (!row) return null;
      return pick(row as unknown as Record<string, unknown>, VIDEO_SNAPSHOT_FIELDS);
    },
    async updateVideoFields(id, fields) {
      await updateYouTubeVideoFields(id, fields as Prisma.YouTubeVideoUncheckedUpdateInput);
    },
    async listVideoIdentities() {
      return listYouTubeVideoIdentities();
    },
    async setVideoObservability(id, state, reason) {
      const before = await prisma.youTubeVideo.findUnique({ where: { id }, select: { observabilityState: true } });
      await setYouTubeVideoObservability(id, state);
      if (before) {
        await recordObservabilityTransition({
          provider: "YOUTUBE",
          resourceType: "YOUTUBE_VIDEO",
          resourceId: id,
          fromState: before.observabilityState,
          toState: state,
          reason,
          syncJobRunId: syncJobRunId ?? undefined,
        });
      }
    },

    async ensurePlaylistIdentity(youtubePlaylistId) {
      return ensureYouTubePlaylistIdentity(youtubePlaylistId);
    },
    async getPlaylistSnapshot(id) {
      const row = await prisma.youTubePlaylist.findUnique({ where: { id } });
      if (!row) return null;
      return pick(row as unknown as Record<string, unknown>, PLAYLIST_SNAPSHOT_FIELDS);
    },
    async updatePlaylistFields(id, fields) {
      await updateYouTubePlaylistFields(id, fields as Prisma.YouTubePlaylistUncheckedUpdateInput);
    },
    async listPlaylistIdentities() {
      return listYouTubePlaylistIdentities();
    },
    async setPlaylistObservability(id, state, reason) {
      const before = await prisma.youTubePlaylist.findUnique({ where: { id }, select: { observabilityState: true } });
      await setYouTubePlaylistObservability(id, state);
      if (before) {
        await recordObservabilityTransition({
          provider: "YOUTUBE",
          resourceType: "YOUTUBE_PLAYLIST",
          resourceId: id,
          fromState: before.observabilityState,
          toState: state,
          reason,
          syncJobRunId: syncJobRunId ?? undefined,
        });
      }
    },

    async ensurePlaylistItem(playlistId, videoId) {
      return ensureYouTubePlaylistItem(playlistId, videoId);
    },
    async updatePlaylistItemFields(id, fields) {
      await updateYouTubePlaylistItemFields(id, fields);
    },
    async listPlaylistItemIdentities(playlistId) {
      return listYouTubePlaylistItemIdentities(playlistId);
    },
    async setPlaylistItemObservability(id, state, reason) {
      const before = await prisma.youTubePlaylistItem.findUnique({ where: { id }, select: { observabilityState: true } });
      await setYouTubePlaylistItemObservability(id, state);
      if (before) {
        await recordObservabilityTransition({
          provider: "YOUTUBE",
          resourceType: "YOUTUBE_PLAYLIST_ITEM",
          resourceId: id,
          fromState: before.observabilityState,
          toState: state,
          reason,
          syncJobRunId: syncJobRunId ?? undefined,
        });
      }
    },

    async getFieldOwnership(resourceType, resourceId, fieldName): Promise<FieldOwnershipSnapshot | null> {
      const row = await findFieldOwnership("YOUTUBE", resourceType as SyncResourceType, resourceId, fieldName);
      if (!row) return null;
      return { ownership: row.ownership as FieldOwnershipState, lastExternalValue: row.lastExternalValue, lastEditorialValue: row.lastEditorialValue };
    },
    async recordExternalFieldValue(resourceType, resourceId, fieldName, externalValue, observedAt) {
      await recordExternalFieldValue({
        provider: "YOUTUBE",
        resourceType: resourceType as SyncResourceType,
        resourceId,
        fieldName,
        externalValue,
        observedAt,
      });
    },
    async createSyncConflict(input) {
      await createSyncConflict({
        provider: "YOUTUBE",
        resourceType: input.resourceType as SyncResourceType,
        resourceId: input.resourceId,
        fieldName: input.fieldName,
        ownershipAtDetection: input.ownershipAtDetection,
        previousMusicMadrasValue: input.previousMusicMadrasValue,
        newProviderValue: input.newProviderValue,
        syncJobRunId: syncJobRunId ?? undefined,
      });
    },

    async upsertCheckpoint(scopeKey, resourceType, input) {
      await upsertSyncCheckpoint({
        provider: "YOUTUBE",
        resourceType: resourceType as SyncResourceType,
        scopeKey,
        pageToken: input.pageToken,
        completeness: input.completeness,
        // Phase 6J-5: a PARTIAL write carries no completion time and must not erase the time of the last FULL one.
        ...(input.lastFullCompletionAt ? { lastFullCompletionAt: input.lastFullCompletionAt } : {}),
        syncJobRunId: syncJobRunId ?? undefined,
      });
    },
  };
}

function pick<T extends readonly string[]>(row: Record<string, unknown>, keys: T): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of keys) result[key] = row[key];
  return result;
}
