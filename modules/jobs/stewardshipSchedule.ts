// When Studio -> Health should say the scheduled stewardship job "has probably stopped". PURE: a reporting threshold, nothing is decided by it (the job's own
// lease, retries and failure handling are untouched).
//
// The schedule is the one in vercel.json: ONCE A DAY at 03:30 UTC (09:00 IST), the most the free Vercel Hobby plan accepts. The threshold therefore has to be longer
// than the longest gap between two healthy runs, which is:
//   - the schedule's period, 24 hours; plus
//   - the Hobby plan's timing latitude: it may fire anywhere inside the scheduled hour (Vercel docs, "Cron jobs accuracy"), so one run can land at 03:00 and the next
//     at 03:59, a gap of 24 h 59 min; plus
//   - a margin for a slow start or a run that takes a while to record itself.
// One missed day is still noticed: by 26 hours after the last start the next run is overdue. If the schedule is ever made more frequent, lower these constants
// (tests/unit/stewardshipSchedule.test.ts reads vercel.json and fails when the threshold no longer fits the configured schedule).

export const STEWARDSHIP_SCHEDULE_PERIOD_MS = 24 * 3_600_000;
export const STEWARDSHIP_SCHEDULE_JITTER_MS = 60 * 60_000;
export const STEWARDSHIP_STALE_MARGIN_MS = 60 * 60_000;

/** How long without a run STARTING before Studio says the job has probably stopped (26 hours). */
export const STEWARDSHIP_STALE_AFTER_MS = STEWARDSHIP_SCHEDULE_PERIOD_MS + STEWARDSHIP_SCHEDULE_JITTER_MS + STEWARDSHIP_STALE_MARGIN_MS;

/** True when no run has ever started, or the newest started more than STEWARDSHIP_STALE_AFTER_MS ago. A run that started recently but FAILED is not "overdue": its status is shown separately. */
export function isStewardshipOverdue(lastRunStartedAt: Date | null, now: Date, staleAfterMs: number = STEWARDSHIP_STALE_AFTER_MS): boolean {
  if (lastRunStartedAt === null) return true;
  return now.getTime() - lastRunStartedAt.getTime() > staleAfterMs;
}
