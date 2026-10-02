// Provider DTOs (Phase 6C, ADR §11) — deliberately separate from MMKE's
// Prisma-generated types (YouTubeVideo, YouTubePlaylist,
// YouTubePlaylistItem in prisma/schema.prisma). This module has no
// dependency on @prisma/client at all; mapping a provider record onto a
// canonical row is the (not-yet-built) sync engine's job, not this
// adapter's. Fields are the ones the approved architecture (ADR §13.1,
// §15, §16) actually needs — not a full mirror of every field the
// YouTube Data API can return.
//
// `durationIso8601` is kept as the raw ISO 8601 duration string
// (`contentDetails.duration`, e.g. "PT4M13S") rather than converted to
// seconds here — that conversion is a mapping decision for whoever
// consumes this DTO, not something this adapter should decide on their
// behalf. Similarly, `privacyStatus`/`uploadStatus` are passed through as
// the raw strings the API returns ("public"/"unlisted"/"private", etc.)
// — mapping them onto Music Madras's own ObservabilityState enum is
// explicitly the availability layer's job, a later phase.

export interface YouTubeThumbnail {
  url: string;
  width?: number;
  height?: number;
}

export interface YouTubeThumbnailSet {
  default?: YouTubeThumbnail;
  medium?: YouTubeThumbnail;
  high?: YouTubeThumbnail;
  standard?: YouTubeThumbnail;
  maxres?: YouTubeThumbnail;
}

export interface YouTubeChannelRecord {
  channelId: string;
  title: string | null;
  uploadsPlaylistId: string;
  /** channels.list statistics.videoCount (public videos); null/absent when YouTube did not report it. */
  videoCount?: number | null;
  etag: string | null;
}

export interface YouTubeVideoRecord {
  videoId: string;
  title: string | null;
  description: string | null;
  thumbnails: YouTubeThumbnailSet;
  publishedAt: string | null;
  durationIso8601: string | null;
  channelId: string | null;
  channelTitle: string | null;
  privacyStatus: string | null;
  uploadStatus: string | null;
  /** `status.embeddable` — whether YouTube allows this video to be embedded elsewhere. */
  embeddable: boolean | null;
  // Phase 6E: current public video statistics (`part=statistics`), added
  // because the archive-inventory phase needs them. Kept as the raw
  // strings the API returns (YouTube's statistics values are strings, not
  // numbers, in the wire format) — parsing to a number is a mapping
  // decision for whoever consumes this DTO. These are NOT YouTube
  // Analytics (watch time, traffic sources, etc.) — that is a distinct,
  // separately-authorized API and a later phase (see
  // docs/analytics-architecture.md §5).
  viewCount: string | null;
  likeCount: string | null;
  commentCount: string | null;
  etag: string | null;
}

export interface YouTubePlaylistRecord {
  playlistId: string;
  title: string | null;
  description: string | null;
  publishedAt: string | null;
  privacyStatus: string | null;
  channelId: string | null;
  // Phase 6F: added alongside the equivalent field on YouTubeVideoRecord —
  // needed once the sync engine started persisting a playlist's own
  // thumbnail, which the Phase 6C DTO never carried.
  thumbnails: YouTubeThumbnailSet;
  etag: string | null;
}

export interface YouTubePlaylistItemRecord {
  playlistId: string;
  videoId: string;
  position: number;
  title: string | null;
  publishedAt: string | null;
  etag: string | null;
}

/** A single page of a paginated Data API list response — the future sync engine decides how many pages to walk. */
export interface YouTubePageResult<T> {
  items: T[];
  nextPageToken: string | null;
}

export interface YouTubeAdapterConfig {
  apiKey: string;
  /** Overridable only for tests, to point at a fake local server instead of the real API. */
  baseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
}

export type YouTubeDataApiOperation = "channels.list" | "playlists.list" | "playlistItems.list" | "videos.list";
