import Link from "next/link";
import { listRecordingsForStudio } from "../../../../../modules/db/repositories/recordingRepository";
import { countSheetMusicRequestsByStatus } from "../../../../../modules/db/repositories/sheetMusicRequestRepository";
import { listRecentAuditLogEntries } from "../../../../../modules/audit/listAuditLog";

// Every number here comes from a real query — brief §4: "Do not invent
// metrics... Do not show fake analytics numbers." YouTube sync and GA4
// are Phase 3 provider adapters with no live configuration anywhere in
// this codebase, so this dashboard says so plainly instead of omitting
// them or inventing placeholder numbers.
export default async function StudioDashboardPage() {
  const [recordings, newSheetMusicRequests, recentAuditEntries] = await Promise.all([
    listRecordingsForStudio(),
    countSheetMusicRequestsByStatus("NEW"),
    listRecentAuditLogEntries(10),
  ]);

  const needingAttention = recordings.filter((r) => r.status === "DRAFT" || r.status === "IN_REVIEW");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "2rem" }}>
      <h1>Dashboard</h1>

      <section>
        <h2>Recordings needing attention ({needingAttention.length})</h2>
        {needingAttention.length === 0 ? (
          <p>Nothing in draft or review right now.</p>
        ) : (
          <ul>
            {needingAttention.slice(0, 10).map((recording) => (
              <li key={recording.id}>
                <Link href={`/studio/recordings/${recording.id}/source`}>
                  {recording.currentDraftRevision?.title ?? recording.slug}
                </Link>{" "}
                — {recording.status}
              </li>
            ))}
          </ul>
        )}
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
        {recentAuditEntries.length === 0 ? (
          <p>No audit log entries yet.</p>
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
        <p>
          <Link href="/studio/audit">View full audit log →</Link>
        </p>
      </section>

      <section>
        <h2>YouTube sync &amp; analytics</h2>
        <p>Not yet configured — no YouTube or GA4 credentials exist in this environment (Phase 3).</p>
      </section>
    </div>
  );
}
