import { YouTubeDataApiAdapter } from "../youtube/adapter";
import { runYouTubeSync, type YouTubeSyncResult } from "../youtube/sync-engine/syncYouTubeChannel";
import { buildYouTubeSyncRepository } from "../db/repositories/youtubeSyncRepository";
import { startSyncJobRun, completeSyncJobRun } from "../db/repositories/syncJobRunRepository";
import { writeAuditLog } from "../audit/writeAuditLog";
import { acquireSyncRunLock } from "./syncRunLock";
import { deriveYouTubeSyncStatus } from "./youtubeSyncStatus";

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
  /** A DIRECT (non-pooled) connection string for the run lock; defaults to DIRECT_URL. */
  lockConnectionString?: string;
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
  status: "SUCCEEDED" | "PARTIAL";
  result: YouTubeSyncResult;
}

export const YOUTUBE_SYNC_RECONCILIATION_AUDIT_ACTION = "youtube.sync.reconciliation";

export interface RunYouTubeSyncJobOptions {
  now?: Date;
  /** Called as soon as the SyncJobRun row exists, so a caller can mark it FAILED if the process is interrupted. */
  onRunStarted?: (syncJobRunId: string) => void;
}

export async function runYouTubeSyncJob(config: YouTubeSyncJobConfig, options: RunYouTubeSyncJobOptions = {}): Promise<YouTubeSyncJobOutcome> {
  const now = options.now ?? new Date();

  // Take the run lock first: a refused run must not leave a SyncJobRun row behind.
  const lockConnectionString = config.lockConnectionString ?? process.env.DIRECT_URL;
  if (!lockConnectionString) throw new Error("DIRECT_URL is not configured, so the synchronization run lock cannot be taken.");
  const lock = await acquireSyncRunLock(lockConnectionString);

  try {
    const jobRun = await startSyncJobRun("YOUTUBE", YOUTUBE_SYNC_JOB_TYPE);
    options.onRunStarted?.(jobRun.id);
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
    const status = deriveYouTubeSyncStatus(result);

    await completeSyncJobRun(jobRun.id, {
      status,
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

    if (result.reconciliation) {
      await writeAuditLog({
        actorId: null,
        action: YOUTUBE_SYNC_RECONCILIATION_AUDIT_ACTION,
        entityType: "SyncJobRun",
        entityId: jobRun.id,
        afterSnapshot: { ...result.reconciliation, videoAbsenceEvaluated: result.videoAbsenceEvaluated },
      });
    }

    return { syncJobRunId: jobRun.id, status, result };
  } finally {
    await lock.release();
  }
}