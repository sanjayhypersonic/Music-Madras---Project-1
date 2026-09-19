import { describe, expect, it } from "vitest";
import { planYouTubeAnalyticsSync } from "../../modules/analytics/youtube/planYouTubeAnalyticsSync";

const NOW = new Date(Date.UTC(2026, 0, 31)); // 2026-01-31

describe("planYouTubeAnalyticsSync", () => {
  it("backfills the default window on a first-ever sync (no checkpoint)", () => {
    const periods = planYouTubeAnalyticsSync({ lastSyncedPeriodEnd: null, now: NOW, backfillDays: 5, reportingLagDays: 2 });
    // 5 days of backfill, minus the 2-day reporting lag excluded from the end = 3 periods.
    expect(periods).toHaveLength(3);
    expect(periods[0].periodStart.toISOString()).toBe(new Date(Date.UTC(2026, 0, 26)).toISOString());
  });

  it("only plans periods after the last synced checkpoint on a subsequent sync", () => {
    const lastSyncedPeriodEnd = new Date(Date.UTC(2026, 0, 28));
    const periods = planYouTubeAnalyticsSync({ lastSyncedPeriodEnd, now: NOW, reportingLagDays: 2 });
    expect(periods.map((p) => p.periodStart.toISOString())).toEqual([
      new Date(Date.UTC(2026, 0, 28)).toISOString(),
    ]);
  });

  it("excludes the reporting-lag window (data not yet final)", () => {
    const lastSyncedPeriodEnd = new Date(Date.UTC(2026, 0, 29));
    const periods = planYouTubeAnalyticsSync({ lastSyncedPeriodEnd, now: NOW, reportingLagDays: 2 });
    // 2026-01-29 and 2026-01-30 would be within 2 days of "now" (01-31) — excluded.
    expect(periods).toHaveLength(0);
  });

  it("returns an empty plan when already fully up to date", () => {
    const lastSyncedPeriodEnd = new Date(Date.UTC(2026, 0, 31));
    const periods = planYouTubeAnalyticsSync({ lastSyncedPeriodEnd, now: NOW, reportingLagDays: 0 });
    expect(periods).toHaveLength(0);
  });

  it("each planned period spans exactly one UTC day", () => {
    const periods = planYouTubeAnalyticsSync({
      lastSyncedPeriodEnd: new Date(Date.UTC(2026, 0, 28)),
      now: NOW,
      reportingLagDays: 2,
    });
    for (const period of periods) {
      expect(period.periodEnd.getTime() - period.periodStart.getTime()).toBe(24 * 60 * 60 * 1000);
    }
  });
});
