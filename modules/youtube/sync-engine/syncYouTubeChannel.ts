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

/** Phase 6J-5 — absence flagging is refused when it would flag more than this share of a catalogue of at least this size in one pass. */
const ABSENCE_GUARD_MIN_CATALOGUE = 10;
const ABSENCE_GUARD_MAX_FRACTION = 0.5;

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

// What YouTube said the channel holds versus what this pass could actually
// see. `statistics.videoCount` counts the channel's PUBLIC videos; an API key
// cannot see private videos and unlisted ones are not in the uploads playlist
// for a key, so a mismatch is information for the operator, never a reason to
// flag or delete anything, and a match is not proof nothing is hidden.
export interface YouTubeSyncReconciliation {
  status: "MATCH" | "MISMATCH" | "UNAVAILABLE";
  /** channels.list statistics.videoCount, or null if YouTube did not report it. */
  reportedVideoCount: number | null;
  /** Distinct video IDs seen in the uploads playlist. */
  uploadsVideoIds: number;
  /** Distinct video IDs seen in the uploads playlist that videos.list returned with privacyStatus "public". */
  uploadsPublicVideos: number;
  /** Distinct video IDs seen anywhere (uploads + every playlist). */
  observedVideoIds: number;
  /** Of those, how many videos.list returned at all. */
  resolvedVideos: number;
  /** reportedVideoCount - uploadsPublicVideos (null when UNAVAILABLE). */
  difference: number | null;
  note: string;
}

