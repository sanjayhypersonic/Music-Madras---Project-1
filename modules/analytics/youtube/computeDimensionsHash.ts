import { createHash } from "crypto";
import type { YouTubeAnalyticsDimensions } from "./youtubeAnalyticsTypes";

// Deterministic hash of a dimensions breakdown, used as part of
// YouTubeAnalyticsObservation's unique constraint so re-running a sync is
// idempotent (brief §10) regardless of what order the dimension keys
// happen to arrive in from the API. Uses Node's built-in `crypto` module
// only — no new dependency, and this stays pure/deterministic (no I/O),
// so it's directly unit-testable.

export function computeDimensionsHash(dimensions: YouTubeAnalyticsDimensions): string {
  if (!dimensions || Object.keys(dimensions).length === 0) {
    return "";
  }

  const canonical = Object.keys(dimensions)
    .sort()
    .map((key) => `${key}=${dimensions[key]}`)
    .join("&");

  return createHash("sha256").update(canonical).digest("hex");
}
