import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../modules/auth/authService";
import { can } from "../../../../../modules/auth/policy";
import { listRecentAuditLogEntries } from "../../../../../modules/audit/listAuditLog";

export default async function AuditPage() {
  const session = await getCurrentStudioSession();
  if (!session) redirect("/studio/signin");
  if (!can(session.user.role, "AUDIT_VIEW")) {
    return <p>You do not have permission to view the audit log.</p>;
  }

  const entries = await listRecentAuditLogEntries(100);

  return (
    <div>
      <h1>Audit Log</h1>
      {entries.length === 0 ? (
        <p>No audit log entries yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th style={{ textAlign: "left" }}>Timestamp</th>
              <th style={{ textAlign: "left" }}>Actor</th>
              <th style={{ textAlign: "left" }}>Action</th>
              <th style={{ textAlign: "left" }}>Entity</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id}>
                <td>{entry.timestamp.toISOString()}</td>
                <td>{entry.actor ? `${entry.actor.name} (${entry.actor.email})` : "system"}</td>
                <td>{entry.action}</td>
                <td>
                  {entry.entityType}:{entry.entityId}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
