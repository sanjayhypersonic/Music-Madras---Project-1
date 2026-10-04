import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../modules/auth/authService";
import { can } from "../../../../../modules/auth/policy";
import {
  listAuditLogEntriesPage,
  listDistinctAuditActions,
  listDistinctAuditEntityTypes,
} from "../../../../../modules/audit/listAuditLog";
import { listStudioUsers } from "../../../../../modules/db/repositories/studioUserAdminRepository";
import { deriveAuditEntityLabel, formatAuditActionSummary, formatAuditTimestamp } from "../../../../../modules/audit/auditDisplay";

// Phase 6G-15 — the Studio Audit Log / Activity Centre. This is the same
// route that already existed (a bare recent-100 table); it now reads its
// filters from the URL query string and paginates server-side via
// listAuditLogEntriesPage, but is otherwise the same AUDIT_VIEW-gated
// page. No raw JSON here by design — that lives on the per-entry detail
// page at /studio/audit/[id].

interface AuditSearchParams {
  q?: string;
  entityType?: string;
  action?: string;
  actorId?: string;
  from?: string;
  to?: string;
  page?: string;
}

function buildAuditHref(params: AuditSearchParams): string {
  const searchParams = new URLSearchParams();
  if (params.q) searchParams.set("q", params.q);
  if (params.entityType) searchParams.set("entityType", params.entityType);
  if (params.action) searchParams.set("action", params.action);
  if (params.actorId) searchParams.set("actorId", params.actorId);
  if (params.from) searchParams.set("from", params.from);
  if (params.to) searchParams.set("to", params.to);
  if (params.page && params.page !== "1") searchParams.set("page", params.page);
  const qs = searchParams.toString();
  return qs ? `/studio/audit?${qs}` : "/studio/audit";
}

function parseDateStartOfDay(value?: string): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function parseDateEndOfDay(value?: string): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(`${value}T23:59:59.999Z`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<AuditSearchParams> }) {
  const session = await getCurrentStudioSession();
  if (!session) redirect("/studio/signin");
  if (!can(session.user.role, "AUDIT_VIEW")) {
    return <p>You do not have permission to view the audit log.</p>;
  }

  const params = await searchParams;
  const page = Number.parseInt(params.page ?? "1", 10) || 1;

  const filters = {
    q: params.q?.trim() || undefined,
    entityType: params.entityType || undefined,
    action: params.action || undefined,
    actorId: params.actorId || undefined,
    from: parseDateStartOfDay(params.from),
    to: parseDateEndOfDay(params.to),
  };

  const [{ items, total, pageSize }, entityTypes, actions, users] = await Promise.all([
    listAuditLogEntriesPage(filters, page),
    listDistinctAuditEntityTypes(),
    listDistinctAuditActions(),
    listStudioUsers(),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div>
      <h1>Audit Log</h1>
      <p>A chronological record of changes made across Studio. Select an entry to see its full detail.</p>

      <form method="get" style={{ margin: "1rem 0", display: "flex", flexWrap: "wrap", gap: "1rem", alignItems: "flex-end" }}>
        <label>
          Search
          <input type="search" name="q" defaultValue={params.q ?? ""} placeholder="Actor name, email, or entity ID" style={{ display: "block" }} />
        </label>
        <label>
          Entity type
          <select name="entityType" defaultValue={params.entityType ?? ""} style={{ display: "block" }}>
            <option value="">All</option>
            {entityTypes.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </label>
        <label>
          Action
          <select name="action" defaultValue={params.action ?? ""} style={{ display: "block" }}>
            <option value="">All</option>
            {actions.map((action) => (
              <option key={action} value={action}>
                {formatAuditActionSummary(action)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Actor
          <select name="actorId" defaultValue={params.actorId ?? ""} style={{ display: "block" }}>
            <option value="">All</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          From
          <input type="date" name="from" defaultValue={params.from ?? ""} style={{ display: "block" }} />
        </label>
        <label>
          To
          <input type="date" name="to" defaultValue={params.to ?? ""} style={{ display: "block" }} />
        </label>
        <button type="submit">Filter</button>
        <Link href="/studio/audit">Clear</Link>
      </form>

      {items.length === 0 ? (
        <p className="studio-empty">No audit log entries match these filters.</p>
      ) : (
        <>
          <div className="studio-table-scroll">
<table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>Date/time</th>
                <th style={{ textAlign: "left" }}>Actor</th>
                <th style={{ textAlign: "left" }}>Action</th>
                <th style={{ textAlign: "left" }}>Entity type</th>
                <th style={{ textAlign: "left" }}>Entity</th>
              </tr>
            </thead>
            <tbody>
              {items.map((entry) => (
                <tr key={entry.id}>
                  <td style={{ padding: "0.25rem 0" }}>{formatAuditTimestamp(entry.timestamp)}</td>
                  <td>{entry.actor ? entry.actor.name : "System"}</td>
                  <td>{formatAuditActionSummary(entry.action)}</td>
                  <td>{entry.entityType}</td>
                  <td>
                    <Link href={`/studio/audit/${entry.id}`}>{deriveAuditEntityLabel(entry)}</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
</div>

          <nav style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "1rem" }}>
            {page > 1 ? <Link href={buildAuditHref({ ...params, page: String(page - 1) })}>&larr; Previous</Link> : <span />}
            <span>
              Page {page} of {totalPages} ({total} entries)
            </span>
            {page < totalPages ? <Link href={buildAuditHref({ ...params, page: String(page + 1) })}>Next &rarr;</Link> : <span />}
          </nav>
        </>
      )}
    </div>
  );
}
