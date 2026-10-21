import { randomUUID } from "crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../modules/db/client";
import { STEWARDSHIP_HEALTH_HREF, runStewardshipJob, type StepOutcome } from "../../modules/jobs/stewardshipJob";
import {
  STEWARDSHIP_LEASE_MS,
  STEWARDSHIP_LEASE_NAME,
  STEWARDSHIP_STALE_AFTER_MS,
  acquireStewardshipLease,
  closeAbandonedRuns,
  loadStewardshipHealth,
  pruneRuns,
  releaseStewardshipLease,
  renewStewardshipLease,
  type StepName,
} from "../../modules/db/repositories/stewardshipRunRepository";

// Phase 6K lifecycle hardening, F10 — the scheduled stewardship job: a lease so overlapping invocations cannot run it twice, a durable record of every
// run and step (a step that did part of its work is PARTIAL, a failed one says why, scrubbed), recovery of a crashed run, retry on the next run, and a
// notification only when a step keeps failing. Steps are replaced by fast stand-ins where the behaviour under test is the job's own; one test runs the
// real steps end to end. Isolated test database; no scheduler, no mail, no network.

const TAG = randomUUID().slice(0, 8);
const T = 120000;
const STARTED = new Date();
const ok = (counts: StepOutcome["counts"] = { examined: 1 }): (() => Promise<StepOutcome>) => async () => ({ status: "SUCCEEDED", counts });
const FAST: Record<StepName, () => Promise<StepOutcome>> = { lifecycleInvariants: ok(), metadataReview: ok(), unlistedReview: ok(), playlistChecks: ok(), emailDelivery: ok() };
const STEPS: StepName[] = ["lifecycleInvariants", "metadataReview", "unlistedReview", "playlistChecks", "emailDelivery"];
const run = (over: Partial<Record<StepName, () => Promise<StepOutcome>>> = {}, extra: Parameters<typeof runStewardshipJob>[0] = {}) => runStewardshipJob({ trigger: `TEST-${TAG}`, ...extra, stepOverrides: { ...FAST, ...over } });
const stepRows = (runId: string) => prisma.stewardshipStepRun.findMany({ where: { runId }, orderBy: [{ startedAt: "asc" }, { id: "asc" }] });
const runRow = (runId: string) => prisma.stewardshipRun.findUniqueOrThrow({ where: { id: runId } });
const problem = (step: StepName) => prisma.studioNotification.findUnique({ where: { dedupeKey: `stewardship-step-problem:${step}` } });
const failing = (message: string) => async (): Promise<StepOutcome> => {
  throw new Error(message);
};

async function freshLease() {
  await prisma.stewardshipLease.deleteMany({ where: { name: STEWARDSHIP_LEASE_NAME } });
}
async function clearProblemNotifications() {
  await prisma.studioNotification.deleteMany({ where: { dedupeKey: { startsWith: "stewardship-step-problem:" } } });
}

beforeAll(async () => {
  await freshLease();
}, T);

afterEach(async () => {
  vi.restoreAllMocks();
  await freshLease();
});

afterAll(async () => {
  await prisma.stewardshipRun.deleteMany({ where: { startedAt: { gte: new Date(STARTED.getTime() - 60_000) } } });
  await clearProblemNotifications();
  await prisma.stewardshipLease.deleteMany({ where: { name: STEWARDSHIP_LEASE_NAME } });
}, T);

