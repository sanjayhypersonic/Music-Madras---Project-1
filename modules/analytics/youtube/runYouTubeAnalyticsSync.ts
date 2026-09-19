import { planYouTubeAnalyticsSync, type AnalyticsPeriod } from "./planYouTubeAnalyticsSync";
import type {
  YouTubeAnalyticsAdapter,
  YouTubeAnalyticsMetricName,
  YouTubeAnalyticsObservationInput,
  YouTubeAnalyticsScope,
} from "./youtubeAnalyticsTypes";

// Sync orchestration (brief §10). This is the "Service" a future
// Scheduler/Trigger -> Job -> Service layering (mirroring the pattern
// already established for YouTube Data sync, ADR §12) would call for both
// scheduled and manual runs — there is only one implementation to call,
// by construction, exactly like the existing YouTube Data sync design.
//
// Both the adapter and the repository are passed in as interfaces
// (dependency injection), so this file never imports Prisma or makes a
// real network call itself — it is fully exercised in tests against fakes.
// The concrete repository implementation lives in
// modules/db/repositories/youtubeAnalyticsRepository.ts.

export interface YouTubeAnalyticsSyncRepositoryPort {
  upsertObservation(input: YouTubeAnalyticsObservationInput): Promise<void>;
}

export interface RunYouTubeAnalyticsSyncOptions {
  scope: YouTubeAnalyticsScope;
  targetIds: string[];
  metrics: YouTubeAnalyticsMetricName[];
  lastSyncedPeriodEnd: Date | null;
  now: Date;
  /** Passed straight through to planYouTubeAnalyticsSync — see its docs for defaults. */
  backfillDays?: number;
  reportingLagDays?: number;
  /** Quota awareness (brief §10): cap how many periods one run attempts; leftover periods are picked up by the next run. */
  maxPeriodsPerRun?: number;
  /** Simple retry count per period before it's recorded as failed — no real backoff timing here (that belongs to the live adapter's HTTP client, not this orchestration logic). */
  maxAttemptsPerPeriod?: number;
}

export interface YouTubeAnalyticsSyncResult {
  periodsPlanned: number;
  periodsAttempted: number;
  periodsSucceeded: number;
  periodsFailed: number;
  observationsUpserted: number;
  lastSyncedPeriodEnd: Date | null;
  errors: { period: AnalyticsPeriod; message: string }[];
}

export async function runYouTubeAnalyticsSync(
  adapter: YouTubeAnalyticsAdapter,
  repository: YouTubeAnalyticsSyncRepositoryPort,
  options: RunYouTubeAnalyticsSyncOptions
): Promise<YouTubeAnalyticsSyncResult> {
  const allPeriods = planYouTubeAnalyticsSync({
    lastSyncedPeriodEnd: options.lastSyncedPeriodEnd,
    now: options.now,
    backfillDays: options.backfillDays,
    reportingLagDays: options.reportingLagDays,
  });
  const maxAttemptsPerPeriod = options.maxAttemptsPerPeriod ?? 3;
  const periodsToAttempt = options.maxPeriodsPerRun
    ? allPeriods.slice(0, options.maxPeriodsPerRun)
    : allPeriods;

  const result: YouTubeAnalyticsSyncResult = {
    periodsPlanned: allPeriods.length,
    periodsAttempted: periodsToAttempt.length,
    periodsSucceeded: 0,
    periodsFailed: 0,
    observationsUpserted: 0,
    lastSyncedPeriodEnd: options.lastSyncedPeriodEnd,
    errors: [],
  };

  for (const period of periodsToAttempt) {
    const outcome = await fetchPeriodWithRetries(adapter, options, period, maxAttemptsPerPeriod);

    if (!outcome.ok) {
      result.periodsFailed++;
      result.errors.push({ period, message: outcome.message });
      // Idempotency/checkpoint safety: stop advancing the checkpoint at
      // the first failure so a later run resumes from here, rather than
      // skipping over a gap (brief §10 — "partial failure handling").
      break;
    }

    for (const observation of outcome.observations) {
      await repository.upsertObservation(observation);
      result.observationsUpserted++;
    }
    result.periodsSucceeded++;
    result.lastSyncedPeriodEnd = period.periodEnd;
  }

  return result;
}

async function fetchPeriodWithRetries(
  adapter: YouTubeAnalyticsAdapter,
  options: RunYouTubeAnalyticsSyncOptions,
  period: AnalyticsPeriod,
  maxAttempts: number
): Promise<{ ok: true; observations: YouTubeAnalyticsObservationInput[] } | { ok: false; message: string }> {
  let lastMessage = "unknown error";

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const observations = await adapter.fetchObservations({
        scope: options.scope,
        targetIds: options.targetIds,
        metrics: options.metrics,
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
      });
      return { ok: true, observations };
    } catch (err) {
      lastMessage = err instanceof Error ? err.message : String(err);
    }
  }

  return { ok: false, message: lastMessage };
}
