import type { YouTubeSyncResult } from "../youtube/sync-engine/syncYouTubeChannel";

/**
 * One unambiguous rule: SUCCEEDED means the whole scope was observed AND every
 * record found was processed AND nothing was reported as an error. Anything
 * else is PARTIAL (a thrown failure is FAILED, recorded separately by the job).
 * Kept free of database imports so it is unit-testable.
 */
export function deriveYouTubeSyncStatus(result: Pick<YouTubeSyncResult, "completeness" | "recordsFailed" | "errors">): "SUCCEEDED" | "PARTIAL" {
  return result.completeness === "FULL" && result.recordsFailed === 0 && result.errors.length === 0 ? "SUCCEEDED" : "PARTIAL";
}