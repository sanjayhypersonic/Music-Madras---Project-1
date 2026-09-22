import { YouTubeHttpClient, type YouTubeHttpClientOptions } from "./httpClient";
import { YouTubeProviderError } from "./errors";
import type {
  YouTubeChannelRecord,
  YouTubePageResult,
  YouTubePlaylistItemRecord,
  YouTubePlaylistRecord,
  YouTubeThumbnailSet,
  YouTubeVideoRecord,
} from "./types";

// The typed, read-only YouTube Data API v3 wrapper (Phase 6C, ADR §11,
// §13.1). Implements exactly the four list operations the approved
// reconciliation sequence needs — nothing writes to YouTube, nothing
// writes to Postgres, nothing decides what a result *means* for Music
// Madras. "Here is what YouTube returned" is this module's entire job.

const MAX_RESULTS_PER_PAGE = 50;
// YouTube's documented videos.list batch limit (ADR §13.1: "batch
// videos.list(id=...) calls (up to 50 IDs per call)").
const VIDEOS_LIST_BATCH_SIZE = 50;

export interface YouTubeDataAdapter {
  /** channels.list — the channel's uploads playlist ID (ADR §13.1, step 1). */
  getChannel(channelId: string): Promise<YouTubeChannelRecord>;
  /** playlists.list, one page — enumerate a channel's playlists (ADR §13.1, step 3). */
  listPlaylists(channelId: string, pageToken?: string): Promise<YouTubePageResult<YouTubePlaylistRecord>>;
  /** playlistItems.list, one page — works for the uploads playlist or any other playlist (ADR §13.1, steps 1 and 4). */
  listPlaylistItems(playlistId: string, pageToken?: string): Promise<YouTubePageResult<YouTubePlaylistItemRecord>>;
  /** videos.list, internally batched — accepts any number of IDs (ADR §13.1, step 2). */
  listVideos(videoIds: string[]): Promise<YouTubeVideoRecord[]>;
}

export class YouTubeDataApiAdapter implements YouTubeDataAdapter {
  private readonly http: YouTubeHttpClient;

  constructor(options: YouTubeHttpClientOptions) {
    this.http = new YouTubeHttpClient(options);
  }

  async getChannel(channelId: string): Promise<YouTubeChannelRecord> {
    const result = await this.http.get<YouTubeChannelsListResponse>("channels.list", "channels", {
      part: "snippet,contentDetails",
      id: channelId,
    });
    if (result.notModified) {
      // Unreachable in practice — getChannel never passes ifNoneMatch — kept only so the type checker sees the narrowing handled.
      throw new YouTubeProviderError("UNEXPECTED_RESPONSE", "Unexpected 304 response for channels.list.");
    }

    const item = result.data.items?.[0];
    if (!item) {
      throw new YouTubeProviderError("NOT_FOUND", `No YouTube channel found for id ${channelId}.`, { operation: "channels.list" });
    }

    const uploadsPlaylistId = item.contentDetails?.relatedPlaylists?.uploads;
    if (!uploadsPlaylistId) {
      throw new YouTubeProviderError(
        "UNEXPECTED_RESPONSE",
        `YouTube channel ${channelId} response did not include an uploads playlist ID.`,
        { operation: "channels.list" }
      );
    }

    return {
      channelId: item.id,
      title: item.snippet?.title ?? null,
      uploadsPlaylistId,
      etag: item.etag ?? result.etag,
    };
  }

  async listPlaylists(channelId: string, pageToken?: string): Promise<YouTubePageResult<YouTubePlaylistRecord>> {
    const result = await this.http.get<YouTubePlaylistsListResponse>("playlists.list", "playlists", {
      part: "snippet,status",
      channelId,
      maxResults: MAX_RESULTS_PER_PAGE,
      pageToken,
    });
    if (result.notModified) {
      throw new YouTubeProviderError("UNEXPECTED_RESPONSE", "Unexpected 304 response for playlists.list.");
    }

    const items = (result.data.items ?? []).map(
      (item): YouTubePlaylistRecord => ({
        playlistId: item.id,
        title: item.snippet?.title ?? null,
        description: item.snippet?.description ?? null,
        publishedAt: item.snippet?.publishedAt ?? null,
        privacyStatus: item.status?.privacyStatus ?? null,
        channelId: item.snippet?.channelId ?? null,
        etag: item.etag ?? null,
      })
    );

    return { items, nextPageToken: result.data.nextPageToken ?? null };
  }

