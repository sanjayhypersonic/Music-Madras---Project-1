// Public surface of the YouTube Data API adapter (Phase 6C). Everything
// a future sync engine needs is exported from here; the raw Data API
// response shapes in youtubeDataAdapter.ts stay internal.

export { YouTubeDataApiAdapter, chunkArray, type YouTubeDataAdapter } from "./youtubeDataAdapter";
export { YouTubeHttpClient, type YouTubeHttpClientOptions, type YouTubeGetResult, type YouTubeNotModifiedResult } from "./httpClient";
export { YouTubeProviderError, isRetryableYouTubeError, redactUrl, type YouTubeProviderErrorKind } from "./errors";
export { withRetry, computeBackoffDelayMs, type RetryPolicyOptions } from "./retryPolicy";
export type {
  YouTubeAdapterConfig,
  YouTubeChannelRecord,
  YouTubeVideoRecord,
  YouTubePlaylistRecord,
  YouTubePlaylistItemRecord,
  YouTubePageResult,
  YouTubeThumbnail,
  YouTubeThumbnailSet,
  YouTubeDataApiOperation,
} from "./types";
