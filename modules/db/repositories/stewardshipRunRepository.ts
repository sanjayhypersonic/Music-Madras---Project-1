import { prisma } from "../client";
import type { Prisma, StewardshipRunStatus, StewardshipStepStatus } from "@prisma/client";

// Phase 6K lifecycle hardening (F10) — the durable record of the scheduled stewardship job, and the lease that keeps two invocations from running it at
// the same time. Nothing here chooses or configures a scheduler: whatever calls /api/cron/stewardship leaves a record behind it.
//
//   LEASE   one named row. An invocation takes it with a single atomic statement (insert, or take over an EXPIRED lease); a second invocation that
//           arrives while it is held does nothing and says so. The holder extends it between steps. A crashed run never blocks the next one: its lease
//           simply expires, and the next run closes its abandoned record.
//   RUNS    one row per run, one per step, with status, timing, counts, and a scrubbed failure description (modules/jobs/scrubError.ts).
//   HEALTH  what Studio shows: the latest result of every step, when the job last ran and last fully succeeded, whether it is running now, and whether
//           it appears to have stopped.

export const STEWARDSHIP_LEASE_NAME = "stewardship";
/** How long one invocation may hold the lease without extending it. A technical bound, longer than the whole run should take. */
export const STEWARDSHIP_LEASE_MS = 10 * 60_000;
/** Runs kept (the oldest are pruned when a run finishes). */
export const STEWARDSHIP_RETAINED_RUNS = 500;
/** How long without a run starting before Studio says the job has probably stopped. A reporting threshold only: nothing is decided by it. */
export const STEWARDSHIP_STALE_AFTER_MS = 3 * 60 * 60_000;

export type StepName = "lifecycleInvariants" | "metadataReview" | "unlistedReview" | "playlistChecks" | "emailDelivery";

/** Takes the lease if it is free or expired. One atomic statement, so two simultaneous callers cannot both win. */
export async function acquireStewardshipLease(holder: string, now: Date, ttlMs: number = STEWARDSHIP_LEASE_MS): Promise<boolean> {
  const until = new Date(now.getTime() + ttlMs);
  const rows = await prisma.$queryRaw<Array<{ holder: string }>>`
    insert into stewardship_leases ("name", "holder", "leaseUntil", "acquiredAt", "heartbeatAt")
    values (${STEWARDSHIP_LEASE_NAME}, ${holder}, ${until}, ${now}, ${now})
    on conflict ("name") do update
      set "holder" = excluded."holder", "leaseUntil" = excluded."leaseUntil", "acquiredAt" = excluded."acquiredAt", "heartbeatAt" = excluded."heartbeatAt"
      where stewardship_leases."leaseUntil" < ${now}
    returning "holder"`;
  return rows.length === 1 && rows[0].holder === holder;
}

/** Extends the lease while this holder still has it. False means it was lost (it expired and another invocation took it): the run must stop. */
export async function renewStewardshipLease(holder: string, now: Date, ttlMs: number = STEWARDSHIP_LEASE_MS): Promise<boolean> {
  const until = new Date(now.getTime() + ttlMs);
  const changed = await prisma.$executeRaw`
    update stewardship_leases set "leaseUntil" = ${until}, "heartbeatAt" = ${now}
    where "name" = ${STEWARDSHIP_LEASE_NAME} and "holder" = ${holder}`;
  return changed === 1;
}

export async function releaseStewardshipLease(holder: string, now: Date): Promise<void> {
  await prisma.$executeRaw`
    update stewardship_leases set "leaseUntil" = ${now}
    where "name" = ${STEWARDSHIP_LEASE_NAME} and "holder" = ${holder}`;
}

export async function startRun(trigger: string, now: Date): Promise<string> {
  const run = await prisma.stewardshipRun.create({ data: { trigger: trigger.slice(0, 40), startedAt: now } });
  return run.id;
}

/** Closes the record of any run still RUNNING whose lease must have expired (its invocation died): it is marked ABANDONED, and so are its open steps. */
export async function closeAbandonedRuns(now: Date, leaseMs: number = STEWARDSHIP_LEASE_MS): Promise<number> {
  const cutoff = new Date(now.getTime() - leaseMs);
  const stale = await prisma.stewardshipRun.findMany({ where: { status: "RUNNING", startedAt: { lt: cutoff } }, select: { id: true } });
  if (stale.length === 0) return 0;
  const ids = stale.map((r) => r.id);
  await prisma.stewardshipStepRun.updateMany({ where: { runId: { in: ids }, status: "RUNNING" }, data: { status: "FAILED", finishedAt: now, errorKind: "Abandoned", errorSummary: "The run stopped reporting (its invocation ended without finishing this step)." } });
  await prisma.stewardshipRun.updateMany({ where: { id: { in: ids } }, data: { status: "ABANDONED", finishedAt: now } });
  return stale.length;
}

export async function startStep(runId: string, step: StepName, now: Date): Promise<string> {
  const row = await prisma.stewardshipStepRun.create({ data: { runId, step, startedAt: now } });
  return row.id;
}

