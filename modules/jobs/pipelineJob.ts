import { readPipelineConfig, type PipelineConfig } from "../pipeline/config";
import { runPipeline, type RunReport } from "../pipeline/run";
import { QueryPatternDemandProvider, SearchConsoleDemandProvider, GoogleAdsDemandProvider } from "../pipeline/searchDemand";
import { getConfiguredAIProvider } from "../ai/provider/aiProviderRegistry";
import { buildPipelinePorts, finishPipelineRun, startPipelineRun } from "../db/repositories/pipelineRepository";
import { readYouTubeSyncJobConfigFromEnv, runYouTubeSyncJob } from "./youtubeSyncJob";
import { SyncAlreadyRunningError } from "./syncRunLock";
import { describeError } from "./scrubError";
import { writeAuditLog } from "../audit/writeAuditLog";

// R-34: the composition root of the upload-to-draft pipeline (docs/upload-pipeline.md), called by GET/POST /api/cron/pipeline with the same
// CRON_SECRET as the stewardship cron. In order:
//   1. PIPELINE_ENABLED must be exactly "true", or nothing runs (200, skipped DISABLED);
//   2. a lease (PipelineRun RUNNING until leaseExpiresAt) keeps two runs apart: a second caller is skipped, not queued;
//   3. outside a dry run, the existing YouTube sync runs first (change-detecting: unchanged videos are not written; its own run lock applies),
//      so new uploads, their text, tags and hashtags are current; a sync already running is not an error;
//   4. the pipeline queues and advances a few videos (modules/pipeline/run.ts) within MAX_USD_PER_RUN;
//   5. the run is recorded with token, search and cost totals and per-step counts (error kinds only, never messages, never secrets), and audited.
// DRY RUN (the default until PIPELINE_DRY_RUN=false) calls no AI provider, runs no sync and writes nothing but the run record.

export interface PipelineJobResult {
  ok: boolean;
  ran: boolean;
  skipped?: "DISABLED" | "ALREADY_RUNNING";
  dryRun?: boolean;
  runId?: string;
  report?: Omit<RunReport, "wouldDo"> & { wouldDo: number };
  sync?: { ran: boolean; outcome: string };
}

export async function runPipelineJob(input: { trigger: string; env?: Readonly<Record<string, string | undefined>>; now?: Date }): Promise<PipelineJobResult> {
  const config: PipelineConfig = readPipelineConfig(input.env ?? process.env);
  if (!config.enabled) return { ok: true, ran: false, skipped: "DISABLED" };
  const now = input.now ?? new Date();
  const run = await startPipelineRun({ trigger: input.trigger, dryRun: config.dryRun, capUsd: config.maxUsdPerRun, leaseSeconds: config.leaseSeconds, now });
  if (!run) return { ok: true, ran: false, skipped: "ALREADY_RUNNING" };

  let sync: PipelineJobResult["sync"] = { ran: false, outcome: config.dryRun ? "skipped (dry run)" : "skipped (PIPELINE_RUN_SYNC=false)" };
  try {
    if (!config.dryRun && config.runSync) {
      try {
        const outcome = await runYouTubeSyncJob(readYouTubeSyncJobConfigFromEnv(), { now });
        sync = { ran: true, outcome: outcome.status };
      } catch (err) {
        if (!(err instanceof SyncAlreadyRunningError)) throw err;
        sync = { ran: false, outcome: "another sync is running; this run uses the catalogue as it is" };
      }
    }
    const report = await runPipeline({ ports: buildPipelinePorts(), provider: getConfiguredAIProvider(), demand: [new QueryPatternDemandProvider(), new SearchConsoleDemandProvider(), new GoogleAdsDemandProvider()], config, now });
    const status = report.stoppedReason === "COST_CAP" ? "STOPPED_COST_CAP" : report.failures.length > 0 ? "PARTIAL" : "SUCCEEDED";
    await finishPipelineRun(run.id, {
      status,
      videosConsidered: report.considered,
      videosAdvanced: report.advanced.length,
      inputTokens: report.usage.inputTokens,
      outputTokens: report.usage.outputTokens,
      webSearches: report.usage.webSearches,
      costUsd: report.usage.costUsd,
      stoppedReason: report.stoppedReason,
      steps: { sync, queued: report.queued, requeued: report.requeued, advanced: report.advanced, failures: report.failures, wouldDo: report.wouldDo.slice(0, 200) },
    });
    await writeAuditLog({ actorId: null, action: "PIPELINE_RUN_COMPLETED", entityType: "PipelineRun", entityId: run.id, afterSnapshot: { status, dryRun: config.dryRun, ...report.usage, advanced: report.advanced.length, failures: report.failures.length } });
    return { ok: status !== "PARTIAL", ran: true, dryRun: config.dryRun, runId: run.id, report: { ...report, wouldDo: report.wouldDo.length }, sync };
  } catch (err) {
    await finishPipelineRun(run.id, { status: "FAILED", videosConsidered: 0, videosAdvanced: 0, inputTokens: 0, outputTokens: 0, webSearches: 0, costUsd: 0, stoppedReason: describeError(err).kind, steps: { sync } });
    throw err;
  }
}
