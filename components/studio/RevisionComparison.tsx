import type { ReactNode } from "react";
import { describeSummary, type ChangeKind, type FieldComparison, type ListComparison, type RevisionComparison as Comparison } from "../../modules/mmke/recordingPreview/revisionComparison";
import { StatusBadge, type StatusTone } from "./StatusBadge";

// The read-only "what will publishing change?" preview on the Review & Publish step. It renders a comparison that was computed elsewhere
// (modules/mmke/recordingPreview/revisionComparison.ts) and contains no form, no action and no link that writes: publishing stays the existing, authorized,
// validated publish action beneath it. The words "Public now" and "After publishing" label every value, so the current public state and the proposed one
// cannot be confused; colour is never the only cue (every change carries its word).

const CHANGE_WORD: Record<ChangeKind, { text: string; tone: StatusTone }> = {
  ADDED: { text: "Added", tone: "success" },
  REMOVED: { text: "Removed", tone: "error" },
  CHANGED: { text: "Changed", tone: "warning" },
  UNCHANGED: { text: "Unchanged", tone: "neutral" },
};

function Change({ change, first }: { change: ChangeKind; first: boolean }) {
  if (first && change === "ADDED") return <StatusBadge status="NEW" tone="info">New</StatusBadge>;
  const word = CHANGE_WORD[change];
  return <StatusBadge status={change} tone={word.tone}>{word.text}</StatusBadge>;
}

function Value({ value, empty = "— none —" }: { value: string | null; empty?: string }) {
  return value === null ? <span className="studio-muted">{empty}</span> : <span className="studio-compare__value">{value}</span>;
}

function FieldsTable({ fields, first }: { fields: FieldComparison[]; first: boolean }) {
  return (
    <div className="studio-table-scroll">
      <table className="studio-compare__table">
        <thead>
          <tr>
            <th scope="col">Field</th>
            {!first && <th scope="col">Public now</th>}
            <th scope="col">{first ? "Will go live" : "After publishing"}</th>
            <th scope="col">{first ? "" : "Change"}</th>
          </tr>
        </thead>
        <tbody>
          {fields.map((field) => (
            <tr key={field.key}>
              <th scope="row">{field.label}</th>
              {!first && (
                <td>
                  <Value value={field.published} />
                </td>
              )}
              <td>
                <Value value={field.proposed} empty={field.change === "REMOVED" ? "— removed —" : "— none —"} />
              </td>
              <td>{first ? null : <Change change={field.change} first={false} />}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ListSection({ list, first }: { list: ListComparison; first: boolean }): ReactNode {
  const shown = list.items.filter((i) => i.change !== "UNCHANGED");
  const unchanged = list.items.filter((i) => i.change === "UNCHANGED");
  if (list.items.length === 0) return null;
  return (
    <section className="studio-compare__list" aria-labelledby={`compare-${list.key}`}>
      <h4 id={`compare-${list.key}`}>
        {list.label}{" "}
        <span className="studio-muted">
          {first
            ? `(${list.items.length})`
            : `(${[list.added && `${list.added} added`, list.removed && `${list.removed} removed`, list.changed && `${list.changed} changed`, list.unchanged && `${list.unchanged} unchanged`, list.reordered && "reordered"].filter(Boolean).join(", ") || "no change"})`}
        </span>
      </h4>
      {list.reordered && <p className="studio-muted">The same works appear in a different order after publishing.</p>}
      <ul className="studio-compare__items">
        {(first ? list.items : shown).map((item) => (
          <li key={`${item.change}-${item.id}`}>
            <Change change={item.change} first={first} /> <span className="studio-compare__value">{item.label}</span>
            {item.change === "CHANGED" && (
              <span className="studio-muted">
                {" "}
                ({item.was ?? "none"} → {item.now ?? "none"})
              </span>
            )}
            {item.note && <span className="studio-muted"> — {item.note}</span>}
          </li>
        ))}
      </ul>
      {!first && unchanged.length > 0 && (
        <details>
          <summary>
            {unchanged.length} unchanged
          </summary>
          <ul className="studio-compare__items">
            {unchanged.map((item) => (
              <li key={item.id}>
                <span className="studio-compare__value">{item.label}</span>
                {item.note && <span className="studio-muted"> — {item.note}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

export function RevisionComparison({ comparison, proposedRevisionNumber, publishedRevisionNumber }: { comparison: Comparison; proposedRevisionNumber: number; publishedRevisionNumber: number | null }) {
  const first = comparison.mode === "FIRST_PUBLICATION";
  const changedFields = comparison.fields.filter((f) => f.change !== "UNCHANGED");
  const unchangedFields = comparison.fields.filter((f) => f.change === "UNCHANGED");
  const fieldsToShow = first ? comparison.fields.filter((f) => f.proposed !== null) : changedFields;

  return (
    <section className="studio-panel studio-compare" aria-labelledby="compare-heading">
      <h3 id="compare-heading">What publishing will change</h3>
      <p role="status" className="studio-compare__summary">
        {describeSummary(comparison)}
      </p>
      <p className="studio-muted">
        {first ? (
          <>
            <strong>Public now:</strong> nothing — this recording has never been published. <strong>After publishing:</strong> the draft (revision {proposedRevisionNumber}) below.
          </>
        ) : (
          <>
            <strong>Public now:</strong> published revision {publishedRevisionNumber}. <strong>After publishing:</strong> the open draft, revision {proposedRevisionNumber}. This preview only reads; nothing changes until you publish.
          </>
        )}
      </p>

      {fieldsToShow.length > 0 && <FieldsTable fields={fieldsToShow} first={first} />}
      {!first && unchangedFields.length > 0 && (
        <details>
          <summary>{unchangedFields.length} unchanged field{unchangedFields.length === 1 ? "" : "s"}</summary>
          <p className="studio-muted">{unchangedFields.map((f) => f.label).join(", ")}</p>
        </details>
      )}

      {comparison.lists.map((list) => (
        <ListSection key={list.key} list={list} first={first} />
      ))}

      <p className="studio-muted studio-compare__limits">
        Compared: the revision&apos;s own fields, its works (with order), its performance&apos;s programme, venue, date and participants, its media, and its sources, rights information
        and occasions — each read from that revision itself. Not compared: collection membership and learning-guide membership (they belong to the collection or guide, not to the
        revision, and change when you edit those), and the text of a source&apos;s citations.
      </p>
    </section>
  );
}
