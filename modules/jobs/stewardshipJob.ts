import { randomUUID } from "crypto";
import { processEmailDeliveries, raiseNotification, resolveNotification } from "../db/repositories/studioNotificationRepository";
import { runPlaylistQualitySweep } from "../db/repositories/playlistPageRepository";
import { runUnlistedReviewSweep } from "../db/repositories/unlistedReviewRepository";
import { runLifecycleInvariantSweep } from "../db/repositories/videoLifecycleRepository";
import { runMetadataReviewSweep } from "../db/repositories/videoMetadataReviewRepository";
import {
  STEWARDSHIP_STEPS,
  acquireStewardshipLease,
  closeAbandonedRuns,
  finishRun,
  finishStep,
  loadStewardshipHealth,
  pruneRuns,
  recordSkippedStep,
  releaseStewardshipLease,
  renewStewardshipLease,
  startRun,
  startStep,
  type StepName,
} from "../db/repositories/stewardshipRunRepository";
import { describeError } from "./scrubError";
import type { EmailProvider } from "../auth/email/emailProvider";
import type { Prisma, StewardshipRunStatus, StewardshipStepStatus } from "@prisma/client";

// Phase 6K fix (F7/F10), lifecycle hardening — the scheduled-maintenance JOB: the one function a scheduler calls (through app/api/cron/stewardship/route.ts).
// It is the Scheduler/Trigger → Job → Service layering of ADR-0001 §12: this module knows nothing about HTTP or about any particular scheduler.
//
// What a run does, in order, each step independent (one failing never stops the others):
//   1. lifecycleInvariants  finds and repairs any public-exposure approval on an archived page or a private video;
//   2. metadataReview       notices material metadata changes on approved pages and records the baselines of pages approved before this existed;
//   3. unlistedReview       the review queue, its single notification, and the carried-over and metadata-review reminders;
//   4. playlistChecks       re-checks every published playlist page against its published snapshot, and the standing "cannot be published yet" notices;
//   5. emailDelivery        sends the queued notification e-mails through the configured provider (claimed per delivery, bounded retries, honest statuses).
//
// What makes it reliable and observable:
//   - A LEASE: an invocation that arrives while another holds it does nothing and says so (`skipped`). The holder extends the lease between steps; a
//     crashed run's lease simply expires, and the next run closes its abandoned record. If the lease is ever lost the run stops starting steps.
//   - A DURABLE RECORD of every run and step (status, timing, counts, a scrubbed failure description) in stewardship_runs / stewardship_step_runs,
//     shown in Studio (Health). A step that did only part of its work is PARTIAL, not a success; a run that is not entirely SUCCEEDED is reported as a
//     problem to whatever called it (HTTP 500), never as success merely because the request completed.
//   - A step that fails twice in a row raises one deduplicated administrator notification, resolved when it next succeeds.
//   - RETRY is the next invocation: every step is idempotent and picks up where the data stands (a failed batch's records are simply handled next time).
// Nothing here selects or configures a scheduler. Every step is safe to run on several instances at once and more often than intended.

export interface StepOutcome {
  status: Extract<StewardshipStepStatus, "SUCCEEDED" | "PARTIAL" | "FAILED">;
  /** Counts only: no titles, addresses or other content. */
  counts: Record<string, number | boolean | string | null>;
  /** For PARTIAL / FAILED: what was not done, in plain words (no content). */
  problem?: string;
}

export interface StewardshipJobResult {
  /** False when another invocation held the lease and this one did nothing. */
  ran: boolean;
  skipped?: "ALREADY_RUNNING";
  runId: string | null;
  status: StewardshipRunStatus | null;
  ranAt: string;
  steps: Array<{ name: StepName; status: StewardshipStepStatus; counts: StepOutcome["counts"] | null }>;
  /** True only when nothing went wrong: every step succeeded, or the invocation was a harmless overlap. */
  ok: boolean;
}

export interface StewardshipJobOptions {
  now?: Date;
  /** Who started this run: recorded in the run (a short label such as HTTP). */
  trigger?: string;
  /** Tests inject a provider; production passes nothing and the deployment's configured provider is used (an unconfigured deployment skips honestly). */
  emailProvider?: EmailProvider;
  /** A technical bound on how long the sweeps may keep starting new batches (the e-mail step then still runs). Default 40 s. */
  sweepBudgetMs?: number;
  /** Tests only: replaces a step's work (to simulate a failing, partial or slow step). */
  stepOverrides?: Partial<Record<StepName, () => Promise<StepOutcome>>>;
  /** Tests only: called before each step starts, with its name. */
  beforeStep?: (step: StepName) => Promise<void>;
  /** Tests only: pretend the lease was lost after this step. */
  loseLeaseAfter?: StepName;
}

