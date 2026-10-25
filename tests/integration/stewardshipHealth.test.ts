import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../modules/db/client";
import { STEWARDSHIP_STALE_AFTER_MS, loadStewardshipHealth } from "../../modules/db/repositories/stewardshipRunRepository";

// Studio -> Health's view of the once-a-day stewardship schedule, read from real run records: a healthy daily schedule is not "stopped", a run that FAILED is shown as
// failed (not hidden by being recent), and a genuinely overdue schedule or a job that never ran is reported. The runs are placed in the far future so they are the
// newest rows in the table whatever else the shared test database holds, and are removed afterwards.

const T = 60000;
const TAG = `health-${randomUUID().slice(0, 8)}`;
const BASE = new Date("2099-01-01T03:30:00.000Z");
const H = 3_600_000;
const at = (offsetMs: number) => new Date(BASE.getTime() + offsetMs);

async function run(offsetMs: number, status: "SUCCEEDED" | "FAILED" | "PARTIAL", steps: Array<{ step: "lifecycleInvariants" | "emailDelivery"; status: "SUCCEEDED" | "FAILED" | "PARTIAL" }>) {
  const row = await prisma.stewardshipRun.create({ data: { trigger: `TEST-${TAG}`, status, startedAt: at(offsetMs), finishedAt: at(offsetMs + 20_000) } });
  for (const s of steps) await prisma.stewardshipStepRun.create({ data: { runId: row.id, step: s.step, status: s.status, startedAt: at(offsetMs), finishedAt: at(offsetMs + 5_000), errorKind: s.status === "FAILED" ? "Boom" : null, errorSummary: s.status === "FAILED" ? "A test failure." : null } });
  return row;
}
const clear = async () => {
  await prisma.stewardshipRun.deleteMany({ where: { trigger: `TEST-${TAG}` } }); // steps go with their run
};

beforeAll(clear, T);
afterAll(clear, T);

describe("Studio -> Health on the once-a-day schedule", () => {
  it("a healthy daily schedule is not reported as stopped, at any point of the day", async () => {
    await clear();
    await run(0, "SUCCEEDED", [{ step: "lifecycleInvariants", status: "SUCCEEDED" }, { step: "emailDelivery", status: "SUCCEEDED" }]);
    for (const hoursLater of [0.1, 6, 12, 23, 25]) {
      const health = await loadStewardshipHealth(at(hoursLater * H));
      expect(health.stale, `${hoursLater} h after the run`).toBe(false);
      expect(health.lastRunStatus).toBe("SUCCEEDED");
    }
  }, T);

  it("a genuinely overdue run is reported once the threshold has passed, and not a minute earlier", async () => {
    await clear();
    await run(0, "SUCCEEDED", [{ step: "emailDelivery", status: "SUCCEEDED" }]);
    expect((await loadStewardshipHealth(at(STEWARDSHIP_STALE_AFTER_MS))).stale).toBe(false);
    expect((await loadStewardshipHealth(at(STEWARDSHIP_STALE_AFTER_MS + 60_000))).stale).toBe(true);
    expect((await loadStewardshipHealth(at(48 * H))).stale).toBe(true);
  }, T);

  it("a failed run is NOT hidden by being recent: it is not 'overdue', but its status and failing step are reported", async () => {
    await clear();
    await run(0, "FAILED", [{ step: "lifecycleInvariants", status: "SUCCEEDED" }, { step: "emailDelivery", status: "FAILED" }]);
    const health = await loadStewardshipHealth(at(2 * H));
    expect(health.stale).toBe(false);
    expect(health.lastRunStatus).toBe("FAILED");
    expect(health.lastFullSuccessAt?.getTime()).not.toBe(BASE.getTime()); // the failed run is never presented as the last full success (older real rows in a shared database may exist)
    const email = health.steps.find((s) => s.step === "emailDelivery");
    expect(email).toMatchObject({ status: "FAILED", errorKind: "Boom" });
    expect(email!.consecutiveProblems).toBeGreaterThanOrEqual(1);
    expect(health.recentRuns[0]).toMatchObject({ status: "FAILED", problems: 1 });
  }, T);

  it("a run that only partly succeeded is reported as such, and a later full success clears the step's problem count", async () => {
    await clear();
    await run(0, "PARTIAL", [{ step: "emailDelivery", status: "PARTIAL" }]);
    expect((await loadStewardshipHealth(at(H))).lastRunStatus).toBe("PARTIAL");
    await run(24 * H, "SUCCEEDED", [{ step: "emailDelivery", status: "SUCCEEDED" }]);
    const health = await loadStewardshipHealth(at(25 * H));
    expect(health.lastRunStatus).toBe("SUCCEEDED");
    expect(health.steps.find((s) => s.step === "emailDelivery")?.consecutiveProblems).toBe(0);
    expect(health.stale).toBe(false);
  }, T);

  it("a failed run that is also overdue is reported as overdue (a stopped schedule is not masked by its last, failed run)", async () => {
    await clear();
    await run(0, "FAILED", [{ step: "emailDelivery", status: "FAILED" }]);
    const health = await loadStewardshipHealth(at(30 * H));
    expect(health.stale).toBe(true);
    expect(health.lastRunStatus).toBe("FAILED");
  }, T);
});
