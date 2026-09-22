import type { YouTubeDataAdapter, YouTubePlaylistItemRecord, YouTubePlaylistRecord, YouTubeVideoRecord } from "../adapter";
import { parseIso8601Duration } from "./parseIso8601Duration";
import { selectBestThumbnail } from "./selectBestThumbnail";
import { computeObservabilityUpdate } from "../availability/computeObservabilityUpdate";
import type { FieldOwnershipState, ObservabilityState } from "@prisma/client";

// The pure reconciliation engine behind the Phase 6F initial (and every
// future incremental) YouTube -> MMKE synchronization. Mirrors
// modules/analytics/youtube/runYouTubeAnalyticsSync.ts's own shape
// exactly: both the adapter and the repository are injected as
// interfaces, so this file has no dependency on Prisma or the network and
// is fully exercised in tests against fakes. The concrete repository
// implementation (composing modules/db/repositories/{youtubeVideo,
// youtubePlaylist,youtubePlaylistItem,fieldOwnership,syncConflict,
// observabilityTransition}Repository.ts) lives in
// modules/db/repositories/youtubeSyncRepository.ts; SyncJobRun/
// SyncCheckpoint bookkeeping is the Job layer's job (ADR §12), not this
// Service's — see modules/jobs/youtubeSyncJob.ts.
//
// Architectural boundary this engine enforces by construction (Phase 6F
// brief §2, §13, §14): it only ever writes YouTubeVideo, YouTubePlaylist,
// and YouTubePlaylistItem rows — never MediaResource, Recording, or
// Collection. "A YouTube object exists" and "Music Madras has catalogued
// it" are deliberately kept distinct; nothing here infers the latter from
// the former.

export interface FieldOwnershipSnapshot {
  ownership: FieldOwnershipState;
  lastExternalValue: string | null;
  lastEditorialValue: string | null;
}

export interface EntityIdentityResult {
  id: string;
  isNew: boolean;
  observabilityState: ObservabilityState;
}

export interface YouTubeSyncRepositoryPort {
  ensureVideoIdentity(youtubeVideoId: string): Promise<EntityIdentityResult>;
  getVideoSnapshot(id: string): Promise<Record<string, unknown> | null>;
  updateVideoFields(id: string, fields: Record<string, unknown>): Promise<void>;
  listVideoIdentities(): Promise<{ id: string; youtubeVideoId: string; observabilityState: ObservabilityState }[]>;
  setVideoObservability(id: string, state: ObservabilityState, reason: string): Promise<void>;

  ensurePlaylistIdentity(youtubePlaylistId: string): Promise<EntityIdentityResult>;
  getPlaylistSnapshot(id: string): Promise<Record<string, unknown> | null>;
  updatePlaylistFields(id: string, fields: Record<string, unknown>): Promise<void>;
  listPlaylistIdentities(): Promise<{ id: string; youtubePlaylistId: string; observabilityState: ObservabilityState }[]>;
  setPlaylistObservability(id: string, state: ObservabilityState, reason: string): Promise<void>;

  ensurePlaylistItem(playlistId: string, videoId: string): Promise<{ id: string; isNew: boolean; position: number; observabilityState: ObservabilityState }>;
  updatePlaylistItemFields(id: string, fields: { position?: number; etag?: string | null }): Promise<void>;
  listPlaylistItemIdentities(playlistId: string): Promise<{ id: string; youtubeVideoId: string; position: number; observabilityState: ObservabilityState }[]>;
  setPlaylistItemObservability(id: string, state: ObservabilityState, reason: string): Promise<void>;

  getFieldOwnership(resourceType: "YOUTUBE_VIDEO" | "YOUTUBE_PLAYLIST" | "YOUTUBE_PLAYLIST_ITEM", resourceId: string, fieldName: string): Promise<FieldOwnershipSnapshot | null>;
  recordExternalFieldValue(resourceType: "YOUTUBE_VIDEO" | "YOUTUBE_PLAYLIST" | "YOUTUBE_PLAYLIST_ITEM", resourceId: string, fieldName: string, externalValue: string | null, observedAt: Date): Promise<void>;
  createSyncConflict(input: {
    resourceType: "YOUTUBE_VIDEO" | "YOUTUBE_PLAYLIST" | "YOUTUBE_PLAYLIST_ITEM";
    resourceId: string;
    fieldName: string;
    ownershipAtDetection: FieldOwnershipState;
    previousMusicMadrasValue: string | null;
    newProviderValue: string | null;
  }): Promise<void>;