describe("every run leaves a durable record", () => {
  it("records the run and each step in order, with timing and counts, and releases the lease", async () => {
    const result = await run();
    expect(result).toMatchObject({ ran: true, ok: true, status: "SUCCEEDED" });
    expect(result.steps.map((s) => [s.name, s.status])).toEqual(STEPS.map((s) => [s, "SUCCEEDED"]));
    const record = await runRow(result.runId!);
    expect(record).toMatchObject({ status: "SUCCEEDED", trigger: `TEST-${TAG}` });
    expect(record.finishedAt).not.toBeNull();
    const rows = await stepRows(result.runId!);
    expect(rows.map((r) => [r.step, r.status])).toEqual(STEPS.map((s) => [s, "SUCCEEDED"]));
    expect(rows.every((r) => r.finishedAt !== null && r.errorKind === null && (r.counts as { examined: number }).examined === 1)).toBe(true);
    // The lease is free again, so the next run can start immediately.
    expect((await run()).ran).toBe(true);
  }, T);

  it("the Studio health view reports the last run, the last full success, every step's latest result, and that nothing is wrong", async () => {
    await run();
    const health = await loadStewardshipHealth();
    expect(health.stale).toBe(false);
    expect(health.running).toBe(false);
    expect(health.lastRunStatus).toBe("SUCCEEDED");
    expect(health.lastFullSuccessAt).not.toBeNull();
    expect(health.steps.map((s) => s.step)).toEqual(STEPS);
    expect(health.steps.every((s) => s.status === "SUCCEEDED" && s.consecutiveProblems === 0)).toBe(true);
    expect(health.recentRuns[0]).toMatchObject({ status: "SUCCEEDED", problems: 0 });
  }, T);

  it("says the schedule has probably stopped when nothing has started for longer than the reporting threshold", async () => {
    await run();
    expect((await loadStewardshipHealth(new Date(Date.now() + STEWARDSHIP_STALE_AFTER_MS + 60_000))).stale).toBe(true);
    expect((await loadStewardshipHealth(new Date(Date.now() + 60_000))).stale).toBe(false);
  }, T);
});

describe("overlapping invocations cannot run the job twice at once", () => {
  it("of two simultaneous invocations exactly one runs; the other does nothing and says so (and that is not a failure)", async () => {
    const before = await prisma.stewardshipRun.count({ where: { trigger: `TEST-${TAG}` } });
    const slow = async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
    };
    const [a, b] = await Promise.all([run({}, { beforeStep: slow }), run({}, { beforeStep: slow })]);
    const ran = [a, b].filter((r) => r.ran);
    const skipped = [a, b].filter((r) => !r.ran);
    expect(ran).toHaveLength(1);
    expect(skipped).toHaveLength(1);
    expect(skipped[0]).toMatchObject({ ran: false, skipped: "ALREADY_RUNNING", ok: true, runId: null, steps: [] });
    expect(ran[0].ok).toBe(true);
    expect(await prisma.stewardshipRun.count({ where: { trigger: `TEST-${TAG}` } })).toBe(before + 1); // one run recorded, not two
  }, T);

  it("a lease can be taken only when free or expired, extended only by its holder, and a stolen lease stops the run", async () => {
    const t = new Date();
    expect(await acquireStewardshipLease("holder-1", t)).toBe(true);
    expect(await acquireStewardshipLease("holder-2", t)).toBe(false); // held
    expect(await renewStewardshipLease("holder-2", t)).toBe(false); // not theirs to extend
    expect(await renewStewardshipLease("holder-1", t)).toBe(true);
    await releaseStewardshipLease("holder-1", new Date(t.getTime() + 1000));
    expect(await acquireStewardshipLease("holder-2", new Date(t.getTime() + 2000))).toBe(true); // free after release
    // Expired without release (a crashed run): the next one may take it.
    expect(await acquireStewardshipLease("holder-3", new Date(t.getTime() + STEWARDSHIP_LEASE_MS + 5000))).toBe(true);
    expect(await renewStewardshipLease("holder-2", new Date())).toBe(false); // holder-2 lost it
  }, T);

  it("an invocation that arrives while a live lease is held by another (a crashed or slow run) does nothing; once it has expired the next run goes ahead", async () => {
    await prisma.stewardshipLease.create({ data: { name: STEWARDSHIP_LEASE_NAME, holder: "someone-else", leaseUntil: new Date(Date.now() + 5 * 60_000) } });
    expect((await run()).ran).toBe(false);
    await prisma.stewardshipLease.update({ where: { name: STEWARDSHIP_LEASE_NAME }, data: { leaseUntil: new Date(Date.now() - 1000) } });
    expect((await run()).ran).toBe(true);
  }, T);

  it("if the lease is lost part-way no further step is started; the skipped steps are recorded as skipped and the run is PARTIAL", async () => {
    const result = await run({}, { loseLeaseAfter: "metadataReview" });
    expect(result.status).toBe("PARTIAL");
    expect(result.ok).toBe(false);
    expect(result.steps.map((s) => [s.name, s.status])).toEqual([["lifecycleInvariants", "SUCCEEDED"], ["metadataReview", "SUCCEEDED"], ["unlistedReview", "SKIPPED"], ["playlistChecks", "SKIPPED"], ["emailDelivery", "SKIPPED"]]);
    const rows = await stepRows(result.runId!);
    expect(rows.filter((r) => r.status === "SKIPPED").every((r) => /lost its lease/.test(r.errorSummary ?? ""))).toBe(true);
  }, T);

  it("recovers from a run that crashed: its record is closed as abandoned, its open step as failed, and the next run is unaffected", async () => {
    const dead = await prisma.stewardshipRun.create({ data: { trigger: `TEST-${TAG}-dead`, status: "RUNNING", startedAt: new Date(Date.now() - 3 * STEWARDSHIP_LEASE_MS) } });
    await prisma.stewardshipStepRun.create({ data: { runId: dead.id, step: "unlistedReview", status: "RUNNING", startedAt: new Date(Date.now() - 3 * STEWARDSHIP_LEASE_MS) } });
    const alive = await prisma.stewardshipRun.create({ data: { trigger: `TEST-${TAG}-alive`, status: "RUNNING", startedAt: new Date() } }); // a genuinely current run is never closed by this
    expect(await closeAbandonedRuns(new Date())).toBeGreaterThanOrEqual(1);
    expect(await runRow(dead.id)).toMatchObject({ status: "ABANDONED" });
    expect((await stepRows(dead.id))[0]).toMatchObject({ status: "FAILED", errorKind: "Abandoned" });
    expect(await runRow(alive.id)).toMatchObject({ status: "RUNNING" });
    await prisma.stewardshipRun.update({ where: { id: alive.id }, data: { status: "SUCCEEDED", finishedAt: new Date() } });
    expect((await run()).ran).toBe(true);
  }, T);
});

