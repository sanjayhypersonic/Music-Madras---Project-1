import { describe, expect, it } from "vitest";
import { runYouTubeAnalyticsSync, type YouTubeAnalyticsSyncRepositoryPort } from "../../modules/analytics/youtube/runYouTubeAnalyticsSync";
import type { YouTubeAnalyticsAdapter, YouTubeAnalyticsObservationInput } from "../../modules/analytics/youtube/youtubeAnalyticsTypes";

// In-memory fakes — no network, no database. The fake repository simulates
// the real repository's idempotent-upsert behavior (keyed the same way the
// Prisma unique constraint is) so this test genuinely exercises "duplicate
// observation handling" (brief §19) without touching Postgres.

class InMemoryFakeRepository implements YouTubeAnalyticsSyncRepositoryPort {
  public rows = new Map<string, YouTubeAnalyticsObservationInput>();

  private key(input: YouTubeAnalyticsObservationInput): string {
    return [input.scope, input.youtubeVideoId, input.channelId, input.metric, input.periodStart.toISOString(), input.periodEnd.toISOString()].join(
      "|"
    );
  }

  async upsertObservation(input: YouTubeAnalyticsObservationInput): Promise<void> {
    this.rows.set(this.key(input), input);
  }
}

class FakeAdapter implements YouTubeAnalyticsAdapter {
  public callCount = 0;
  constructor(
    private readonly observationsPerPeriod: (periodStart: Date) => YouTubeAnalyticsObservationInput[],
    private readonly failOnCallNumber?: number
  ) {}

  async fetchObservations(request: {
    scope: "CHANNEL" | "VIDEO";
    targetIds: string[];
    metrics: YouTubeAnalyticsObservationInput["metric"][];
    periodStart: Date;
    periodEnd: Date;
  }): Promise<YouTubeAnalyticsObservationInput[]> {
    this.callCount++;
    if (this.failOnCallNumber && this.callCount === this.failOnCallNumber) {
      throw new Error("simulated YouTube Analytics API failure");
    }
    return this.observationsPerPeriod(request.periodStart);
  }
}

const NOW = new Date(Date.UTC(2026, 0, 31));

function makeObservation(periodStart: Date): YouTubeAnalyticsObservationInput {
  return {
    scope: "VIDEO",
    youtubeVideoId: "video-1",
    metric: "VIEWS",
    periodStart,
    periodEnd: new Date(periodStart.getTime() + 24 * 60 * 60 * 1000),
    value: 42,
  };
}

describe("runYouTubeAnalyticsSync", () => {
  it("upserts one observation per planned period and advances the checkpoint", async () => {
    const repository = new InMemoryFakeRepository();
    const adapter = new FakeAdapter((periodStart) => [makeObservation(periodStart)]);

    const result = await runYouTubeAnalyticsSync(adapter, repository, {
      scope: "VIDEO",
      targetIds: ["video-1"],
      metrics: ["VIEWS"],
      lastSyncedPeriodEnd: new Date(Date.UTC(2026, 0, 27)),
      now: NOW,
      reportingLagDays: 2,
    });

    expect(result.periodsSucceeded).toBe(2); // Jan 27 and Jan 28 (Jan 29/30 excluded by 2-day lag, Jan 31 is "now")
    expect(repository.rows.size).toBe(2);
    expect(result.lastSyncedPeriodEnd?.toISOString()).toBe(new Date(Date.UTC(2026, 0, 29)).toISOString());
  });

  it("re-running the same sync is idempotent — no duplicate rows", async () => {
    const repository = new InMemoryFakeRepository();
    const options = {
      scope: "VIDEO" as const,
      targetIds: ["video-1"],
      metrics: ["VIEWS" as const],
      lastSyncedPeriodEnd: new Date(Date.UTC(2026, 0, 27)),
      now: NOW,
      reportingLagDays: 2,
    };

    const adapter1 = new FakeAdapter((periodStart) => [makeObservation(periodStart)]);
    await runYouTubeAnalyticsSync(adapter1, repository, options);
    const sizeAfterFirstRun = repository.rows.size;

    const adapter2 = new FakeAdapter((periodStart) => [makeObservation(periodStart)]);
    await runYouTubeAnalyticsSync(adapter2, repository, {
      ...options,
      lastSyncedPeriodEnd: new Date(Date.UTC(2026, 0, 27)), // deliberately re-run from the same starting point
    });

    expect(repository.rows.size).toBe(sizeAfterFirstRun); // upsert, not duplicate insert
  });

  it("stops advancing the checkpoint at the first failing period (partial failure handling, brief §10)", async () => {
    const repository = new InMemoryFakeRepository();
    // Period 1 (Jan 27) succeeds, period 2 (Jan 28) fails.
    const adapter = new FakeAdapter((periodStart) => [makeObservation(periodStart)], 2);

    const result = await runYouTubeAnalyticsSync(adapter, repository, {
      scope: "VIDEO",
      targetIds: ["video-1"],
      metrics: ["VIEWS"],
      lastSyncedPeriodEnd: new Date(Date.UTC(2026, 0, 27)),
      now: NOW,
      reportingLagDays: 2,
      maxAttemptsPerPeriod: 1,
    });

    expect(result.periodsSucceeded).toBe(1);
    expect(result.periodsFailed).toBe(1);
    expect(result.errors).toHaveLength(1);
    // Checkpoint only advances past the successful period, not the failed one.
    expect(result.lastSyncedPeriodEnd?.toISOString()).toBe(new Date(Date.UTC(2026, 0, 28)).toISOString());
  });

  it("retries a failing period up to the configured attempt count before giving up", async () => {
    const repository = new InMemoryFakeRepository();
    // Fails on the very first call only; a retry should succeed.
    const adapter = new FakeAdapter((periodStart) => [makeObservation(periodStart)], 1);

    const result = await runYouTubeAnalyticsSync(adapter, repository, {
      scope: "VIDEO",
      targetIds: ["video-1"],
      metrics: ["VIEWS"],
      lastSyncedPeriodEnd: new Date(Date.UTC(2026, 0, 27)),
      now: NOW,
      reportingLagDays: 2,
      maxAttemptsPerPeriod: 2,
    });

    expect(result.periodsFailed).toBe(0);
    expect(adapter.callCount).toBeGreaterThan(1);
  });

  it("caps the number of periods attempted per run for quota awareness (brief §10)", async () => {
    const repository = new InMemoryFakeRepository();
    const adapter = new FakeAdapter((periodStart) => [makeObservation(periodStart)]);

    const result = await runYouTubeAnalyticsSync(adapter, repository, {
      scope: "VIDEO",
      targetIds: ["video-1"],
      metrics: ["VIEWS"],
      lastSyncedPeriodEnd: null,
      now: NOW,
      backfillDays: 10,
      reportingLagDays: 2,
      maxPeriodsPerRun: 3,
    });

    expect(result.periodsPlanned).toBeGreaterThan(3);
    expect(result.periodsAttempted).toBe(3);
    expect(result.periodsSucceeded).toBe(3);
  });
});