  upsertCheckpoint(scopeKey: string, resourceType: "YOUTUBE_VIDEO" | "YOUTUBE_PLAYLIST" | "YOUTUBE_PLAYLIST_ITEM", input: { pageToken: string | null; completeness: "FULL" | "PARTIAL"; lastFullCompletionAt?: Date }): Promise<void>;
}

export interface RunYouTubeSyncOptions {
  channelId: string;
  now: Date;
  /** Safety valve against a runaway pagination loop (e.g. a misbehaving fake adapter in tests); real channels never approach this. */
  maxPagesPerList?: number;
}

export interface YouTubeSyncResourceCounts {
  discovered: number;
  created: number;
  updated: number;
  unchanged: number;
  flagged: number;
}

function emptyCounts(): YouTubeSyncResourceCounts {
  return { discovered: 0, created: 0, updated: 0, unchanged: 0, flagged: 0 };
}

export interface YouTubeSyncResult {
  completeness: "FULL" | "PARTIAL";
  videos: YouTubeSyncResourceCounts;
  playlists: YouTubeSyncResourceCounts;
  playlistItems: YouTubeSyncResourceCounts;
  conflictsDetected: number;
  recordsFailed: number;
  errors: { phase: string; message: string }[];
}

const MAX_PAGES_DEFAULT = 1000;

