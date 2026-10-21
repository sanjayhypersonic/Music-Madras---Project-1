import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../modules/auth/authService";
import { can } from "../../../../../modules/auth/policy";
import { findLifecycleViolations } from "../../../../../modules/db/repositories/videoLifecycleRepository";
import { emailDeliveryHealth } from "../../../../../modules/db/repositories/studioNotificationRepository";
import { STEWARDSHIP_STALE_AFTER_MS, loadStewardshipHealth } from "../../../../../modules/db/repositories/stewardshipRunRepository";

// Phase 6K lifecycle hardening (F10) — Studio's view of the scheduled maintenance job. It says plainly whether the job has been running, what each step
// did last time, and what went wrong, from the durable run records (stewardship_runs / stewardship_step_runs). Nothing here starts a run or configures
// a scheduler: it reports what the deployment's own scheduler (if any) has done. Operators only (SETTINGS_MANAGE), like email delivery status.

const STATUS_WORD: Record<string, string> = { SUCCEEDED: "succeeded", PARTIAL: "partly completed", FAILED: "failed", SKIPPED: "not run", RUNNING: "running", ABANDONED: "abandoned" };

const STEP_LABEL: Record<string, string> = {
  lifecycleInvariants: "Approval lifecycle check",
  metadataReview: "Metadata review check",
  unlistedReview: "Unlisted-video review",
  playlistChecks: "Playlist page checks",
  emailDelivery: "Notification email delivery",
};

const hours = Math.round(STEWARDSHIP_STALE_AFTER_MS / 3_600_000);

/** The numeric counts a step recorded, as one line (counts only: the record never holds titles, addresses or other content). */
function countsLine(counts: unknown): string | null {
  if (typeof counts !== "object" || counts === null) return null;
  const parts = Object.entries(counts as Record<string, unknown>)
    .filter(([, v]) => typeof v === "number" || typeof v === "boolean")
    .map(([k, v]) => `${k}: ${String(v)}`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

export default async function HealthPage() {
  const session = await getCurrentStudioSession();
  if (!session || session.user.status !== "ACTIVE") redirect("/studio/signin");
  if (!can(session.user.role, "SETTINGS_MANAGE")) redirect("/studio/dashboard");

  const [health, email, violations] = await Promise.all([loadStewardshipHealth(), emailDeliveryHealth(), findLifecycleViolations(50)]);
  const failingSteps = health.steps.filter((s) => s.status === "FAILED" || s.status === "PARTIAL");

  return (
    <div>
      <h1>Health</h1>
      <p>
        What the scheduled maintenance job has been doing. It keeps the unlisted-video review, metadata checks, playlist checks and notification emails current. It is called by whatever scheduler this deployment uses
        (see docs/runbooks/scheduled-maintenance.md); this page only reports what that scheduler has actually run.
      </p>

      {health.lastRunAt === null ? (
        <p role="alert" className="studio-alert studio-alert--error">
          The job has never run. Until a scheduler calls it, queued notification emails are not sent and the checks above only refresh when someone opens a Studio page.
        </p>
      ) : health.stale ? (
        <p role="alert" className="studio-alert studio-alert--error">
          The job last started on {health.lastRunAt.toLocaleString()}, more than {hours} hours ago. The schedule has probably stopped.
        </p>
      ) : (
        <p>
          Last run started {health.lastRunAt.toLocaleString()} — {STATUS_WORD[health.lastRunStatus ?? "RUNNING"]}.{" "}
          {health.lastFullSuccessAt ? `Last run in which every step succeeded: ${health.lastFullSuccessAt.toLocaleString()}.` : "No run has had every step succeed yet."}
          {health.running ? " A run is in progress now." : ""}
        </p>
      )}

      {failingSteps.length > 0 && (
        <p role="alert" className="studio-alert studio-alert--error">
          {failingSteps.length} step{failingSteps.length === 1 ? "" : "s"} did not fully succeed last time: {failingSteps.map((s) => STEP_LABEL[s.step] ?? s.step).join(", ")}. Nothing is lost: each run retries what is left.
        </p>
      )}

      <h2>Steps</h2>
      {health.steps.length === 0 ? (
        <p className="studio-empty">No step has run yet.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0 }}>
          {health.steps.map((s) => (
            <li key={s.step} style={{ borderTop: "1px solid var(--mm-border)", padding: "0.5rem 0" }}>
              <p style={{ margin: 0 }}>
                <strong>{STEP_LABEL[s.step] ?? s.step}</strong> — {STATUS_WORD[s.status]} at {s.startedAt.toLocaleString()}
                {s.consecutiveProblems > 1 ? ` · ${s.consecutiveProblems} runs in a row without success` : ""}
                {s.lastSucceededAt ? ` · last succeeded ${s.lastSucceededAt.toLocaleString()}` : ""}
              </p>
              {s.errorKind && (
                <p style={{ margin: "0.25rem 0" }}>
                  {s.errorKind}
                  {s.errorSummary ? `: ${s.errorSummary}` : ""}
                </p>
              )}
              {countsLine(s.counts) && <p style={{ margin: "0.25rem 0", fontSize: "0.9rem", color: "var(--mm-text-muted)" }}>{countsLine(s.counts)}</p>}
            </li>
          ))}
        </ul>
      )}

      <h2>Notification email</h2>
      <p>
        {email.pending} waiting to be sent · {email.inFlight} being sent now
        {email.lastAttemptAt ? ` · last attempt ${email.lastAttemptAt.toLocaleString()}` : " · nothing has been attempted yet"}. See <Link href="/studio/notifications">Notifications</Link> for delivery status. Delivery is at-least-once: a message can, rarely, be sent twice if the database fails at the wrong moment.
      </p>

      <h2>Approval lifecycle</h2>
      {violations.length === 0 ? (
        <p>No approval is standing on an archived page or a private video.</p>
      ) : (
        <p role="alert" className="studio-alert studio-alert--error">
          {violations.length} page{violations.length === 1 ? " holds" : "s hold"} an approval although {violations.length === 1 ? "it is" : "they are"} archived or the video is private. The next maintenance run revokes {violations.length === 1 ? "it" : "them"}; nothing is exposed meanwhile.
        </p>
      )}

      <h2>Recent runs</h2>
      {health.recentRuns.length === 0 ? (
        <p className="studio-empty">No runs recorded.</p>
      ) : (
        <ul>
          {health.recentRuns.map((r) => (
            <li key={r.id}>
              {r.startedAt.toLocaleString()} — {STATUS_WORD[r.status]}
              {r.problems > 0 ? ` (${r.problems} step${r.problems === 1 ? "" : "s"} with a problem)` : ""} · started by {r.trigger}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
