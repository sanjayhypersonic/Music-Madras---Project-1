import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentStudioSession } from "../../../../../modules/auth/authService";
import { can } from "../../../../../modules/auth/policy";
import { formatAuditTimestamp } from "../../../../../modules/audit/auditDisplay";
import {
  getRecordingRevisionCompletenessReport,
  listRecordingsForStudio,
} from "../../../../../modules/db/repositories/recordingRepository";
import { getEditorialOperationsQueue } from "../../../../../modules/db/repositories/editorialQueueRepository";
import { computeEditorialPhase, type EditorialPhase } from "../../../../../modules/publishing/editorialPhase";
import {
  EDITORIAL_QUEUE_DEFAULT_PAGE_SIZE,
  EDITORIAL_QUEUE_EMPTY_MESSAGES,
  EDITORIAL_QUEUE_STATES,
  EDITORIAL_QUEUE_STATE_LABELS,
  isEditorialQueueState,
  type EditorialQueueRow,
} from "../../../../../modules/mmke/contentIntelligence/editorialOperationsQueue";
import {
  RECORDING_EDITORIAL_TARGET_FIELDS,
  isRecordingEditorialTargetField,
} from "../../../../../modules/mmke/contentIntelligence/recordingEditorialTargetFields";
import { generateEditorialSuggestionAction } from "../content-suggestions/generateAction";
import { decodeMessage } from "../../../../../modules/studio/decodeMessage";

// Phase 6I-3 — the Editorial Operations Queue. The existing /studio/editorial
// route (recordings grouped by editorial phase) now leads with a queue of what
// needs a human or an explicit action next, derived live from canonical state
// (modules/mmke/contentIntelligence/editorialOperationsQueue.ts). Nothing here
// is stored, nothing acts on its own: every button is an existing action with
// its existing permission, enforced server-side by that action. Filters and
// the page number live in the URL, so a filtered view is a shareable link.

const cell = { borderBottom: "1px solid var(--mm-border)", padding: "0.4rem 0.5rem 0.4rem 0", verticalAlign: "top" } as const;
const head = { textAlign: "left", borderBottom: "1px solid var(--mm-border)", paddingRight: "0.5rem" } as const;

interface QueueSearchParams {
  state?: string;
  q?: string;
  yt?: string;
  field?: string;
  page?: string;
  error?: string;
}

function queueHref(params: { state?: string; q?: string; yt?: string; field?: string; page?: number }): string {
  const search = new URLSearchParams();
  if (params.state) search.set("state", params.state);
  if (params.q) search.set("q", params.q);
  if (params.yt) search.set("yt", params.yt);
  if (params.field) search.set("field", params.field);
  if (params.page && params.page > 1) search.set("page", String(params.page));
  const query = search.toString();
  return query ? `/studio/editorial?${query}` : "/studio/editorial";
}

function RowAction({ row, canGenerate, returnTo }: { row: EditorialQueueRow; canGenerate: boolean; returnTo: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem", alignItems: "flex-start" }}>
      {row.actions.map((action) => {
        switch (action) {
          case "OPEN_RECORDING_EDITOR":
            return (
              <Link key={action} href={`/studio/recordings/${row.recordingId}/review`}>
                Open in editor
              </Link>
            );
          case "REVIEW_SUGGESTION":
            return (
              <Link key={action} href={`/studio/content-suggestions/${row.suggestionId}`}>
                Review
              </Link>
            );
          case "APPLY_SUGGESTION":
            return (
              <Link key={action} href={`/studio/content-suggestions/${row.suggestionId}`}>
                Review &amp; apply
              </Link>
            );
          case "GENERATE":
          case "REGENERATE":
            // Hidden (not merely disabled) without permission; the action itself re-checks RECORDING_WRITE.
            if (!canGenerate) return null;
            return (
              <form key={action} action={generateEditorialSuggestionAction}>
                <input type="hidden" name="recordingId" value={row.recordingId} />
                <input type="hidden" name="returnTo" value={returnTo} />
                <button type="submit">{action === "REGENERATE" ? "Regenerate suggestion" : "Generate suggestion"}</button>
              </form>
            );
        }
      })}
      {row.blockedReason && <span style={{ fontSize: "0.85rem", color: "var(--mm-text-muted)" }}>{row.blockedReason}</span>}
    </div>
  );
}

