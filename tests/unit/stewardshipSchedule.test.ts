import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { STEWARDSHIP_SCHEDULE_JITTER_MS, STEWARDSHIP_SCHEDULE_PERIOD_MS, STEWARDSHIP_STALE_AFTER_MS, isStewardshipOverdue } from "../../modules/jobs/stewardshipSchedule";

// Studio -> Health's "the schedule has probably stopped" threshold, for the once-a-day schedule in vercel.json (03:30 UTC). A healthy daily run must never trip it,
// including with the Hobby plan's up-to-an-hour timing latitude; a genuinely missed day must.

const H = 3_600_000;
const MIN = 60_000;
const at = (iso: string) => new Date(iso);

describe("the threshold", () => {
  it("is 26 hours: the daily period, the Hobby plan's hour of latitude and a one-hour margin", () => {
    expect(STEWARDSHIP_STALE_AFTER_MS).toBe(26 * H);
    expect(STEWARDSHIP_STALE_AFTER_MS).toBe(STEWARDSHIP_SCHEDULE_PERIOD_MS + STEWARDSHIP_SCHEDULE_JITTER_MS + 60 * MIN);
  });

  it("fits the schedule actually configured in vercel.json (a schedule that runs less often than the threshold allows fails here)", () => {
    const config = JSON.parse(readFileSync(path.resolve(__dirname, "../../vercel.json"), "utf8")) as { crons: Array<{ path: string; schedule: string }> };
    const cron = config.crons.find((c) => c.path === "/api/cron/stewardship");
    expect(cron, "vercel.json must schedule the stewardship endpoint").toBeDefined();
    const [minute, hour, dom, month, dow] = cron!.schedule.split(" ");
    const daily = /^\d+$/.test(minute) && /^\d+$/.test(hour) && dom === "*" && month === "*" && dow === "*";
    expect(daily, `${cron!.schedule} is expected to be a once-a-day expression`).toBe(true);
    // the longest gap between two healthy runs: one period, plus the latitude (one run at the start of the hour, the next at its end)
    const longestHealthyGap = STEWARDSHIP_SCHEDULE_PERIOD_MS + STEWARDSHIP_SCHEDULE_JITTER_MS - MIN;
    expect(STEWARDSHIP_STALE_AFTER_MS).toBeGreaterThan(longestHealthyGap);
    // and it is not so long that a whole missed day goes unnoticed for more than a few hours
    expect(STEWARDSHIP_STALE_AFTER_MS).toBeLessThan(STEWARDSHIP_SCHEDULE_PERIOD_MS + 4 * H);
  });
});

describe("isStewardshipOverdue", () => {
  const scheduled = at("2026-10-26T03:30:00Z");

  it("a healthy daily schedule is never overdue: just after a run, mid-day, and the moment before the next one", () => {
    expect(isStewardshipOverdue(scheduled, at("2026-10-26T03:31:00Z"))).toBe(false);
    expect(isStewardshipOverdue(scheduled, at("2026-10-26T15:00:00Z"))).toBe(false);
    expect(isStewardshipOverdue(scheduled, at("2026-10-27T03:29:00Z"))).toBe(false);
  });

  it("tolerates the Hobby plan's latitude: a run at 03:00 followed by the next at 03:59 (24 h 59 min apart) is healthy, and so is waiting for a late one", () => {
    const early = at("2026-10-26T03:00:00Z");
    expect(isStewardshipOverdue(early, at("2026-10-27T03:59:00Z"))).toBe(false);
    expect(isStewardshipOverdue(early, at("2026-10-27T04:59:00Z"))).toBe(false); // 25 h 59 min: still within the threshold
  });

  it("a genuinely overdue run is reported: more than 26 hours without a start (a missed day)", () => {
    expect(isStewardshipOverdue(scheduled, at("2026-10-27T05:30:00Z"))).toBe(false); // exactly 26 h: not yet
    expect(isStewardshipOverdue(scheduled, at("2026-10-27T05:31:00Z"))).toBe(true);
    expect(isStewardshipOverdue(scheduled, at("2026-10-28T03:30:00Z"))).toBe(true); // two days
  });

  it("a job that has never run is overdue (missing configuration or no scheduler)", () => {
    expect(isStewardshipOverdue(null, at("2026-10-26T03:30:00Z"))).toBe(true);
  });

  it("the old three-hour behaviour is gone: a run 5 hours ago is healthy", () => {
    expect(isStewardshipOverdue(at("2026-10-26T03:30:00Z"), at("2026-10-26T08:30:00Z"))).toBe(false);
  });
});

describe("what the Health page says", () => {
  const page = readFileSync(path.resolve(__dirname, "../../app/(studio)/studio/(protected)/health/page.tsx"), "utf8");

  it("derives the number of hours from the threshold instead of hard-coding it", () => {
    expect(page).toMatch(/STEWARDSHIP_STALE_AFTER_MS \/ 3_600_000/);
    expect(page).not.toMatch(/three hours|3 hours/i);
  });

  it("still reports 'never run' and an overdue schedule as errors, and still lists steps that did not succeed", () => {
    expect(page).toMatch(/The job has never run/);
    expect(page).toMatch(/The schedule has probably stopped/);
    expect(page).toMatch(/did not fully succeed last time/);
  });
});