export async function finishStep(stepId: string, input: { status: Exclude<StewardshipStepStatus, "RUNNING">; now: Date; counts?: Prisma.InputJsonValue; errorKind?: string | null; errorSummary?: string | null }): Promise<void> {
  await prisma.stewardshipStepRun.update({
    where: { id: stepId },
    data: { status: input.status, finishedAt: input.now, counts: input.counts, errorKind: input.errorKind ?? null, errorSummary: input.errorSummary ?? null },
  });
}

export async function recordSkippedStep(runId: string, step: StepName, now: Date, reason: string): Promise<void> {
  await prisma.stewardshipStepRun.create({ data: { runId, step, status: "SKIPPED", startedAt: now, finishedAt: now, errorKind: "Skipped", errorSummary: reason.slice(0, 200) } });
}

export async function finishRun(runId: string, status: Exclude<StewardshipRunStatus, "RUNNING">, now: Date): Promise<void> {
  await prisma.stewardshipRun.update({ where: { id: runId }, data: { status, finishedAt: now } });
}

/** Keeps the newest STEWARDSHIP_RETAINED_RUNS runs; older ones (and their steps, by cascade) are removed. Best effort. */
export async function pruneRuns(retain: number = STEWARDSHIP_RETAINED_RUNS): Promise<number> {
  const cutoff = await prisma.stewardshipRun.findMany({ orderBy: [{ startedAt: "desc" }, { id: "asc" }], skip: retain, take: 1, select: { startedAt: true } });
  if (cutoff.length === 0) return 0;
  const removed = await prisma.stewardshipRun.deleteMany({ where: { startedAt: { lte: cutoff[0].startedAt }, status: { not: "RUNNING" } } });
  return removed.count;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Health (what Studio shows)
// ---------------------------------------------------------------------------------------------------------------------------------

export interface StepHealth {
  step: string;
  status: StewardshipStepStatus;
  startedAt: Date;
  finishedAt: Date | null;
  counts: unknown;
  errorKind: string | null;
  errorSummary: string | null;
  /** How many of the most recent runs of this step in a row did not succeed (0 when the latest succeeded). */
  consecutiveProblems: number;
  lastSucceededAt: Date | null;
}

export interface StewardshipHealth {
  /** A run holds the lease right now. */
  running: boolean;
  lastRunAt: Date | null;
  lastRunStatus: StewardshipRunStatus | null;
  /** The last run in which every step succeeded. */
  lastFullSuccessAt: Date | null;
  /** No run has started within STEWARDSHIP_STALE_AFTER_MS (or none ever has): the schedule is probably not running. */
  stale: boolean;
  steps: StepHealth[];
  recentRuns: Array<{ id: string; trigger: string; status: StewardshipRunStatus; startedAt: Date; finishedAt: Date | null; problems: number }>;
}

export const STEWARDSHIP_STEPS: readonly StepName[] = ["lifecycleInvariants", "metadataReview", "unlistedReview", "playlistChecks", "emailDelivery"];

export async function loadStewardshipHealth(now: Date = new Date()): Promise<StewardshipHealth> {
  const [lease, lastRun, lastFull, recent] = await Promise.all([
    prisma.stewardshipLease.findUnique({ where: { name: STEWARDSHIP_LEASE_NAME } }),
    prisma.stewardshipRun.findFirst({ orderBy: [{ startedAt: "desc" }, { id: "asc" }] }),
    prisma.stewardshipRun.findFirst({ where: { status: "SUCCEEDED" }, orderBy: [{ startedAt: "desc" }, { id: "asc" }] }),
    prisma.stewardshipRun.findMany({ orderBy: [{ startedAt: "desc" }, { id: "asc" }], take: 15, include: { steps: { select: { status: true } } } }),
  ]);

  const steps: StepHealth[] = [];
  for (const step of STEWARDSHIP_STEPS) {
    const history = await prisma.stewardshipStepRun.findMany({ where: { step, status: { not: "RUNNING" } }, orderBy: [{ startedAt: "desc" }, { id: "asc" }], take: 20 });
    if (history.length === 0) continue;
    const latest = history[0];
    let consecutive = 0;
    for (const row of history) {
      if (row.status === "SUCCEEDED") break;
      if (row.status === "SKIPPED") continue; // a step that was not reached says nothing about the step itself
      consecutive += 1;
    }
    steps.push({
      step,
      status: latest.status,
      startedAt: latest.startedAt,
      finishedAt: latest.finishedAt,
      counts: latest.counts,
      errorKind: latest.errorKind,
      errorSummary: latest.errorSummary,
      consecutiveProblems: consecutive,
      lastSucceededAt: history.find((h) => h.status === "SUCCEEDED")?.finishedAt ?? null,
    });
  }

  return {
    running: lease !== null && lease.leaseUntil.getTime() > now.getTime(),
    lastRunAt: lastRun?.startedAt ?? null,
    lastRunStatus: lastRun?.status ?? null,
    lastFullSuccessAt: lastFull?.startedAt ?? null,
    stale: lastRun === null || now.getTime() - lastRun.startedAt.getTime() > STEWARDSHIP_STALE_AFTER_MS,
    steps,
    recentRuns: recent.map((r) => ({ id: r.id, trigger: r.trigger, status: r.status, startedAt: r.startedAt, finishedAt: r.finishedAt, problems: r.steps.filter((s) => s.status === "FAILED" || s.status === "PARTIAL").length })),
  };
}