export async function runYouTubeSync(
  adapter: YouTubeDataAdapter,
  repo: YouTubeSyncRepositoryPort,
  options: RunYouTubeSyncOptions
): Promise<YouTubeSyncResult> {
  const maxPages = options.maxPagesPerList ?? MAX_PAGES_DEFAULT;
  const result: YouTubeSyncResult = {
    completeness: "FULL",
    videos: emptyCounts(),
    playlists: emptyCounts(),
    playlistItems: emptyCounts(),
    conflictsDetected: 0,
    recordsFailed: 0,
    errors: [],
  };

  // Step 1: channel -> uploads playlist id.
  let uploadsPlaylistId: string;
  try {
    const channel = await adapter.getChannel(options.channelId);
    uploadsPlaylistId = channel.uploadsPlaylistId;
  } catch (err) {
    result.completeness = "PARTIAL";
    result.errors.push({ phase: "getChannel", message: describeError(err) });
    return result;
  }

  // Step 2: full pagination of the uploads playlist -> the set of video IDs Music Madras actually publishes.
  const uploadsItems = await paginateFully(
    (pageToken) => adapter.listPlaylistItems(uploadsPlaylistId, pageToken),
    maxPages
  );
  if (!uploadsItems.ok) {
    result.completeness = "PARTIAL";
    result.errors.push({ phase: "listPlaylistItems(uploads)", message: uploadsItems.message });
    await repo.upsertCheckpoint("channel-uploads", "YOUTUBE_PLAYLIST_ITEM", { pageToken: null, completeness: "PARTIAL" });
    return result;
  }
  await repo.upsertCheckpoint("channel-uploads", "YOUTUBE_PLAYLIST_ITEM", {
    pageToken: null,
    completeness: "FULL",
    lastFullCompletionAt: options.now,
  });

  // Step 3: full pagination of the channel's playlists.
  const playlistsPage = await paginateFully((pageToken) => adapter.listPlaylists(options.channelId, pageToken), maxPages);
  if (!playlistsPage.ok) {
    result.completeness = "PARTIAL";
    result.errors.push({ phase: "listPlaylists", message: playlistsPage.message });
    await repo.upsertCheckpoint("channel-playlists", "YOUTUBE_PLAYLIST", { pageToken: null, completeness: "PARTIAL" });
    return result;
  }
  await repo.upsertCheckpoint("channel-playlists", "YOUTUBE_PLAYLIST", {
    pageToken: null,
    completeness: "FULL",
    lastFullCompletionAt: options.now,
  });

  // Step 4: full pagination of every playlist's own membership.
  const playlistMemberships = new Map<string, YouTubePlaylistItemRecord[]>();
  for (const playlist of playlistsPage.items) {
    const membership = await paginateFully((pageToken) => adapter.listPlaylistItems(playlist.playlistId, pageToken), maxPages);
    if (!membership.ok) {
      result.completeness = "PARTIAL";
      result.errors.push({ phase: `listPlaylistItems(${playlist.playlistId})`, message: membership.message });
      await repo.upsertCheckpoint(playlist.playlistId, "YOUTUBE_PLAYLIST_ITEM", { pageToken: null, completeness: "PARTIAL" });
      continue;
    }
    playlistMemberships.set(playlist.playlistId, membership.items);
    await repo.upsertCheckpoint(playlist.playlistId, "YOUTUBE_PLAYLIST_ITEM", {
      pageToken: null,
      completeness: "FULL",
      lastFullCompletionAt: options.now,
    });
  }

  // Step 5: union of every video ID this pass actually observed (uploads + every playlist's membership),
  // never assuming playlist membership is a subset of uploads (brief §7/§11).
  const allVideoIds = new Set<string>();
  for (const item of uploadsItems.items) allVideoIds.add(item.videoId);
  for (const items of playlistMemberships.values()) {
    for (const item of items) allVideoIds.add(item.videoId);
  }

  let videos: YouTubeVideoRecord[];
  try {
    videos = await adapter.listVideos(Array.from(allVideoIds));
  } catch (err) {
    result.completeness = "PARTIAL";
    result.errors.push({ phase: "listVideos", message: describeError(err) });
    return result;
  }

  // Step 6: reconcile every observed video, keyed by its immutable YouTube video ID — never title/description/thumbnail/date (brief §12).
  const videoInternalIdByYoutubeId = new Map<string, string>();
  for (const video of videos) {
    const internalId = await syncVideo(repo, video, options.now, result);
    videoInternalIdByYoutubeId.set(video.videoId, internalId);
  }
  result.videos.discovered = videos.length;

  // Step 7: flag videos previously known but not observed in this FULL pass — never delete, never escalate (ADR §15).
  const existingVideos = await repo.listVideoIdentities();
  const observedVideoInternalIds = new Set(videoInternalIdByYoutubeId.values());
  for (const existing of existingVideos) {
    if (observedVideoInternalIds.has(existing.id)) continue;
    const update = computeObservabilityUpdate(existing.observabilityState, false);
    if (update.changed) {
      await repo.setVideoObservability(existing.id, update.nextState, "Not observed in the current full YouTube Data API synchronization pass.");
      result.videos.flagged++;
    }
  }

  // Step 8: reconcile every observed playlist.
  const playlistInternalIdByYoutubeId = new Map<string, string>();
  for (const playlist of playlistsPage.items) {
    const internalId = await syncPlaylist(repo, playlist, options.now, result);
    playlistInternalIdByYoutubeId.set(playlist.playlistId, internalId);
  }
  result.playlists.discovered = playlistsPage.items.length;

  const existingPlaylists = await repo.listPlaylistIdentities();
  const observedPlaylistInternalIds = new Set(playlistInternalIdByYoutubeId.values());
  for (const existing of existingPlaylists) {
    if (observedPlaylistInternalIds.has(existing.id)) continue;
    const update = computeObservabilityUpdate(existing.observabilityState, false);
    if (update.changed) {
      await repo.setPlaylistObservability(existing.id, update.nextState, "Not observed in the current full YouTube Data API synchronization pass.");
      result.playlists.flagged++;
    }
  }

  // Step 9: reconcile playlist membership (position, multi-membership, removal detection) per playlist.
  for (const playlist of playlistsPage.items) {
    const playlistInternalId = playlistInternalIdByYoutubeId.get(playlist.playlistId);
    const items = playlistMemberships.get(playlist.playlistId);
    if (!playlistInternalId || !items) continue;

    const observedVideoInternalIdsForPlaylist = new Set<string>();
    for (const item of items) {
      const videoInternalId = videoInternalIdByYoutubeId.get(item.videoId);
      if (!videoInternalId) {
        // The video was referenced by playlistItems.list but never resolved by videos.list
        // (e.g. removed between the two calls) — record as a failure, never fabricate a row.
        result.recordsFailed++;
        result.errors.push({
          phase: `playlistItem(${playlist.playlistId}/${item.videoId})`,
          message: "Referenced video could not be resolved via videos.list.",
        });
        continue;
      }
      observedVideoInternalIdsForPlaylist.add(videoInternalId);
      await syncPlaylistItem(repo, playlistInternalId, videoInternalId, item, options.now, result);
    }
    result.playlistItems.discovered += observedVideoInternalIdsForPlaylist.size;

    const existingItems = await repo.listPlaylistItemIdentities(playlistInternalId);
    for (const existing of existingItems) {
      if (observedVideoInternalIdsForPlaylist.has(existing.youtubeVideoId)) continue;
      const update = computeObservabilityUpdate(existing.observabilityState, false);
      if (update.changed) {
        await repo.setPlaylistItemObservability(existing.id, update.nextState, "Video no longer present in this playlist's current full membership pass.");
        result.playlistItems.flagged++;
      }
    }
  }

  return result;
}