function RowDetail({ row }: { row: EditorialQueueRow }) {
  if (row.state === "NEEDS_ENRICHMENT" || row.state === "READY_FOR_GENERATION") {
    return (
      <div style={{ fontSize: "0.85rem", color: "var(--mm-text-secondary)" }}>
        {row.readiness && <div>Readiness: {row.readiness}</div>}
        <div>{row.gaps.length > 0 ? `Missing: ${row.gaps.join(", ")}` : row.state === "NEEDS_ENRICHMENT" ? "No gaps — publish it to enable generation." : "No gaps."}</div>
      </div>
    );
  }
  if (row.state === "CHANGES_REQUESTED" && (row.reviewNote || row.reviewerName)) {
    return (
      <div style={{ fontSize: "0.85rem", color: "var(--mm-text-secondary)" }}>
        {row.reviewerName ?? "A reviewer"}
        {row.reviewedAt ? `, ${formatAuditTimestamp(row.reviewedAt)}` : ""}
        {row.reviewNote ? `: “${row.reviewNote}”` : ""}
      </div>
    );
  }
  return null;
}

export default async function EditorialPage({ searchParams }: { searchParams: Promise<QueueSearchParams> }) {
  const session = await getCurrentStudioSession();
  if (!session) redirect("/studio/signin");

  const params = await searchParams;
  const state = params.state && isEditorialQueueState(params.state) ? params.state : undefined;
  const field = params.field && isRecordingEditorialTargetField(params.field) ? params.field : undefined;
  const q = params.q?.trim().slice(0, 200) || undefined;
  const yt = params.yt?.trim().slice(0, 200) || undefined;
  const requestedPage = Number.parseInt(params.page ?? "1", 10);

  const queue = await getEditorialOperationsQueue({
    state,
    recordingTitle: q,
    youtubeTitle: yt,
    targetField: field,
    page: Number.isFinite(requestedPage) ? requestedPage : 1,
    pageSize: EDITORIAL_QUEUE_DEFAULT_PAGE_SIZE,
  });

  const canGenerate = can(session.user.role, "RECORDING_WRITE");
  const filtered = Boolean(state || q || yt || field);
  const returnTo = queueHref({ state, q, yt, field, page: queue.page });

  const recordings = await listRecordingsForStudio();
  const withPhase = await Promise.all(
    recordings.map(async (recording) => {
      const openRevisionId = recording.currentDraftRevisionId;
      const completeness = openRevisionId ? await getRecordingRevisionCompletenessReport(openRevisionId) : null;
      const phase = computeEditorialPhase({
        aggregateStatus: recording.status,
        hasPublishedRevision: recording.currentPublishedRevisionId !== null,
        draftReadiness: completeness?.readiness ?? null,
        draftHasAnyContent: completeness?.report.some((item) => item.status === "COMPLETE") ?? false,
        hasOpenDraft: recording.currentDraftRevisionId !== null,
      });
      return { recording, phase };
    })
  );

  const byPhase = new Map<EditorialPhase, typeof withPhase>();
  for (const entry of withPhase) {
    const bucket = byPhase.get(entry.phase) ?? [];
    bucket.push(entry);
    byPhase.set(entry.phase, bucket);
  }

  const phaseOrder: EditorialPhase[] = ["DRAFT", "ENRICHMENT", "EDITORIAL_REVIEW", "APPROVED", "UPDATED", "PUBLISHED", "ARCHIVED"];

  return (
    <div>
      <h1>Editorial</h1>
      <p>
        What needs an editor, or an explicit action, next. Everything here is derived from the Recordings and Content Suggestions themselves — nothing
        is assigned, scored, or published automatically.
      </p>
      {params.error && <p role="alert" className="studio-alert studio-alert--error">{decodeMessage(params.error)}</p>}

      <h2>Queue</h2>
      <ul style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem 1.25rem", listStyle: "none", padding: 0 }}>
        {EDITORIAL_QUEUE_STATES.map((value) => (
          <li key={value} style={{ fontWeight: state === value ? 700 : 400 }}>
            <Link href={queueHref({ state: value })}>{EDITORIAL_QUEUE_STATE_LABELS[value]}</Link>: {queue.counts[value]}
          </li>
        ))}
      </ul>

      <form method="get" style={{ margin: "1rem 0", display: "flex", flexWrap: "wrap", gap: "1rem", alignItems: "flex-end" }}>
        <label>
          State
          <select name="state" defaultValue={state ?? ""} style={{ display: "block" }}>
            <option value="">All</option>
            {EDITORIAL_QUEUE_STATES.map((value) => (
              <option key={value} value={value}>
                {EDITORIAL_QUEUE_STATE_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Recording title
          <input name="q" defaultValue={q ?? ""} style={{ display: "block" }} />
        </label>
        <label>
          YouTube title
          <input name="yt" defaultValue={yt ?? ""} style={{ display: "block" }} />
        </label>
        <label>
          Target field
          <select name="field" defaultValue={field ?? ""} style={{ display: "block" }}>
            <option value="">All</option>
            {RECORDING_EDITORIAL_TARGET_FIELDS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <button type="submit">Filter</button>
        <Link href="/studio/editorial">Clear</Link>
      </form>

      {queue.total === 0 ? (
        <p>{state && !q && !yt && !field ? EDITORIAL_QUEUE_EMPTY_MESSAGES[state] : filtered ? "No queue items match these filters." : "The queue is empty — nothing needs attention."}</p>
      ) : (
        <>
          <div className="studio-table-scroll">
<table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr>
                <th style={head}>Recording</th>
                <th style={head}>YouTube video</th>
                <th style={head}>State</th>
                <th style={head}>Target field</th>
                <th style={head}>Suggestion</th>
                <th style={head}>Freshness</th>
                <th style={head}>Last updated</th>
                <th style={head}>Action</th>
              </tr>
            </thead>
            <tbody>
              {queue.rows.map((row) => (
                <tr key={row.key}>
                  <td style={cell}>
                    <Link href={`/studio/recordings/${row.recordingId}/review`}>{row.recordingTitle}</Link>
                    <RowDetail row={row} />
                  </td>
                  <td style={cell}>{row.youtubeTitle ?? "—"}</td>
                  <td style={cell}>{EDITORIAL_QUEUE_STATE_LABELS[row.state]}</td>
                  <td style={cell}>{row.targetField ?? "—"}</td>
                  <td style={cell}>
                    {row.suggestionStatus ? (
                      <>
                        {row.suggestionStatus}
                        <div style={{ fontSize: "0.85rem", color: "var(--mm-text-secondary)" }}>{row.suggestionType}</div>
                      </>
                    ) : row.generationStatus ? (
                      `Generation ${row.generationStatus}`
                    ) : (
                      "—"
                    )}
                  </td>
                  <td style={cell}>{row.freshness ?? "—"}</td>
                  <td style={cell}>{formatAuditTimestamp(row.lastUpdated)}</td>
                  <td style={cell}>
                    <RowAction row={row} canGenerate={canGenerate} returnTo={returnTo} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
</div>
          <p style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
            {queue.page > 1 ? <Link href={queueHref({ state, q, yt, field, page: queue.page - 1 })}>← Previous</Link> : <span />}
            <span>
              Page {queue.page} of {queue.totalPages} · {queue.total} item{queue.total === 1 ? "" : "s"}
            </span>
            {queue.page < queue.totalPages ? <Link href={queueHref({ state, q, yt, field, page: queue.page + 1 })}>Next →</Link> : <span />}
          </p>
        </>
      )}

      <h2>Recordings by editorial phase</h2>
      <p>Every recording, grouped by where it stands in the editorial workflow.</p>
      {phaseOrder.map((phase) => {
        const entries = byPhase.get(phase) ?? [];
        if (entries.length === 0) return null;
        return (
          <section key={phase}>
            <h3>
              {phase} ({entries.length})
            </h3>
            <ul>
              {entries.map(({ recording }) => (
                <li key={recording.id}>
                  <Link href={`/studio/recordings/${recording.id}/review`}>
                    {recording.currentDraftRevision?.title ?? recording.currentPublishedRevision?.title ?? recording.slug}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      {recordings.length === 0 && <p className="studio-empty">No recordings yet.</p>}
    </div>
  );
}
