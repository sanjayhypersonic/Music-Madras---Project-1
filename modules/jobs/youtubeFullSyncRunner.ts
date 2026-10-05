import type { YouTubeSyncResult } from "../youtube/sync-engine/syncYouTubeChannel";
import { describeConnectionHost, isPooledConnectionString } from "./syncRunLock";

// The pure, testable half of scripts/runYouTubeFullSync.ts: argument parsing,
// the environment preflight, exit codes and the printed summary. Nothing here
// touches the network or the database, and nothing here ever formats a secret
// (API key, connection string credentials) into output.

/** Distinct, scriptable outcomes — a wrapper (CI, cron, a human) can tell them apart. */
export const RUNNER_EXIT_CODES = {
  SUCCEEDED: 0,
  PARTIAL: 1,
  FAILED: 2,
  ALREADY_RUNNING: 3,
  CONFIGURATION: 4,
  INTERRUPTED: 5,
} as const;

export interface RunnerArgs {
  /** Without --execute the script only reports what it WOULD do. */
  execute: boolean;
}

export function parseRunnerArgs(argv: readonly string[]): RunnerArgs | { error: string } {
  let execute = false;
  for (const arg of argv) {
    if (arg === "--execute") execute = true;
    else return { error: `Unknown argument "${arg}". The only supported flag is --execute.` };
  }
  return { execute };
}

/** `process.env`-shaped; only YOUTUBE_API_KEY, YOUTUBE_CHANNEL_ID, DATABASE_URL and DIRECT_URL are read. */
export type RunnerEnvironment = Readonly<Record<string, string | undefined>>;

export interface RunnerPreflight {
  ok: boolean;
  problems: string[];
  /** Safe to print: presence flags and database host names only. */
  report: {
    youtubeApiKeyConfigured: boolean;
    youtubeChannelId: string | null;
    databaseHost: string | null;
    lockHost: string | null;
  };
}

/** Same database = same host (a Neon "-pooler" suffix ignored, port ignored) and same database name. Unparseable strings never match. */
function pointAtSameDatabase(a: string, b: string): boolean {
  try {
    const normalise = (connectionString: string) => {
      const url = new URL(connectionString);
      return `${url.hostname.replace("-pooler", "").toLowerCase()}${url.pathname}`;
    };
    return normalise(a) === normalise(b);
  } catch {
    return false;
  }
}

export function assessRunnerEnvironment(env: RunnerEnvironment): RunnerPreflight {
  const problems: string[] = [];
  if (!env.YOUTUBE_API_KEY) problems.push("YOUTUBE_API_KEY is not set.");
  if (!env.YOUTUBE_CHANNEL_ID) problems.push("YOUTUBE_CHANNEL_ID is not set.");
  if (!env.DATABASE_URL) problems.push("DATABASE_URL is not set.");
  if (!env.DIRECT_URL) problems.push("DIRECT_URL is not set (the run lock needs a direct, non-pooled connection).");
  else if (isPooledConnectionString(env.DIRECT_URL)) problems.push("DIRECT_URL points at a pooled endpoint; the run lock needs a direct connection.");
  // Phase 6J-5: the lock is taken on DIRECT_URL but the data is written through DATABASE_URL. If they named different
  // databases the lock would protect nothing, so the run is refused rather than trusted.
  if (env.DATABASE_URL && env.DIRECT_URL && !pointAtSameDatabase(env.DATABASE_URL, env.DIRECT_URL)) {
    problems.push("DATABASE_URL and DIRECT_URL do not point at the same database; the run lock would not protect the data being written.");
  }

  return {
    ok: problems.length === 0,
    problems,
    report: {
      youtubeApiKeyConfigured: Boolean(env.YOUTUBE_API_KEY),
      youtubeChannelId: env.YOUTUBE_CHANNEL_ID ?? null,
      databaseHost: env.DATABASE_URL ? describeConnectionHost(env.DATABASE_URL) : null,
      lockHost: env.DIRECT_URL ? describeConnectionHost(env.DIRECT_URL) : null,
    },
  };
}

export function exitCodeForStatus(status: "SUCCEEDED" | "PARTIAL"): number {
  return status === "SUCCEEDED" ? RUNNER_EXIT_CODES.SUCCEEDED : RUNNER_EXIT_CODES.PARTIAL;
}

export function formatSyncSummary(input: { syncJobRunId: string; status: "SUCCEEDED" | "PARTIAL"; result: YouTubeSyncResult }): string[] {
  const { result } = input;
  const counts = (label: string, c: YouTubeSyncResult["videos"]) =>
    `  ${label.padEnd(15)} discovered ${c.discovered}, created ${c.created}, updated ${c.updated}, unchanged ${c.unchanged}, flagged ${c.flagged}`;
  const lines = [
    `Sync run id:   ${input.syncJobRunId}`,
    `Status:        ${input.status}`,
    `Completeness:  ${result.completeness}`,
    counts("Videos", result.videos),
    counts("Playlists", result.playlists),
    counts("Playlist items", result.playlistItems),
    `  Conflicts detected: ${result.conflictsDetected}`,
    `  Records failed:     ${result.recordsFailed}`,
    `  Video absence flagging: ${result.videoAbsenceEvaluated ? "evaluated (whole scope observed)" : "SKIPPED (scope not fully observed)"}`,
  ];
  if (result.reconciliation) {
    const r = result.reconciliation;
    lines.push(
      `Reconciliation: ${r.status} — channel reports ${r.reportedVideoCount ?? "no count"} public videos; this pass saw ${r.uploadsPublicVideos} public in uploads` +
        ` (${r.uploadsVideoIds} uploads ids, ${r.observedVideoIds} ids overall, ${r.resolvedVideos} resolved)`,
      `  ${r.note}`
    );
  }
  for (const error of result.errors) lines.push(`  error [${error.phase}]: ${error.message}`);
  return lines;
}

/**
 * Every scope this engine records a checkpoint for after a clean run:
 * the two channel-wide sentinels plus one checkpoint per observed playlist.
 * Returns what is missing, so a checkpoint set that quietly lost a key (the
 * historical 12-vs-14 gap) is reported instead of passing unnoticed.
 */
export function findMissingCheckpointScopes(input: {
  playlistItemScopeKeys: readonly string[];
  playlistScopeKeys: readonly string[];
  observedYoutubePlaylistIds: readonly string[];
}): string[] {
  const items = new Set(input.playlistItemScopeKeys);
  const playlists = new Set(input.playlistScopeKeys);
  const missing: string[] = [];
  if (!items.has("channel-uploads")) missing.push("YOUTUBE_PLAYLIST_ITEM:channel-uploads");
  if (!playlists.has("channel-playlists")) missing.push("YOUTUBE_PLAYLIST:channel-playlists");
  for (const id of input.observedYoutubePlaylistIds) if (!items.has(id)) missing.push(`YOUTUBE_PLAYLIST_ITEM:${id}`);
  return missing;
}