async function syncVideo(
  repo: YouTubeSyncRepositoryPort,
  video: YouTubeVideoRecord,
  now: Date,
  result: YouTubeSyncResult
): Promise<string> {
  const identity = await repo.ensureVideoIdentity(video.videoId);
  const resourceId = identity.id;
  const thumbnailUrl = selectBestThumbnail(video.thumbnails);

  const title = await reconcileField(repo, "YOUTUBE_VIDEO", resourceId, "title", video.title, now);
  const description = await reconcileField(repo, "YOUTUBE_VIDEO", resourceId, "description", video.description, now);
  const thumbnail = await reconcileField(repo, "YOUTUBE_VIDEO", resourceId, "thumbnailUrl", thumbnailUrl, now);
  const visibility = await reconcileField(repo, "YOUTUBE_VIDEO", resourceId, "visibilityStatus", video.privacyStatus, now);
  result.conflictsDetected += [title, description, thumbnail, visibility].filter((r) => r.conflictDetected).length;

  const fields: Record<string, unknown> = {
    channelId: video.channelId,
    embeddable: video.embeddable,
    durationSeconds: parseIso8601Duration(video.durationIso8601),
    publishedAt: video.publishedAt ? new Date(video.publishedAt) : null,
    etag: video.etag,
    currentViewCount: parseCount(video.viewCount),
    currentLikeCount: parseCount(video.likeCount),
    currentCommentCount: parseCount(video.commentCount),
  };
  if (title.writable) fields.title = video.title;
  if (description.writable) fields.description = video.description;
  if (thumbnail.writable) fields.thumbnailUrl = thumbnailUrl;
  if (visibility.writable) fields.privacyStatus = video.privacyStatus;

  if (identity.isNew) {
    await repo.updateVideoFields(resourceId, { ...fields, statisticsUpdatedAt: now });
    result.videos.created++;
  } else {
    const snapshot = await repo.getVideoSnapshot(resourceId);
    if (snapshot && !hasAnyDifference(snapshot, fields)) {
      result.videos.unchanged++;
    } else {
      await repo.updateVideoFields(resourceId, { ...fields, statisticsUpdatedAt: now });
      result.videos.updated++;
    }
  }

  return resourceId;
}

async function syncPlaylist(
  repo: YouTubeSyncRepositoryPort,
  playlist: YouTubePlaylistRecord,
  now: Date,
  result: YouTubeSyncResult
): Promise<string> {
  const identity = await repo.ensurePlaylistIdentity(playlist.playlistId);
  const resourceId = identity.id;
  const thumbnailUrl = selectBestThumbnail(playlist.thumbnails);

  const title = await reconcileField(repo, "YOUTUBE_PLAYLIST", resourceId, "title", playlist.title, now);
  const description = await reconcileField(repo, "YOUTUBE_PLAYLIST", resourceId, "description", playlist.description, now);
  const thumbnail = await reconcileField(repo, "YOUTUBE_PLAYLIST", resourceId, "thumbnailUrl", thumbnailUrl, now);
  const visibility = await reconcileField(repo, "YOUTUBE_PLAYLIST", resourceId, "visibilityStatus", playlist.privacyStatus, now);
  result.conflictsDetected += [title, description, thumbnail, visibility].filter((r) => r.conflictDetected).length;

  const fields: Record<string, unknown> = {
    channelId: playlist.channelId,
    publishedAt: playlist.publishedAt ? new Date(playlist.publishedAt) : null,
    etag: playlist.etag,
  };
  if (title.writable) fields.title = playlist.title;
  if (description.writable) fields.description = playlist.description;
  if (thumbnail.writable) fields.thumbnailUrl = thumbnailUrl;
  if (visibility.writable) fields.privacyStatus = playlist.privacyStatus;

  if (identity.isNew) {
    await repo.updatePlaylistFields(resourceId, fields);
    result.playlists.created++;
  } else {
    const snapshot = await repo.getPlaylistSnapshot(resourceId);
    if (snapshot && !hasAnyDifference(snapshot, fields)) {
      result.playlists.unchanged++;
    } else {
      await repo.updatePlaylistFields(resourceId, fields);
      result.playlists.updated++;
    }
  }

  return resourceId;
}