  async listPlaylistItems(playlistId: string, pageToken?: string): Promise<YouTubePageResult<YouTubePlaylistItemRecord>> {
    const result = await this.http.get<YouTubePlaylistItemsListResponse>("playlistItems.list", "playlistItems", {
      part: "snippet,contentDetails",
      playlistId,
      maxResults: MAX_RESULTS_PER_PAGE,
      pageToken,
    });
    if (result.notModified) {
      throw new YouTubeProviderError("UNEXPECTED_RESPONSE", "Unexpected 304 response for playlistItems.list.");
    }

    const items = (result.data.items ?? []).map((item): YouTubePlaylistItemRecord => {
      const videoId = item.contentDetails?.videoId ?? item.snippet?.resourceId?.videoId;
      if (!videoId) {
        throw new YouTubeProviderError(
          "UNEXPECTED_RESPONSE",
          `A playlistItems.list item for playlist ${playlistId} did not include a video ID.`,
          { operation: "playlistItems.list" }
        );
      }
      return {
        playlistId,
        videoId,
        position: item.snippet?.position ?? 0,
        title: item.snippet?.title ?? null,
        publishedAt: item.contentDetails?.videoPublishedAt ?? item.snippet?.publishedAt ?? null,
        etag: item.etag ?? null,
      };
    });

    return { items, nextPageToken: result.data.nextPageToken ?? null };
  }

  async listVideos(videoIds: string[]): Promise<YouTubeVideoRecord[]> {
    const batches = chunkArray(dedupePreservingOrder(videoIds), VIDEOS_LIST_BATCH_SIZE);
    const results: YouTubeVideoRecord[] = [];

    for (const batch of batches) {
      if (batch.length === 0) continue;
      const result = await this.http.get<YouTubeVideosListResponse>("videos.list", "videos", {
        part: "snippet,contentDetails,status,statistics",
        id: batch.join(","),
        maxResults: MAX_RESULTS_PER_PAGE,
      });
      if (result.notModified) {
        throw new YouTubeProviderError("UNEXPECTED_RESPONSE", "Unexpected 304 response for videos.list.");
      }

      for (const item of result.data.items ?? []) {
        results.push({
          videoId: item.id,
          title: item.snippet?.title ?? null,
          description: item.snippet?.description ?? null,
          thumbnails: (item.snippet?.thumbnails ?? {}) as YouTubeThumbnailSet,
          publishedAt: item.snippet?.publishedAt ?? null,
          durationIso8601: item.contentDetails?.duration ?? null,
          channelId: item.snippet?.channelId ?? null,
          channelTitle: item.snippet?.channelTitle ?? null,
          privacyStatus: item.status?.privacyStatus ?? null,
          uploadStatus: item.status?.uploadStatus ?? null,
          embeddable: item.status?.embeddable ?? null,
          viewCount: item.statistics?.viewCount ?? null,
          likeCount: item.statistics?.likeCount ?? null,
          commentCount: item.statistics?.commentCount ?? null,
          etag: item.etag ?? null,
        });
      }
    }

    return results;
  }
}

/**
 * Splits `ids` into chunks no larger than `size`, preserving order.
 * Exported for direct, network-free unit testing of the batching rule
 * itself, independent of any HTTP behavior.
 */
export function chunkArray<T>(items: T[], size: number): T[][] {
  if (size <= 0) {
    throw new Error("chunkArray size must be a positive integer.");
  }
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function dedupePreservingOrder(ids: string[]): string[] {
  return Array.from(new Set(ids));
}

// ---------------------------------------------------------------------------
// Raw Data API response shapes (only the fields this adapter reads) —
// intentionally not exported; callers only ever see the DTOs in ./types.
// ---------------------------------------------------------------------------

interface YouTubeChannelsListResponse {
  items?: {
    id: string;
    etag?: string;
    snippet?: { title?: string };
    contentDetails?: { relatedPlaylists?: { uploads?: string } };
  }[];
}

interface YouTubePlaylistsListResponse {
  nextPageToken?: string;
  items?: {
    id: string;
    etag?: string;
    snippet?: { title?: string; description?: string; publishedAt?: string; channelId?: string };
    status?: { privacyStatus?: string };
  }[];
}

interface YouTubePlaylistItemsListResponse {
  nextPageToken?: string;
  items?: {
    etag?: string;
    snippet?: {
      title?: string;
      publishedAt?: string;
      position?: number;
      resourceId?: { videoId?: string };
    };
    contentDetails?: { videoId?: string; videoPublishedAt?: string };
  }[];
}

interface YouTubeVideosListResponse {
  items?: {
    id: string;
    etag?: string;
    snippet?: {
      title?: string;
      description?: string;
      publishedAt?: string;
      channelId?: string;
      channelTitle?: string;
      thumbnails?: unknown;
    };
    contentDetails?: { duration?: string };
    status?: { privacyStatus?: string; uploadStatus?: string; embeddable?: boolean };
    statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
  }[];
}