const DEFAULT_SWEEP_BUDGET_MS = 40_000;

/** Failing steps in a row before an administrator is notified (one transient failure is recorded and shown in Health, but does not interrupt anyone). */
const NOTIFY_AFTER_PROBLEMS = 2;
const problemKey = (step: StepName) => `stewardship-step-problem:${step}`;
export const STEWARDSHIP_HEALTH_HREF = "/studio/health";

function fromUnits(done: number, failed: number, completed: boolean): StepOutcome["status"] {
  if (failed === 0 && completed) return "SUCCEEDED";
  return done > 0 ? "PARTIAL" : "FAILED";
}

function stepRunners(options: StewardshipJobOptions, now: Date, deadline: Date): Record<StepName, () => Promise<StepOutcome>> {
  return {
    lifecycleInvariants: async () => {
      const r = await runLifecycleInvariantSweep({ deadline });
      return { status: fromUnits(r.examined, r.failed, r.completed), counts: { ...r }, problem: r.failed > 0 || !r.completed ? `${r.failed} page(s) could not be repaired${r.completed ? "" : "; the time budget ran out"}.` : undefined };
    },
    metadataReview: async () => {
      const r = await runMetadataReviewSweep({ now, deadline });
      return { status: fromUnits(r.examined, r.failed, r.completed), counts: { ...r, lastCursor: null }, problem: r.failed > 0 || !r.completed ? `${r.failed} page(s) could not be checked${r.completed ? "" : "; the time budget ran out"}.` : undefined };
    },
    unlistedReview: async () => {
      const r = await runUnlistedReviewSweep(now);
      const status: StepOutcome["status"] = r.failedBatches === 0 ? "SUCCEEDED" : r.failedBatches < r.batches ? "PARTIAL" : "FAILED";
      return { status, counts: { enabled: r.enabled, candidates: r.candidates, awaiting: r.awaiting, created: r.created, resurfaced: r.resurfaced, batches: r.batches, failedBatches: r.failedBatches, notification: r.notification }, problem: r.failedBatches > 0 ? `${r.failedBatches} of ${r.batches} batches failed; their videos are retried next run and the queue notification was left as it was.` : undefined };
    },
    playlistChecks: async () => {
      const r = await runPlaylistQualitySweep({ deadline });
      const failed = r.failedBatches + r.notificationFailures;
      return {
        status: fromUnits(r.checked + r.notificationsChecked, failed, r.completed),
        counts: { checked: r.checked, regressions: r.regressions, recovered: r.recovered, notificationsChecked: r.notificationsChecked, notificationFailures: r.notificationFailures, batches: r.batches, failedBatches: r.failedBatches, completed: r.completed },
        problem: failed > 0 || !r.completed ? `${r.failedBatches} batch(es) and ${r.notificationFailures} notification check(s) failed${r.completed ? "" : "; the run did not finish"}.` : undefined,
      };
    },
    emailDelivery: async () => {
      const r = await processEmailDeliveries({ now, provider: options.emailProvider });
      return { status: r.unrecorded > 0 ? "PARTIAL" : "SUCCEEDED", counts: { ...r }, problem: r.unrecorded > 0 ? `${r.unrecorded} accepted send(s) could not be recorded and will be sent again (delivery is at-least-once).` : undefined };
    },
  };
}

async function reportProblems(results: Array<{ name: StepName; outcome: StepOutcome | null; error?: { kind: string; summary: string } }>, now: Date): Promise<void> {
  const health = await loadStewardshipHealth(now);
  for (const { name, outcome } of results) {
    try {
      if (outcome?.status === "SUCCEEDED") {
        await resolveNotification(problemKey(name), "The step succeeded again.");
        continue;
      }
      const step = health.steps.find((s) => s.step === name);
      if (!step || step.consecutiveProblems < NOTIFY_AFTER_PROBLEMS) continue;
      await raiseNotification({
        kind: "STEWARDSHIP_JOB_PROBLEM",
        dedupeKey: problemKey(name),
        title: `Scheduled maintenance step “${name}” keeps failing`,
        body: `${step.consecutiveProblems} runs in a row did not complete this step. ${step.errorKind ? `Last problem: ${step.errorKind}${step.errorSummary ? ` — ${step.errorSummary}` : ""}. ` : ""}Open Health to see every step and its last result. Nothing is lost: each run retries what is left.`,
        href: STEWARDSHIP_HEALTH_HREF,
        contentFingerprint: `${name}:${step.errorKind ?? "problem"}`,
      });
    } catch (err) {
      console.error("Scheduled maintenance: the problem notification could not be updated:", describeError(err).kind);
    }
  }
}