async function syncPlaylistItem(
  repo: YouTubeSyncRepositoryPort,
  playlistInternalId: string,
  videoInternalId: string,
  item: YouTubePlaylistItemRecord,
  now: Date,
  result: YouTubeSyncResult
): Promise<void> {
  const identity = await repo.ensurePlaylistItem(playlistInternalId, videoInternalId);
  const position = await reconcileField(repo, "YOUTUBE_PLAYLIST_ITEM", identity.id, "position", String(item.position), now);
  if (position.conflictDetected) result.conflictsDetected++;

  const observability = computeObservabilityUpdate(identity.observabilityState, true);
  if (observability.changed) {
    await repo.setPlaylistItemObservability(identity.id, observability.nextState, "Observed again in this playlist's current full membership pass.");
  }

  if (identity.isNew) {
    await repo.updatePlaylistItemFields(identity.id, { position: position.writable ? item.position : undefined, etag: item.etag });
    result.playlistItems.created++;
  } else {
    const positionChanged = position.writable && identity.position !== item.position;
    if (!positionChanged) {
      result.playlistItems.unchanged++;
    } else {
      await repo.updatePlaylistItemFields(identity.id, { position: item.position, etag: item.etag });
      result.playlistItems.updated++;
    }
  }
}

async function reconcileField(
  repo: YouTubeSyncRepositoryPort,
  resourceType: "YOUTUBE_VIDEO" | "YOUTUBE_PLAYLIST" | "YOUTUBE_PLAYLIST_ITEM",
  resourceId: string,
  fieldName: string,
  newExternalValue: string | null,
  observedAt: Date
): Promise<{ writable: boolean; conflictDetected: boolean }> {
  const existing = await repo.getFieldOwnership(resourceType, resourceId, fieldName);
  const ownership = existing?.ownership ?? "YOUTUBE_CONTROLLED";
  let conflictDetected = false;

  if (ownership !== "YOUTUBE_CONTROLLED" && existing && existing.lastExternalValue !== newExternalValue) {
    await repo.createSyncConflict({
      resourceType,
      resourceId,
      fieldName,
      ownershipAtDetection: ownership,
      previousMusicMadrasValue: existing.lastEditorialValue,
      newProviderValue: newExternalValue,
    });
    conflictDetected = true;
  }

  await repo.recordExternalFieldValue(resourceType, resourceId, fieldName, newExternalValue, observedAt);

  return { writable: ownership === "YOUTUBE_CONTROLLED", conflictDetected };
}

async function paginateFully<T>(
  fetchPage: (pageToken?: string) => Promise<{ items: T[]; nextPageToken: string | null }>,
  maxPages: number
): Promise<{ ok: true; items: T[] } | { ok: false; message: string }> {
  const items: T[] = [];
  let pageToken: string | undefined;
  let pages = 0;

  try {
    do {
      const page = await fetchPage(pageToken);
      items.push(...page.items);
      pageToken = page.nextPageToken ?? undefined;
      pages++;
      if (pages > maxPages) {
        throw new Error(`Exceeded maxPagesPerList (${maxPages}) — aborting to avoid an unbounded loop.`);
      }
    } while (pageToken);
    return { ok: true, items };
  } catch (err) {
    return { ok: false, message: describeError(err) };
  }
}

function parseCount(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function hasAnyDifference(snapshot: Record<string, unknown>, fields: Record<string, unknown>): boolean {
  for (const [key, value] of Object.entries(fields)) {
    const existingValue = snapshot[key];
    if (existingValue instanceof Date && value instanceof Date) {
      if (existingValue.getTime() !== value.getTime()) return true;
      continue;
    }
    if (existingValue !== value) return true;
  }
  return false;
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
