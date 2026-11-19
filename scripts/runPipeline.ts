// R-34: run the upload-to-draft pipeline orchestrator for CHOSEN videos only (docs/upload-pipeline.md section 7).
//
//   npm run pipeline:run -- --only <id,id>                                         offline: prints what it would run, connects to nothing
//   npm run pipeline:run -- --limit 3                                              offline, the first 3 queued
//   STAGING_DATABASE_URL=<direct staging url> npm run pipeline:run -- --only <id,id> --confirm-host <host:port/database>
//        DRY RUN against staging: reads the videos, refuses held or approved ones, reports what each would do; calls no AI and writes nothing
//   ... --confirm-host <host:port/database> --execute                              RUNS the stages (AI calls, staging writes), within MAX_USD_PER_RUN
//
// Rules: the staging guard of the other operator scripts (STAGING_DATABASE_URL only, direct Neon host, "staging" in the name, --confirm-host typed
// exactly, never a configured real database); PIPELINE_ENABLED must be exactly "true" before anything connects; MAX_USD_PER_RUN caps the run
// (default $2); a held-out or already approved video is REFUSED and never run (modules/pipeline/select.ts); the run takes the pipeline lease, so
// it cannot overlap the daily cron; the YouTube sync is NOT run (run it first if the videos are new). The AI provider comes from AI_PROVIDER,
// ANTHROPIC_API_KEY and AI_MODEL / PIPELINE_AI_MODEL in the SHELL (the repository's .env is not read once the staging target is bound). Nothing
// is published: bundles wait in Studio -> Pipeline. Only counts, ids, tokens and cost are printed. Exit codes: 0 done, 2 failed, 4 refused.
import { readPipelineConfig } from "../modules/pipeline/config";
import { describeRunReport, parseRunArgs, scopePorts, selectRunTargets } from "../modules/pipeline/select";
import { bindStagingTarget } from "./lib/stagingClient";

function refuse(reason: string): number {
  console.error(`REFUSED: ${reason}`);
  return 4;
}

async function main(): Promise<number> {
  const parsed = parseRunArgs(process.argv.slice(2));
  if (!parsed.ok) return refuse(parsed.error);
  const { args } = parsed;
  const config = readPipelineConfig(process.env);
  const scope = args.only ? `videos ${args.only.join(", ")}` : `the first ${args.limit} queued video(s)`;
  console.log(`Pipeline run for ${scope}: ${args.execute ? "EXECUTE" : "dry run"}; PIPELINE_ENABLED=${config.enabled}; modes: extract ${config.extractMode}, research ${config.researchMode}, draft ${config.draftMode}; cap $${config.maxUsdPerRun.toFixed(2)} per run; model ${config.model ?? process.env.AI_MODEL ?? "the provider default"}.`);

  if (!args.confirmHost) {
    console.log("DRY RUN (offline): no database was named, so nothing was read, called or written. Add --confirm-host with STAGING_DATABASE_URL to see what each video would do.");
    return 0;
  }
  if (!config.enabled) return refuse("PIPELINE_ENABLED is not exactly \"true\". Nothing was connected to.");
  const bound = bindStagingTarget(args.confirmHost);
  if (!bound.ok) return refuse(bound.reason);
  console.log(`Target: ${bound.described} (staging, confirmed)`);

  const { prisma } = await import("../modules/db/client");
  const { assessReadiness } = await import("../modules/ops/readiness");
  const { EXPECTED_MIGRATIONS } = await import("../modules/config/expectedMigrations");
  const { loadReadinessFacts } = await import("../modules/db/repositories/readinessRepository");
  const { buildPipelinePorts, finishPipelineRun, loadVideoRunFacts, startPipelineRun } = await import("../modules/db/repositories/pipelineRepository");
  const { runPipeline } = await import("../modules/pipeline/run");
  const { getConfiguredAIProvider } = await import("../modules/ai/provider/aiProviderRegistry");
  const { QueryPatternDemandProvider } = await import("../modules/pipeline/searchDemand");
  const { writeAuditLog } = await import("../modules/audit/writeAuditLog");
  try {
    const readiness = assessReadiness(EXPECTED_MIGRATIONS, await loadReadinessFacts());
    if (!readiness.ready) return refuse(`the staging database is not ready (${readiness.code}): apply migration 20261118100000_upload_pipeline first. Nothing was written.`);

    const facts = await loadVideoRunFacts({ youtubeVideoIds: args.only ?? undefined, limit: args.limit ?? undefined });
    const { selected, refused } = selectRunTargets(facts, args);
    for (const r of refused) console.log(`  refused ${r.youtubeVideoId}: ${r.reason}`);
    if (selected.length === 0) return refuse("no selected video may be run.");
    console.log(`Selected: ${selected.join(", ")}`);

    const provider = getConfiguredAIProvider();
    // A provider key is needed only when a stage is switched to api; with every stage manual the run makes no AI call.
    if (args.execute && (config.extractMode === "api" || config.researchMode === "api" || config.draftMode === "api")) {
      const status = provider.validateConfiguration();
      if (!status.configured) return refuse(`the AI provider is not configured (${status.reason ?? "unknown"}). Set AI_PROVIDER and ANTHROPIC_API_KEY in this shell.`);
    }
    const now = new Date();
    const runConfig = { ...config, dryRun: !args.execute, maxVideosPerRun: selected.length, maxQueuePerRun: selected.length, runSync: false };
    const lease = args.execute ? await startPipelineRun({ trigger: "OPERATOR", dryRun: false, capUsd: config.maxUsdPerRun, leaseSeconds: config.leaseSeconds, now }) : { id: "dry-run" };
    if (!lease) return refuse("another pipeline run holds the lease (the daily cron or another operator). Try again when it has finished.");

    const report = await runPipeline({ ports: scopePorts(buildPipelinePorts({ youtubeVideoIds: selected }), selected), provider, demand: [new QueryPatternDemandProvider()], config: runConfig, now });
    console.log("Summary:");
    for (const line of describeRunReport(report, selected)) console.log(line);

    if (args.execute) {
      const status = report.stoppedReason === "COST_CAP" ? "STOPPED_COST_CAP" : report.failures.length > 0 ? "PARTIAL" : "SUCCEEDED";
      await finishPipelineRun(lease.id, { status, videosConsidered: report.considered, videosAdvanced: report.advanced.length, inputTokens: report.usage.inputTokens, outputTokens: report.usage.outputTokens, webSearches: report.usage.webSearches, costUsd: report.usage.costUsd, stoppedReason: report.stoppedReason, steps: { operator: true, selected, refused, advanced: report.advanced, failures: report.failures } });
      await writeAuditLog({ actorId: null, action: "PIPELINE_OPERATOR_RUN", entityType: "PipelineRun", entityId: lease.id, afterSnapshot: { status, selected, refused: refused.length, ...report.usage } });
      console.log("Done. Nothing was published: review the bundles in Studio -> Pipeline.");
      return report.failures.length > 0 ? 2 : 0;
    }
    console.log("DRY RUN: read only; no AI call was made and nothing was written. Add --execute to run.");
    return 0;
  } finally {
    await prisma.$disconnect();
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(`FAILED: ${err instanceof Error ? err.name : "unknown error"} (details are not printed: they could contain connection information)`);
    process.exit(2);
  }
);