export async function runStewardshipJob(options: StewardshipJobOptions = {}): Promise<StewardshipJobResult> {
  // One clock for the whole run: tests inject a fixed time, and every lease/record time then agrees with it.
  const tick = () => options.now ?? new Date();
  const now = tick();
  const holder = randomUUID();
  const base = { ranAt: now.toISOString() };

  if (!(await acquireStewardshipLease(holder, now))) {
    return { ran: false, skipped: "ALREADY_RUNNING", runId: null, status: null, steps: [], ok: true, ...base };
  }

  const steps: StewardshipJobResult["steps"] = [];
  const reported: Array<{ name: StepName; outcome: StepOutcome | null; error?: { kind: string; summary: string } }> = [];
  let runId: string | null = null;
  let leaseLost = false;
  try {
    await closeAbandonedRuns(now);
    runId = await startRun(options.trigger ?? "HTTP", now);
    // The budget is real elapsed time (the sweeps compare it with the real clock), whatever clock a test injects for the records.
    const deadline = new Date(Date.now() + (options.sweepBudgetMs ?? DEFAULT_SWEEP_BUDGET_MS));
    const runners = { ...stepRunners(options, now, deadline), ...options.stepOverrides };

    for (const name of STEWARDSHIP_STEPS) {
      if (leaseLost) {
        await recordSkippedStep(runId, name, tick(), "The run lost its lease, so this step was not started.");
        steps.push({ name, status: "SKIPPED", counts: null });
        continue;
      }
      await options.beforeStep?.(name);
      const stepId = await startStep(runId, name, tick());
      try {
        const outcome = await runners[name]();
        await finishStep(stepId, { status: outcome.status, now: tick(), counts: outcome.counts as Prisma.InputJsonValue, errorKind: outcome.status === "SUCCEEDED" ? null : "Incomplete", errorSummary: outcome.problem ?? null });
        steps.push({ name, status: outcome.status, counts: outcome.counts });
        reported.push({ name, outcome });
      } catch (err) {
        // The detail is scrubbed before it is stored or logged, and never returned to the caller.
        const described = describeError(err);
        console.error(`Scheduled maintenance step "${name}" failed: ${described.kind}`);
        await finishStep(stepId, { status: "FAILED", now: tick(), errorKind: described.kind, errorSummary: described.summary });
        steps.push({ name, status: "FAILED", counts: null });
        reported.push({ name, outcome: null, error: described });
      }
      // Extend the lease between steps; if it was lost (it expired and another invocation took it) no further step is started.
      if (!(await renewStewardshipLease(holder, tick())) || options.loseLeaseAfter === name) leaseLost = true;
    }

    const statuses = steps.map((s) => s.status);
    const status: StewardshipRunStatus = statuses.every((s) => s === "SUCCEEDED") ? "SUCCEEDED" : statuses.every((s) => s === "FAILED") ? "FAILED" : "PARTIAL";
    await finishRun(runId, status, tick());
    await reportProblems(reported, now);
    try {
      await pruneRuns();
    } catch {
      // Pruning is housekeeping; a failure here must not make a finished run look failed.
    }
    return { ran: true, runId, status, steps, ok: status === "SUCCEEDED", ...base };
  } catch (err) {
    // Something outside any step failed (the record could not be written, for example). The lease is released below and the next run starts clean.
    console.error("Scheduled maintenance run failed outside a step:", describeError(err).kind);
    if (runId) {
      try {
        await finishRun(runId, "FAILED", tick());
      } catch {
        // The abandoned-run cleanup of the next invocation closes it.
      }
    }
    throw err;
  } finally {
    try {
      await releaseStewardshipLease(holder, tick());
    } catch {
      // The lease expires by itself.
    }
  }
}