describe("failures are recorded, not hidden", () => {
  it("a throwing step is FAILED with its error kind and a SCRUBBED summary; the other steps still run; the run is PARTIAL and not reported as success", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await run({ unlistedReview: failing("connect failed postgresql://app:Hunter2Secret@db.internal.example:5432/prod for sanjay.paul@example.test") });
    expect(result.ok).toBe(false);
    expect(result.status).toBe("PARTIAL");
    expect(result.steps.map((s) => [s.name, s.status])).toEqual([["lifecycleInvariants", "SUCCEEDED"], ["metadataReview", "SUCCEEDED"], ["unlistedReview", "FAILED"], ["playlistChecks", "SUCCEEDED"], ["emailDelivery", "SUCCEEDED"]]);
    const failed = (await stepRows(result.runId!)).find((r) => r.step === "unlistedReview")!;
    expect(failed).toMatchObject({ status: "FAILED", errorKind: "Error" });
    expect(failed.errorSummary).toMatch(/connect failed/);
    for (const secret of ["Hunter2Secret", "db.internal.example", "postgresql://", "sanjay.paul@example.test"]) {
      expect(failed.errorSummary).not.toContain(secret);
      expect(JSON.stringify(result)).not.toContain(secret);
      expect(log.mock.calls.map((c) => c.join(" ")).join("\n")).not.toContain(secret);
    }
    expect(log).toHaveBeenCalled(); // and it is logged for the operator
  }, T);

  it("a step that did part of its work is PARTIAL (not success, not total failure) and says what was not done", async () => {
    const result = await run({ metadataReview: async () => ({ status: "PARTIAL", counts: { examined: 3, failed: 2 }, problem: "2 page(s) could not be checked." }) });
    expect(result.status).toBe("PARTIAL");
    expect(result.ok).toBe(false);
    const row = (await stepRows(result.runId!)).find((r) => r.step === "metadataReview")!;
    expect(row).toMatchObject({ status: "PARTIAL", errorSummary: "2 page(s) could not be checked." });
    expect((row.counts as { failed: number }).failed).toBe(2);
    expect((await loadStewardshipHealth()).steps.find((s) => s.step === "metadataReview")).toMatchObject({ status: "PARTIAL", consecutiveProblems: 1 });
  }, T);

  it("when every step fails the run is FAILED", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await run(Object.fromEntries(STEPS.map((s) => [s, failing(`boom ${s}`)])) as Record<StepName, () => Promise<StepOutcome>>);
    expect(result).toMatchObject({ status: "FAILED", ok: false });
    expect((await runRow(result.runId!)).status).toBe("FAILED");
    await clearProblemNotifications();
  }, T);

  it("the real steps run end to end against the test database and all succeed (nothing is configured, so e-mail is skipped honestly)", async () => {
    const result = await runStewardshipJob({ trigger: `TEST-${TAG}-real` });
    expect(result.steps.map((s) => [s.name, s.status])).toEqual(STEPS.map((s) => [s, "SUCCEEDED"]));
    expect(result.ok).toBe(true);
    const counts = Object.fromEntries(result.steps.map((s) => [s.name, s.counts]));
    expect(counts.lifecycleInvariants).toMatchObject({ failed: 0, completed: true });
    expect(counts.metadataReview).toMatchObject({ failed: 0, completed: true });
    expect(counts.unlistedReview).toMatchObject({ failedBatches: 0 });
    expect(counts.playlistChecks).toMatchObject({ failedBatches: 0, notificationFailures: 0 });
    // Counts only: nothing in the response can name a title or an address.
    expect(Object.values(counts).every((c) => Object.values(c!).every((v) => typeof v === "number" || typeof v === "boolean" || typeof v === "string" || v === null))).toBe(true);
  }, T);
});

