// Plain TS mirror of the Prisma-generated YouTubeAnalyticsScope/Metric
// enums (ADR §3 boundary rule — modules/analytics is not modules/db, so it
// never imports @prisma/client). modules/db/repositories maps between
// these and the real Prisma enums.

export type YouTubeAnalyticsScope = "CHANNEL" | "VIDEO";

// YouTube Data API ("what exists") vs YouTube Analytics API ("how is it
// performing") are two different capabilities (brief §8) — every metric
// below comes only from the second. Not every metric is available for
// every report/scope in the real API; this is the set Music Madras has an
// actual documented use for (brief §8's own example list), not an
// exhaustive mirror of YouTube Analytics' full dimension/metric catalog.
export type YouTubeAnalyticsMetricName =
  | "VIEWS"
  | "WATCH_TIME_MINUTES"
  | "AVERAGE_VIEW_DURATION_SECONDS"
  | "AVERAGE_VIEW_PERCENTAGE"
  | "LIKES"
  | "COMMENTS"
  | "SHARES"
  | "SUBSCRIBERS_GAINED"
  | "SUBSCRIBERS_LOST";

export const YOUTUBE_ANALYTICS_METRIC_NAMES: readonly YouTubeAnalyticsMetricName[] = [
  "VIEWS",
  "WATCH_TIME_MINUTES",
  "AVERAGE_VIEW_DURATION_SECONDS",
  "AVERAGE_VIEW_PERCENTAGE",
  "LIKES",
  "COMMENTS",
  "SHARES",
  "SUBSCRIBERS_GAINED",
  "SUBSCRIBERS_LOST",
];

/** An open-ended reporting breakdown, e.g. { trafficSource: "YT_SEARCH" } or { country: "IN", device: "MOBILE" }. */
export type YouTubeAnalyticsDimensions = Record<string, string> | undefined;

export interface YouTubeAnalyticsObservationInput {
  scope: YouTubeAnalyticsScope;
  youtubeVideoId?: string;
  channelId?: string;
  metric: YouTubeAnalyticsMetricName;
  periodStart: Date;
  periodEnd: Date;
  value: number;
  dimensions?: YouTubeAnalyticsDimensions;
  syncJobRunId?: string;
}

/**
 * The contract a future YouTube Analytics API client implements (brief
 * §10). No implementation exists in Phase 3 — no credentials, no network
 * calls. A test-only fake implementing this interface is used to exercise
 * the sync orchestration logic below without touching a real API.
 */
export interface YouTubeAnalyticsAdapter {
  fetchObservations(request: {
    scope: YouTubeAnalyticsScope;
    targetIds: string[]; // video IDs, or the single channel ID for CHANNEL scope
    metrics: YouTubeAnalyticsMetricName[];
    periodStart: Date;
    periodEnd: Date;
  }): Promise<YouTubeAnalyticsObservationInput[]>;
}
