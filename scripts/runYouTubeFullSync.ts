// Operator script for the YouTube -> Music Madras full-channel synchronization.
//
//   npm run youtube:full-sync                 preflight only: reports what would run, changes NOTHING
//   npm run youtube:full-sync -- --execute    performs the real synchronization
//
// It is the committed, reviewed way to run the sync (instead of an ad-hoc
// one-off). It prints the run id and a summary, never a secret (only database
// HOST names and whether the API key is present), refuses to start while
// another sync holds the run lock, and exits with a code that tells a wrapper
// exactly what happened: 0 succeeded, 1 partial, 2 failed, 3 already running,
// 4 configuration problem, 5 interrupted. See modules/jobs/youtubeFullSyncRunner.ts.

import { prisma } from "../modules/db/client";
import { completeSyncJobRun } from "../modules/db/repositories/syncJobRunRepository";
import { listSyncCheckpoints } from "../modules/db/repositories/syncCheckpointRepository";
import { readYouTubeSyncJobConfigFromEnv, runYouTubeSyncJob } from "../modules/jobs/youtubeSyncJob";
import { SyncAlreadyRunningError, SyncLockConfigurationError, isSyncRunLockFree } from "../modules/jobs/syncRunLock";
import {
  RUNNER_EXIT_CODES,
  assessRunnerEnvironment,
  exitCodeForStatus,
  findMissingCheckpointScopes,
  formatSyncSummary,
  parseRunnerArgs,
} from "../modules/jobs/youtubeFullSyncRunner";

async function preflight(): Promise<number> {
  const env = assessRunnerEnvironment(process.env);
  console.log("YouTube full synchronization — PREFLIGHT (nothing will be changed; pass --execute to run it)");
  console.log(`  YouTube API key configured: ${env.report.youtubeApiKeyConfigured}`);
  console.log(`  YouTube channel id:         ${env.report.youtubeChannelId ?? "(not set)"}`);
  console.log(`  Application database:       ${env.report.databaseHost ?? "(not set)"}`);
  console.log(`  Run-lock database (direct): ${env.report.lockHost ?? "(not set)"}`);
  if (!env.ok) {
    for (const problem of env.problems) console.error(`  PROBLEM: ${problem}`);
    return RUNNER_EXIT_CODES.CONFIGURATION;
  }

  const byState = await prisma.youTubeVideo.groupBy({ by: ["observabilityState"], _count: { _all: true } });
  console.log(`  Videos in catalogue by state: ${byState.map((row) => `${row.observabilityState}=${row._count._all}`).join(", ") || "(none)"}`);
  const lastRun = await prisma.syncJobRun.findFirst({ where: { provider: "YOUTUBE" }, orderBy: { startedAt: "desc" } });
  console.log(
    lastRun
      ? `  Last sync run: ${lastRun.id} — ${lastRun.status}/${lastRun.completeness ?? "n/a"} started ${lastRun.startedAt.toISOString()}`
      : "  Last sync run: (none recorded)"
  );
  console.log(`  Run lock free: ${await isSyncRunLockFree(process.env.DIRECT_URL as string)}`);
  console.log("Preflight complete. Re-run with --execute to synchronize.");
  return RUNNER_EXIT_CODES.SUCCEEDED;
}

async function execute(): Promise<number> {
  const env = assessRunnerEnvironment(process.env);
  console.log(`YouTube full synchronization — EXECUTING against ${env.report.databaseHost ?? "(unknown database)"}`);
  if (!env.ok) {
    for (const problem of env.problems) console.error(`PROBLEM: ${problem}`);
    return RUNNER_EXIT_CODES.CONFIGURATION;
  }

  let runId: string | null = null;
  const interrupted = (signal: string) => {
    console.error(`\nReceived ${signal}; marking the run as FAILED and exiting.`);
    const finish = () => process.exit(RUNNER_EXIT_CODES.INTERRUPTED);
    if (!runId) return finish();
    completeSyncJobRun(runId, { status: "FAILED", completeness: "PARTIAL", errorDetails: `Interrupted by ${signal} before completion.` })
      .catch(() => undefined)
      .finally(finish);
  };
  process.once("SIGINT", () => interrupted("SIGINT"));
  process.once("SIGTERM", () => interrupted("SIGTERM"));

  try {
    const outcome = await runYouTubeSyncJob(readYouTubeSyncJobConfigFromEnv(), { onRunStarted: (id) => (runId = id) });
    for (const line of formatSyncSummary(outcome)) console.log(line);

    const playlists = await prisma.youTubePlaylist.findMany({ where: { observabilityState: "OBSERVED" }, select: { youtubePlaylistId: true } });
    const missing = findMissingCheckpointScopes({
      playlistItemScopeKeys: (await listSyncCheckpoints("YOUTUBE", "YOUTUBE_PLAYLIST_ITEM")).map((c) => c.scopeKey),
      playlistScopeKeys: (await listSyncCheckpoints("YOUTUBE", "YOUTUBE_PLAYLIST")).map((c) => c.scopeKey),
      observedYoutubePlaylistIds: playlists.map((p) => p.youtubePlaylistId),
    });
    if (missing.length > 0) console.error(`WARNING: checkpoints missing after the run: ${missing.join(", ")}`);
    else console.log("Checkpoints: complete (channel-uploads, channel-playlists, and one per observed playlist).");

    return exitCodeForStatus(outcome.status);
  } catch (error) {
    if (error instanceof SyncAlreadyRunningError) {
      console.error(error.message);
      return RUNNER_EXIT_CODES.ALREADY_RUNNING;
    }
    if (error instanceof SyncLockConfigurationError) {
      console.error(error.message);
      return RUNNER_EXIT_CODES.CONFIGURATION;
    }
    console.error(`Synchronization FAILED${runId ? ` (run ${runId})` : ""}: ${error instanceof Error ? error.message : String(error)}`);
    return RUNNER_EXIT_CODES.FAILED;
  }
}

async function main(): Promise<number> {
  const args = parseRunnerArgs(process.argv.slice(2));
  if ("error" in args) {
    console.error(args.error);
    return RUNNER_EXIT_CODES.CONFIGURATION;
  }
  return args.execute ? execute() : preflight();
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = RUNNER_EXIT_CODES.FAILED;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