describe("retry, and notifying only when a step keeps failing", () => {
  it("one failure is recorded and shown in Health but notifies nobody; a second failure in a row raises ONE notification; more failures do not repeat it; success resolves it", async () => {
    await clearProblemNotifications();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const bad = { playlistChecks: failing("transient problem one") };

    await run(bad);
    expect(await problem("playlistChecks")).toBeNull(); // a single failure is not an interruption
    expect((await loadStewardshipHealth()).steps.find((s) => s.step === "playlistChecks")!.consecutiveProblems).toBe(1);

    await run({ playlistChecks: failing("transient problem two") });
    const raised = await problem("playlistChecks");
    expect(raised).toMatchObject({ kind: "STEWARDSHIP_JOB_PROBLEM", status: "OPEN", audienceAction: "SETTINGS_MANAGE", href: STEWARDSHIP_HEALTH_HREF, occurrenceCount: 1 });
    expect(raised!.body).toMatch(/2 runs in a row/);

    await run({ playlistChecks: failing("transient problem two") });
    await run({ playlistChecks: failing("transient problem two") });
    expect((await problem("playlistChecks"))!.occurrenceCount).toBe(1); // the same ongoing failure is not announced again

    const recovered = await run(); // the next run retries the step and it works
    expect(recovered.ok).toBe(true);
    expect((await problem("playlistChecks"))!.status).toBe("RESOLVED");
    expect((await loadStewardshipHealth()).steps.find((s) => s.step === "playlistChecks")).toMatchObject({ status: "SUCCEEDED", consecutiveProblems: 0 });
    await clearProblemNotifications();
  }, T);

  it("a step that was skipped (lease lost) neither counts as a failure nor clears one", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await run({ emailDelivery: failing("down") });
    await run({ emailDelivery: failing("down") }, { loseLeaseAfter: "playlistChecks" }); // emailDelivery is skipped this time
    expect((await loadStewardshipHealth()).steps.find((s) => s.step === "emailDelivery")!.consecutiveProblems).toBe(1);
    await run();
    await clearProblemNotifications();
  }, T);
});

describe("old runs are pruned, never one in progress", () => {
  it("keeps the newest runs and removes the rest with their steps", async () => {
    const base = Date.now() - 10 * 86_400_000;
    const ids: string[] = [];
    for (let i = 0; i < 8; i++) {
      const row = await prisma.stewardshipRun.create({ data: { trigger: `TEST-${TAG}-prune`, status: i === 0 ? "RUNNING" : "SUCCEEDED", startedAt: new Date(base + i * 1000) } });
      await prisma.stewardshipStepRun.create({ data: { runId: row.id, step: "emailDelivery", status: "SUCCEEDED", startedAt: new Date(base + i * 1000) } });
      ids.push(row.id);
    }
    const total = await prisma.stewardshipRun.count();
    const removed = await pruneRuns(total - 4); // keep the 4 newest overall
    expect(removed).toBeGreaterThanOrEqual(3);
    const left = await prisma.stewardshipRun.findMany({ where: { id: { in: ids } } });
    expect(left.some((r) => r.status === "RUNNING")).toBe(true); // the oldest was RUNNING, so it was kept
    expect(await prisma.stewardshipStepRun.count({ where: { runId: { in: ids.filter((id) => !left.some((r) => r.id === id)) } } })).toBe(0); // steps went with their runs
  }, T);
});
