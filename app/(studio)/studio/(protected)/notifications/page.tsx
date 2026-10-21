import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../modules/auth/authService";
import { can } from "../../../../../modules/auth/policy";
import { emailDeliveryCounts, emailDeliveryHealth, listNotificationsForUser } from "../../../../../modules/db/repositories/studioNotificationRepository";
import { loadResolvedSettings } from "../../../../../modules/db/repositories/siteSettingRepository";
import { describeEmailDelivery } from "../../../../../modules/notifications/deliveryConfiguration";
import { markAllReadAction, markReadAction } from "./actions";

// Phase 6K-1 — the Studio notification inbox. This is the reliable channel: everything that needs a person's attention appears here
// whether or not email works. Administrators also see, honestly, whether email delivery is configured and what happened to the
// emails that were attempted. A notification lists only what the viewer's role may see.

const SEVERITY: Record<string, string> = { ACTION_REQUIRED: "Action needed", WARNING: "Warning", INFO: "Information" };

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  const session = await getCurrentStudioSession();
  if (!session || session.user.status !== "ACTIVE") redirect("/studio/signin");
  const { all } = await searchParams;
  const user = session.user;
  const notifications = await listNotificationsForUser({ userId: user.id, role: user.role, includeResolved: all === "1" });
  const isOperator = can(user.role, "SETTINGS_MANAGE");
  const delivery = isOperator ? { status: describeEmailDelivery(), enabled: (await loadResolvedSettings()).get("notifications.email.enabled"), counts: await emailDeliveryCounts(), health: await emailDeliveryHealth() } : null;

  return (
    <div>
      <h1>Notifications</h1>
      <p>Things that need your attention. They are always shown here; email is an optional extra.</p>

      {delivery && (
        <section style={{ border: "1px solid var(--mm-border)", padding: "0.75rem 1rem", margin: "1rem 0" }}>
          <h2 style={{ marginTop: 0 }}>Email delivery</h2>
          <p>
            <strong>Email notifications:</strong> {delivery.enabled ? "switched on" : "switched off"} (<Link href="/studio/settings/site">change in settings</Link>)
            <br />
            <strong>Deployment:</strong>{" "}
            {delivery.status.state === "CONFIGURED" ? "email delivery is configured" : delivery.status.state === "CONSOLE_ONLY" ? "development mode — nothing is delivered" : "email delivery is NOT configured"}
          </p>
          <p>{delivery.status.detail}</p>
          {delivery.enabled && delivery.status.state !== "CONFIGURED" && (
            <p role="alert" className="studio-alert studio-alert--error">
              Email notifications are switched on but cannot be delivered. They are skipped and recorded as such; the inbox below is unaffected.
            </p>
          )}
          <p>
            Emails so far — accepted by the mail service: {delivery.counts.delivered}, waiting to be sent: {delivery.counts.pending}, failed after retries: {delivery.counts.failed}, skipped: {delivery.counts.skipped}.
          </p>
          <p style={{ fontSize: "0.9rem" }}>
            “Accepted” means the mail service took the message for delivery; it does not show that it reached an inbox. A notification waiting to be sent is only queued — it has not been sent.
            {delivery.health.lastAttemptAt ? ` The delivery job last tried to send on ${delivery.health.lastAttemptAt.toLocaleString()}.` : " The delivery job has not tried to send anything yet."}
          </p>
          {delivery.health.stalled && delivery.health.oldestPendingAt && (
            <p role="alert" className="studio-alert studio-alert--error">
              {delivery.health.pending} email{delivery.health.pending === 1 ? " has" : "s have"} been waiting since {delivery.health.oldestPendingAt.toLocaleString()} and nothing has picked {delivery.health.pending === 1 ? "it" : "them"} up. The scheduled delivery job is probably not running: it needs
              CRON_SECRET set on the deployment and a scheduler calling /api/cron/stewardship (see docs/runbooks/scheduled-maintenance.md). Until then these notifications are only in this inbox.
            </p>
          )}
        </section>
      )}

      <div style={{ display: "flex", gap: "1rem", alignItems: "center", margin: "1rem 0" }}>
        <form action={markAllReadAction}>
          <button type="submit">Mark all as read</button>
        </form>
        {all === "1" ? <Link href="/studio/notifications">Hide resolved</Link> : <Link href="/studio/notifications?all=1">Show resolved</Link>}
      </div>

      {notifications.length === 0 ? (
        <p className="studio-empty">Nothing needs your attention.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0 }}>
          {notifications.map((n) => (
            <li key={n.id} style={{ borderTop: "1px solid var(--mm-border)", padding: "0.75rem 0", opacity: n.status === "RESOLVED" ? 0.7 : 1 }}>
              <p style={{ margin: 0 }}>
                <strong>{n.title}</strong> {!n.read && n.status === "OPEN" ? <em>(new)</em> : null}
                {n.status === "RESOLVED" ? <em> (resolved{n.resolvedReason ? `: ${n.resolvedReason}` : ""})</em> : null}
              </p>
              <p style={{ margin: "0.25rem 0" }}>
                {SEVERITY[n.severity] ?? n.severity} · last raised {n.lastRaisedAt.toLocaleString()}
                {n.occurrenceCount > 1 ? ` · raised ${n.occurrenceCount} times` : ""}
              </p>
              <p style={{ margin: "0.25rem 0", whiteSpace: "pre-wrap" }}>{n.body}</p>
              <div style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
                {n.href && <Link href={n.href}>Open</Link>}
                {!n.read && n.status === "OPEN" && (
                  <form action={markReadAction}>
                    <input type="hidden" name="id" value={n.id} />
                    <button type="submit">Mark as read</button>
                  </form>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
