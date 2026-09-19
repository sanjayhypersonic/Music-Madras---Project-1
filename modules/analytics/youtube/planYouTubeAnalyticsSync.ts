// Pure planning logic for a future YouTube Analytics sync job (brief
// §10). No network calls, no database, no credentials — this only decides
// *which date ranges* still need fetching, given where the last successful
// sync left off. The actual fetch/upsert orchestration
// (runYouTubeAnalyticsSync.ts) calls this and is exercised in tests only
// against a fake adapter/repository.
//
// One period per calendar day (UTC), matching YouTube Analytics' typical
// daily reporting granularity. YouTube Analytics data for a given day is
// generally not final until roughly two days later, so "today" and
// "yesterday" are excluded from the plan by default via `reportingLagDays`.

export interface AnalyticsPeriod {
  periodStart: Date;
  periodEnd: Date; // exclusive
}

export interface PlanYouTubeAnalyticsSyncInput {
  /** The end of the last period successfully synced, or null for a first-ever sync. */
  lastSyncedPeriodEnd: Date | null;
  /** Defaults to `new Date()` if omitted — accepting it as a parameter keeps this pure/testable. */
  now: Date;
  /** How many days of history to backfill on a first-ever sync. */
  backfillDays?: number;
  /** Days of reporting lag to exclude from the plan (data not yet final). */
  reportingLagDays?: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function planYouTubeAnalyticsSync(input: PlanYouTubeAnalyticsSyncInput): AnalyticsPeriod[] {
  const backfillDays = input.backfillDays ?? 30;
  const reportingLagDays = input.reportingLagDays ?? 2;

  const today = startOfUtcDay(input.now);
  const lastReportableDay = new Date(today.getTime() - reportingLagDays * DAY_MS);

  const firstDayToSync = input.lastSyncedPeriodEnd
    ? startOfUtcDay(input.lastSyncedPeriodEnd)
    : new Date(today.getTime() - backfillDays * DAY_MS);

  const periods: AnalyticsPeriod[] = [];
  for (let day = firstDayToSync; day.getTime() < lastReportableDay.getTime(); day = new Date(day.getTime() + DAY_MS)) {
    periods.push({ periodStart: day, periodEnd: new Date(day.getTime() + DAY_MS) });
  }

  return periods;
}
