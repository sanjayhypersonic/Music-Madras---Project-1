import Link from "next/link";
import { KIND_LABEL, STATUS_LABEL, type ConnectedItem, type ConnectionVia, type VisibilityStatus } from "../../modules/mmke/occasionWorkspace/occasionConnections";
import type { OccasionWorkspace } from "../../modules/db/repositories/occasionWorkspaceRepository";
import { StatusBadge, type StatusTone } from "./StatusBadge";

// The Occasion workspace's read-only "public page and connected items" view. It renders a workspace that was loaded elsewhere and contains no form, no
// action and no link that writes: connections are changed where they are made (each row names that route). Every status carries its word; colour is never
// the only cue.

const TONE: Record<VisibilityStatus, StatusTone> = { VISIBLE: "success", DRAFT: "warning", EXCLUDED: "warning", ARCHIVED: "neutral", OCCASION_ARCHIVED: "neutral", UNKNOWN: "info" };

const VIA_LABEL: Record<ConnectionVia, string> = {
  DIRECT: "Attached directly",
  VIA_PROGRAMME: "Through an attached programme",
  VIA_PERFORMANCE: "Through a listed performance",
  PUBLISHED_REVISION: "Published revision",
  DRAFT_REVISION_ONLY: "Draft revision only",
  OLDER_REVISION_ONLY: "Older revision only",
};

function Row({ item }: { item: ConnectedItem }) {
  return (
    <tr>
      <th scope="row">{KIND_LABEL[item.kind]}</th>
      <td>
        {item.studioHref ? <Link href={item.studioHref}>{item.label}</Link> : item.label}
        {item.detail && <span className="studio-muted"> — {item.detail}</span>}
        {item.publicHref && (
          <>
            {" "}
            <Link href={item.publicHref} className="studio-muted">
              (public page)
            </Link>
          </>
        )}
      </td>
      <td>{VIA_LABEL[item.via]}</td>
      <td>
        <StatusBadge status={item.status} tone={TONE[item.status]}>
          {STATUS_LABEL[item.status]}
        </StatusBadge>
      </td>
      <td>
        {item.reason}
        {item.manageHref && (
          <>
            {" "}
            <Link href={item.manageHref}>Change this connection →</Link>
          </>
        )}
      </td>
    </tr>
  );
}

export function OccasionConnections({ workspace }: { workspace: OccasionWorkspace }) {
  const { publicPage, connections, counts } = workspace;
  return (
    <>
      <section className="studio-panel" aria-labelledby="occasion-public-page">
        <h2 id="occasion-public-page">Public page</h2>
        <p>
          <StatusBadge status={publicPage.state === "PUBLIC" ? "PUBLISHED" : "DRAFT"} tone={publicPage.state === "PUBLIC" ? "success" : "warning"}>
            {publicPage.state === "PUBLIC" ? "Has a public page" : "No public page"}
          </StatusBadge>{" "}
          {publicPage.reason}{" "}
          {publicPage.href && (
            <Link href={publicPage.href}>
              Open the public page →
            </Link>
          )}
        </p>
        <p className="studio-muted">
          {counts.linked} connected item{counts.linked === 1 ? "" : "s"}, {counts.visible} publicly visible. An occasion is public only while it is not archived and at least one attached item is public; the rules for each item are
          the same ones the public page applies.
        </p>
      </section>

      <section aria-labelledby="occasion-connections">
        <h2 id="occasion-connections">Connected archive items</h2>
        {workspace.truncated && <p className="studio-muted">This occasion has more connections than are shown here; the first {connections.length} are listed.</p>}
        {connections.length === 0 ? (
          <p className="studio-empty">Nothing is attached to this occasion yet.</p>
        ) : (
          <div className="studio-table-scroll">
            <table className="studio-compare__table">
              <thead>
                <tr>
                  <th scope="col">Type</th>
                  <th scope="col">Item</th>
                  <th scope="col">Connection</th>
                  <th scope="col">On the public page?</th>
                  <th scope="col">Why</th>
                </tr>
              </thead>
              <tbody>
                {connections.map((item) => (
                  <Row key={`${item.kind}-${item.via}-${item.id}`} item={item} />
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="studio-muted">
          This view is read-only. A connection is changed where it is made: on the performance, programme or collection itself, or — for a recording — on its Relationships step, because a recording&apos;s occasions belong to its
          draft revision and become public only when that draft is published.
        </p>
      </section>
    </>
  );
}
