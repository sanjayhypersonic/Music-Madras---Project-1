import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../modules/auth/authService";
import { can } from "../../../../../../modules/auth/policy";
import { findAuditLogEntryById } from "../../../../../../modules/audit/listAuditLog";
import { deriveAuditEntityLabel, formatAuditActionSummary, formatAuditTimestamp } from "../../../../../../modules/audit/auditDisplay";

// Phase 6G-15 — the audit event detail view (brief step 4). Shows only
// what is actually stored on the AuditLogEntry row: no reconstructed
// diff, no invented request/job-ID field (the schema has none).

function SnapshotBlock({ label, value }: { label: string; value: unknown }) {
  if (value === null || value === undefined) return null;
  return (
    <div style={{ marginTop: "1rem" }}>
      <h2 style={{ fontSize: "1rem" }}>{label}</h2>
      <pre style={{ background: "#f5f5f5", padding: "0.75rem", overflowX: "auto", fontSize: "0.85rem" }}>
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

export default async function AuditEntryDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getCurrentStudioSession();
  if (!session) redirect("/studio/signin");
  if (!can(session.user.role, "AUDIT_VIEW")) {
    return <p>You do not have permission to view the audit log.</p>;
  }

  const { id } = await params;
  const entry = await findAuditLogEntryById(id);
  if (!entry) {
    notFound();
  }

  return (
    <div>
      <p>
        <Link href="/studio/audit">&larr; Audit Log</Link>
      </p>
      <h1>{formatAuditActionSummary(entry.action)}</h1>

      <dl>
        <dt>Date/time</dt>
        <dd>{formatAuditTimestamp(entry.timestamp)}</dd>

        <dt>Actor</dt>
        <dd>{entry.actor ? `${entry.actor.name} (${entry.actor.email})` : "System"}</dd>

        <dt>Action</dt>
        <dd>{entry.action}</dd>

        <dt>Entity</dt>
        <dd>
          {entry.entityType}: {deriveAuditEntityLabel(entry)} ({entry.entityId})
        </dd>
      </dl>

      <SnapshotBlock label="Previous value" value={entry.beforeSnapshot} />
      <SnapshotBlock label="New value" value={entry.afterSnapshot} />
    </div>
  );
}
