import Link from "next/link";
import { listAuditLogEntriesForEntity } from "../../modules/audit/listAuditLog";
import { formatAuditActionSummary, formatAuditTimestamp } from "../../modules/audit/auditDisplay";
import { can } from "../../modules/auth/policy";
import type { StudioRoleName } from "../../modules/auth/types";

// Phase 6G-15 — a reusable "Activity" section for entity detail pages,
// wired into a deliberately small subset of entities (Composer,
// Organisation, Occasion) rather than all candidates the brief lists, to
// avoid broad refactoring across every entity page in one phase.
//
// Gates on AUDIT_VIEW itself (rather than trusting each call site to
// check first) since entity detail pages are otherwise visible to
// CONTRIBUTOR/EDITOR/REVIEWER roles that must never see audit data.

export default async function EntityActivity({
  entityType,
  entityId,
  role,
}: {
  entityType: string;
  entityId: string;
  role: StudioRoleName;
}) {
  if (!can(role, "AUDIT_VIEW")) {
    return null;
  }

  const entries = await listAuditLogEntriesForEntity(entityType, entityId, 10);

  if (entries.length === 0) {
    return null;
  }

  return (
    <section style={{ marginTop: "1.5rem" }}>
      <h2 style={{ fontSize: "1.1rem" }}>Activity</h2>
      <ul style={{ listStyle: "none", padding: 0 }}>
        {entries.map((entry) => (
          <li key={entry.id} style={{ borderBottom: "1px solid #eee", padding: "0.4rem 0" }}>
            <Link href={`/studio/audit/${entry.id}`}>{formatAuditActionSummary(entry.action)}</Link>
            {" — "}
            {entry.actor ? entry.actor.name : "System"}, {formatAuditTimestamp(entry.timestamp)}
          </li>
        ))}
      </ul>
    </section>
  );
}
