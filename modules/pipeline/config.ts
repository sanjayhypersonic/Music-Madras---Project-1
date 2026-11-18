// Upload-to-draft pipeline (R-34, docs/upload-pipeline.md): configuration. Pure: reads only the environment object it is given.
//
// Safe by default: nothing runs unless PIPELINE_ENABLED is exactly "true", and even then it is a DRY RUN (no provider call, no write) unless
// PIPELINE_DRY_RUN is exactly "false". A run never spends more than MAX_USD_PER_RUN (default 2.00) on AI calls and web searches.

export interface PipelineConfig {
  enabled: boolean;
  dryRun: boolean;
  maxUsdPerRun: number;
  /** How many videos a run advances (small, resumable steps). */
  maxVideosPerRun: number;
  /** How many new videos a run queues. */
  maxQueuePerRun: number;
  /** Web searches per research request. */
  maxSearchesPerEntity: number;
  /** New entities researched per video. */
  maxEntitiesResearchedPerVideo: number;
  /** A video failing this many times stops being retried (FAILED). */
  maxAttempts: number;
  /** Run the YouTube sync first (the existing change-detecting full sync). */
  runSync: boolean;
  /** How long a run holds the pipeline. */
  leaseSeconds: number;
  model: string | undefined;
}

export const PIPELINE_DEFAULTS = {
  maxUsdPerRun: 2,
  maxVideosPerRun: 3,
  maxQueuePerRun: 25,
  maxSearchesPerEntity: 3,
  maxEntitiesResearchedPerVideo: 4,
  maxAttempts: 3,
  leaseSeconds: 15 * 60,
} as const;

const positive = (raw: string | undefined, fallback: number, max: number): number => {
  const n = Number(raw);
  return raw !== undefined && raw.trim() !== "" && Number.isFinite(n) && n > 0 ? Math.min(n, max) : fallback;
};

export function readPipelineConfig(env: Readonly<Record<string, string | undefined>>): PipelineConfig {
  return {
    enabled: env.PIPELINE_ENABLED === "true",
    dryRun: env.PIPELINE_DRY_RUN !== "false",
    maxUsdPerRun: positive(env.MAX_USD_PER_RUN, PIPELINE_DEFAULTS.maxUsdPerRun, 50),
    maxVideosPerRun: Math.floor(positive(env.PIPELINE_MAX_VIDEOS_PER_RUN, PIPELINE_DEFAULTS.maxVideosPerRun, 20)),
    maxQueuePerRun: PIPELINE_DEFAULTS.maxQueuePerRun,
    maxSearchesPerEntity: Math.floor(positive(env.PIPELINE_MAX_SEARCHES_PER_ENTITY, PIPELINE_DEFAULTS.maxSearchesPerEntity, 10)),
    maxEntitiesResearchedPerVideo: PIPELINE_DEFAULTS.maxEntitiesResearchedPerVideo,
    maxAttempts: PIPELINE_DEFAULTS.maxAttempts,
    runSync: env.PIPELINE_RUN_SYNC !== "false",
    leaseSeconds: PIPELINE_DEFAULTS.leaseSeconds,
    model: env.PIPELINE_AI_MODEL?.trim() || undefined,
  };
}