export interface YouTubeSyncResult {
  completeness: "FULL" | "PARTIAL";
  /**
   * True only when the pass observed its whole scope (uploads, every
   * playlist, videos.list) and so was allowed to flag previously-known
   * videos as not observed. A partial pass never flags absence.
   */
  videoAbsenceEvaluated: boolean;
  reconciliation: YouTubeSyncReconciliation | null;
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
    videoAbsenceEvaluated: false,
    reconciliation: null,
    videos: emptyCounts(),
    playlists: emptyCounts(),
    playlistItems: emptyCounts(),
    conflictsDetected: 0,
    recordsFailed: 0,
    errors: [],
  };

  // Step 1: channel -> uploads playlist id.
  let uploadsPlaylistId: string;
  let reportedVideoCount: number | null = null;
  try {
    const channel = await adapter.getChannel(options.channelId);
    uploadsPlaylistId = channel.uploadsPlaylistId;
    reportedVideoCount = channel.videoCount ?? null;
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

  result.reconciliation = buildReconciliation(reportedVideoCount, uploadsItems.items, allVideoIds, videos);

  // Step 6: reconcile every observed video, keyed by its immutable YouTube video ID — never title/description/thumbnail/date (brief §12).
  const videoInternalIdByYoutubeId = new Map<string, string>();
  for (const video of videos) {
    const internalId = await syncVideo(repo, video, options.now, result);
    videoInternalIdByYoutubeId.set(video.videoId, internalId);
  }
  result.videos.discovered = videos.length;

  // Step 7: flag videos previously known but not observed — only when this pass observed its WHOLE scope
  // (a failed playlist page means a video that lives only in that playlist was never looked for, so its
  // absence proves nothing). Never delete, never escalate (ADR §15).
  if (result.completeness === "FULL") {
    const existingVideos = await repo.listVideoIdentities();
    const observedVideoInternalIds = new Set(videoInternalIdByYoutubeId.values());
    const toFlag = existingVideos.filter((existing) => !observedVideoInternalIds.has(existing.id) && computeObservabilityUpdate(existing.observabilityState, false).changed);
    const previouslyObserved = existingVideos.filter((existing) => existing.observabilityState === "OBSERVED").length;

    // Phase 6J-5 — implausibility guard. Every list was read "completely", but a successful-yet-empty or
    // truncated response would otherwise flag the whole catalogue. Observing NOTHING while videos are known,
    // or losing more than half of a sizeable catalogue in one pass, is treated as a bad pass: nothing is
    // flagged, the run is PARTIAL, and the operator investigates (a re-run is safe; videos that really
    // vanished are flagged on the next clean pass).
    const implausible =
      toFlag.length > 0 &&
      (observedVideoInternalIds.size === 0 ||
        (previouslyObserved >= ABSENCE_GUARD_MIN_CATALOGUE && toFlag.length / previouslyObserved > ABSENCE_GUARD_MAX_FRACTION));
    if (implausible) {
      result.videoAbsenceEvaluated = false;
      result.completeness = "PARTIAL";
      result.errors.push({
        phase: "absenceFlagging",
        message: `Refused to flag ${toFlag.length} of ${previouslyObserved} previously observed videos as not observed: that is implausible for one pass and looks like an incomplete YouTube response. Nothing was flagged. Investigate, then re-run.`,
      });
    } else {
      result.videoAbsenceEvaluated = true;
      for (const existing of toFlag) {
        const update = computeObservabilityUpdate(existing.observabilityState, false);
        await repo.setVideoObservability(existing.id, update.nextState, "Not observed in the current full YouTube Data API synchronization pass.");
        result.videos.flagged++;
      }
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

  // A pass that could not process every record it found is not a complete pass, whatever else went right.
  if (result.recordsFailed > 0) result.completeness = "PARTIAL";

  return result;
}

function buildReconciliation(
  reportedVideoCount: number | null,
  uploadsItems: YouTubePlaylistItemRecord[],
  allVideoIds: Set<string>,
  videos: YouTubeVideoRecord[]
): YouTubeSyncReconciliation {
  const uploadsIds = new Set(uploadsItems.map((item) => item.videoId));
  const privacyById = new Map(videos.map((video) => [video.videoId, video.privacyStatus]));
  let uploadsPublicVideos = 0;
  for (const id of uploadsIds) if (privacyById.get(id) === "public") uploadsPublicVideos++;

  const base = { reportedVideoCount, uploadsVideoIds: uploadsIds.size, uploadsPublicVideos, observedVideoIds: allVideoIds.size, resolvedVideos: videos.length };
  if (reportedVideoCount === null) {
    return { ...base, status: "UNAVAILABLE", difference: null, note: "YouTube did not report a channel video count, so the pass cannot be reconciled against it." };
  }
  const difference = reportedVideoCount - uploadsPublicVideos;
  if (difference === 0) {
    return { ...base, status: "MATCH", difference, note: "The channel's reported public video count equals the public videos this pass saw in the uploads playlist." };
  }
  return {
    ...base,
    status: "MISMATCH",
    difference,
    note:
      "The channel's reported public video count differs from the public videos this pass saw. Private videos are invisible to an API key and some videos may be unresolved; investigate before treating the catalogue as complete.",
  };
}

async function syncVideo(
  repo: YouTubeSyncRepositoryPort,
  video: YouTubeVideoRecord,
  now: Date,
  result: YouTubeSyncResult
): Promise<string> {
  const identity = await repo.ensureVideoIdentity(video.videoId);
  const resourceId = identity.id;

  // Phase 6J-5 — a video that this pass observed is OBSERVED. Without this, a video wrongly or temporarily
  // flagged NOT_OBSERVED could never come back: the public gate and Recording intake both require OBSERVED.
  const observability = computeObservabilityUpdate(identity.observabilityState, true);
  if (observability.changed) {
    await repo.setVideoObservability(resourceId, observability.nextState, "Observed again in this full YouTube Data API synchronization pass.");
  }
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

  // Phase 6J-5 — as for videos: an observed playlist is OBSERVED again.
  const observability = computeObservabilityUpdate(identity.observabilityState, true);
  if (observability.changed) {
    await repo.setPlaylistObservability(resourceId, observability.nextState, "Observed again in this full YouTube Data API synchronization pass.");
  }
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
