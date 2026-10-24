import Link from "next/link";
import {
  BUCKET_LABEL,
  FINDING_KIND_LABEL,
  type FindingKind,
  type VisibilityBucket,
  type VisibilityView,
} from "../../modules/mmke/recordingVisibility/recordingVisibility";
import type { RecordingVisibilityWorkspace } from "../../modules/db/repositories/recordingVisibilityRepository";
import { StatusBadge, type StatusTone } from "./StatusBadge";

// The Recording public-visibility workspace's read-only view. It renders a workspace loaded elsewhere and contains no form, no action and no link that
// writes: every link opens an existing Studio record. A status always carries its word; colour is never the only cue.

const BASE = "/studio/recordings/visibility";

const BUCKET_TONE: Record<VisibilityBucket, StatusTone> = { PUBLIC: "success", PUBLISHED_NOT_DISCOVERABLE: "warning", NOT_PUBLISHED_YET: "neutral", NOT_DETERMINED: "info" };
const KIND_TONE: Record<FindingKind, StatusTone> = { BLOCKER: "error", DISCOVERY_GAP: "info", RESTRICTION: "warning", NOT_DETERMINED: "neutral" };

const VIEW_TEXT: Record<VisibilityView, { title: string; blurb: string }> = {
  public: { title: "Publicly discoverable", blurb: "Has a public page, a sitemap entry and an archive-search result." },
  "not-discoverable": { title: "Published, but not public", blurb: "A published revision is on record (or the status says published), yet visitors cannot see it: archived, unpublished, or marked published without a revision." },
  gaps: { title: "Public, with discovery gaps", blurb: "Public, but something that helps visitors find it is missing: a work, a performance and venue, or a publicly shown video. A subset of Publicly discoverable." },
  restricted: { title: "Public, affected by a restriction", blurb: "Public, but an explicit hold or visibility rule withholds a linked video. A subset of Publicly discoverable." },
  undetermined: { title: "Not determined", blurb: "The recorded facts do not establish whether visitors can see it. Reported rather than guessed." },
  unpublished: { title: "Not published yet", blurb: "Still being prepared; never published." },
};

function viewHref(view: VisibilityView, page = 1): string {
  return `${BASE}?view=${view}${page > 1 ? `&page=${page}` : ""}`;
}

function Tile({ view, count, current }: { view: VisibilityView; count: number; current: VisibilityView }) {
  return (
    <li>
      <Link href={viewHref(view)} aria-current={view === current ? "page" : undefined}>
        <strong>{count}</strong> {VIEW_TEXT[view].title}
      </Link>
      <span className="studio-muted"> — {VIEW_TEXT[view].blurb}</span>
    </li>
  );
}

export function RecordingVisibility({ workspace }: { workspace: RecordingVisibilityWorkspace }) {
  const { counts, view, rows, page, pageSize, viewTotal } = workspace;
  const pageCount = Math.max(1, Math.ceil(viewTotal / pageSize));
  return (
    <>
      <section className="studio-panel" aria-labelledby="visibility-summary">
        <h2 id="visibility-summary">Where every recording stands</h2>
        <p className="studio-muted">
          Each recording is in exactly one of these four groups, so they add up to {counts.counted}.
        </p>
        <ul className="studio-compare__items">
          <Tile view="public" count={counts.public} current={view} />
          <Tile view="not-discoverable" count={counts.notDiscoverable} current={view} />
          <Tile view="unpublished" count={counts.unpublished} current={view} />
          <Tile view="undetermined" count={counts.undetermined} current={view} />
        </ul>
        <h3>Within the publicly discoverable recordings</h3>
        <p className="studio-muted">These two overlap with each other and are already counted in Publicly discoverable; they are not additional recordings.</p>
        <ul className="studio-compare__items">
          <Tile view="gaps" count={counts.withGaps} current={view} />
          <Tile view="restricted" count={counts.withRestrictions} current={view} />
        </ul>
        {workspace.truncated && (
          <p className="studio-muted" role="status">
            There are {workspace.totalRecordings} recordings; the counts and lists cover the {counts.counted} most recently updated.
          </p>
        )}
      </section>

      <section aria-labelledby="visibility-list">
        <h2 id="visibility-list">{VIEW_TEXT[view].title}</h2>
        <p className="studio-muted">{VIEW_TEXT[view].blurb}</p>
        {rows.length === 0 ? (
          <p className="studio-empty">No recordings in this group.</p>
        ) : (
          <div className="studio-table-scroll">
            <table className="studio-compare__table">
              <thead>
                <tr>
                  <th scope="col">Recording</th>
                  <th scope="col">Publication state</th>
                  <th scope="col">Public visibility</th>
                  <th scope="col">Findings</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <th scope="row">
                      <Link href={`/studio/recordings/${row.id}/source`}>{row.visibility.title ?? "Untitled recording"}</Link>
                      <span className="studio-muted"> ({row.slug})</span>
                      {row.visibility.publicPath && (
                        <>
                          {" "}
                          <Link href={row.visibility.publicPath} className="studio-muted">
                            (public page)
                          </Link>
                        </>
                      )}
                    </th>
                    <td>
                      <StatusBadge status={row.status} />
                    </td>
                    <td>
                      <StatusBadge status={row.visibility.bucket} tone={BUCKET_TONE[row.visibility.bucket]}>
                        {BUCKET_LABEL[row.visibility.bucket]}
                      </StatusBadge>
                    </td>
                    <td>
                      {row.visibility.findings.length === 0 ? (
                        <span className="studio-muted">Nothing to report: public, with a work, a performance and venue, and a publicly shown video.</span>
                      ) : (
                        <ul className="studio-compare__items">
                          {row.visibility.findings.map((f, i) => (
                            <li key={`${f.code}-${i}`}>
                              <StatusBadge status={f.kind} tone={KIND_TONE[f.kind]}>
                                {FINDING_KIND_LABEL[f.kind]}
                              </StatusBadge>{" "}
                              {f.message}
                              {f.fix && (
                                <>
                                  {" "}
                                  <Link href={f.fix.href}>{f.fix.label} →</Link>
                                </>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {pageCount > 1 && (
          <nav aria-label="Pages" className="studio-muted">
            Page {page} of {pageCount}.{" "}
            {page > 1 && <Link href={viewHref(view, page - 1)}>← Previous</Link>} {page < pageCount && <Link href={viewHref(view, page + 1)}>Next →</Link>}
          </nav>
        )}
        <p className="studio-muted">
          This view is read-only. Public means the Recording is published and has a published revision; what a visitor sees is read from that published revision only, never from an open
          draft. A gap is not a blocker: the public page does not require a work, a performance or a video. Links open the existing Studio records; changing a published recording starts a new draft.
        </p>
      </section>
    </>
  );
}
