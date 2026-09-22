import { YouTubeDataApiAdapter } from "../youtube/adapter";
import { runYouTubeSync, type YouTubeSyncResult } from "../youtube/sync-engine/syncYouTubeChannel";
import { buildYouTubeSyncRepository } from "../db/repositories/youtubeSyncRepository";
import { startSyncJobRun, completeSyncJobRun } from "../db/repositories/syncJobRunRepository";

// The composition root for the YouTube Data API synchronization (ADR
// §12's Job layer): SyncJobRun bookkeeping, reading configuration, and
// wiring the real adapter + the real repository into the pure
// modules/youtube/sync-engine Service. Nothing calls this yet (brief §24
// — no Studio "Sync Now" button, no cron trigger; both are later phases)
// — it exists as real, tested, callable production code, invoked for
// Phase 6F's initial synchronization via a one-off operator script, the
// same way a future scheduler or Studio action will call it.

export const YOUTUBE_SYNC_JOB_TYPE = "youtube.fullChannelSync";

export interface YouTubeSyncJobConfig {
  apiKey: string;
  channelId: string;
}

export function readYouTubeSyncJobConfigFromEnv(): YouTubeSyncJobConfig {
  const apiKey = process.env.YOUTUBE_API_KEY;
  const channelId = process.env.YOUTUBE_CHANNEL_ID;
  if (!apiKey) throw new Error("YOUTUBE_API_KEY is not configured.");
  if (!channelId) throw new Error("YOUTUBE_CHANNEL_ID is not configured.");
  return { apiKey, channelId };
}

export interface YouTubeSyncJobOutcome {
  syncJobRunId: string;
  result: YouTubeSyncResult;
}

export async function runYouTubeSyncJob(config: YouTubeSyncJobConfig, now: Date = new Date()): Promise<YouTubeSyncJobOutcome> {
  const jobRun = await startSyncJobRun("YOUTUBE", YOUTUBE_SYNC_JOB_TYPE);
  const adapter = new YouTubeDataApiAdapter({ apiKey: config.apiKey });
  const repository = buildYouTubeSyncRepository(jobRun.id);

  let result: YouTubeSyncResult;
  try {
    result = await runYouTubeSync(adapter, repository, { channelId: config.channelId, now });
  } catch (err) {
    await completeSyncJobRun(jobRun.id, {
      status: "FAILED",
      completeness: "PARTIAL",
      errorDetails: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }

  const recordsDiscovered = result.videos.discovered + result.playlists.discovered + result.playlistItems.discovered;
  const recordsCreated = result.videos.created + result.playlists.created + result.playlistItems.created;
  const recordsUpdated = result.videos.updated + result.playlists.updated + result.playlistItems.updated;
  const recordsUnchanged = result.videos.unchanged + result.playlists.unchanged + result.playlistItems.unchanged;
  const recordsFlagged = result.videos.flagged + result.playlists.flagged + result.playlistItems.flagged;

  await completeSyncJobRun(jobRun.id, {
    status: result.completeness === "FULL" ? "SUCCEEDED" : "PARTIAL",
    completeness: result.completeness,
    recordsDiscovered,
    recordsCreated,
    recordsUpdated,
    recordsUnchanged,
    recordsFlagged,
    recordsFailed: result.recordsFailed,
    conflictsDetected: result.conflictsDetected,
    errorDetails: result.errors.length > 0 ? JSON.stringify(result.errors) : undefined,
  });

  return { syncJobRunId: jobRun.id, result };
}
