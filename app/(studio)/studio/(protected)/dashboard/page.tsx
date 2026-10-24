import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../modules/auth/authService";
import { can } from "../../../../../modules/auth/policy";
import { listRecordingsForStudio } from "../../../../../modules/db/repositories/recordingRepository";
import { countSheetMusicRequestsByStatus } from "../../../../../modules/db/repositories/sheetMusicRequestRepository";
import { listRecentAuditLogEntries } from "../../../../../modules/audit/listAuditLog";
import { PENDING_LABEL, listPendingWork } from "../../../../../modules/publishing/pendingWork";

// Every number here comes from a real query — brief §4: "Do not invent
// metrics... Do not show fake analytics numbers."
//
// Phase 6J-1: the recent-activity excerpt is audit data, so it follows the same
// AUDIT_VIEW permission as the full Audit Log page — it is not queried at all
// for a role without it — and the page checks the session itself rather than
// relying only on the layout (layouts do not re-run on client navigation).
export default async function StudioDashboardPage() {
  const session = await getCurrentStudioSession();
  if (!session) redirect("/studio/signin");
  const canViewAudit = can(session.user.role, "AUDIT_VIEW");

  const [recordings, newSheetMusicRequests, recentAuditEntries] = await Promise.all([
    listRecordingsForStudio(),
    countSheetMusicRequestsByStatus("NEW"),
    canViewAudit ? listRecentAuditLogEntries(10) : Promise.resolve([]),
  ]);

  // A live (PUBLISHED) Recording with an open draft is a pending update and
  // still needs attention — since Phase 6I-2 it stays PUBLISHED while edited.
  // Recordings waiting for an editorial decision come first; their link goes to Review & Publish for anyone who can act on them.
  const needingAttention = listPendingWork(recordings);
  const canReview = can(session.user.role, "EDITORIAL_REVIEW");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "2rem" }}>
      <h1>Dashboard</h1>

      <section>
        <h2>Recordings needing attention ({needingAttention.length})</h2>
        {needingAttention.length === 0 ? (
          <p className="studio-empty">Nothing in draft or review right now.</p>
        ) : (
          <ul>
            {needingAttention.slice(0, 10).map(({ item: recording, kind }) => (
              <li key={recording.id}>
                <Link href={`/studio/recordings/${recording.id}/${kind === "AWAITING_REVIEW" && canReview ? "review" : "source"}`}>
                  {recording.currentDraftRevision?.title ?? recording.slug}
                </Link>{" "}
                — {PENDING_LABEL[kind]}
              </li>
            ))}
          </ul>
        )}
        {needingAttention.length > 10 && <p className="studio-muted">Showing the first 10 of {needingAttention.length}.</p>}
        <p>
          <Link href="/studio/recordings">View all recordings →</Link>
        </p>
      </section>

      <section>
        <h2>Sheet music requests</h2>
        <p>{newSheetMusicRequests} new request(s) awaiting review.</p>
        <p>
          <Link href="/studio/sheet-music">Review requests →</Link>
        </p>
      </section>

      <section>
        <h2>Recent activity</h2>
        {!canViewAudit ? (
          <p>Recent activity is visible to Administrators and above.</p>
        ) : recentAuditEntries.length === 0 ? (
          <p className="studio-empty">No audit log entries yet.</p>
        ) : (
          <ul>
            {recentAuditEntries.map((entry) => (
              <li key={entry.id}>
                {entry.timestamp.toISOString()} — {entry.actor?.name ?? "system"} — {entry.action} (
                {entry.entityType})
              </li>
            ))}
          </ul>
        )}
        {canViewAudit && (
          <p>
            <Link href="/studio/audit">View full audit log →</Link>
          </p>
        )}
      </section>

      <section>
        <h2>YouTube</h2>
        <p>
          Browse the synchronised channel and start a Recording from any video in the{" "}
          <Link href="/studio/catalogue/videos">YouTube Video Catalogue</Link>.
        </p>
      </section>
    </div>
  );
}
