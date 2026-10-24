import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../../modules/auth/authService";
import { can, describeRolesThatCan } from "../../../../../../../modules/auth/policy";
import { findRecordingById, getRecordingRevisionCompletenessReport } from "../../../../../../../modules/db/repositories/recordingRepository";
import { isReadyToPublish } from "../../../../../../../modules/mmke/completeness/checkRecordingRevisionCompleteness";
import { ConfirmSubmitButton } from "../../../../../../../components/studio/ConfirmSubmitButton";
import { RevisionComparison } from "../../../../../../../components/studio/RevisionComparison";
import { RecordingHoldPanel } from "../../../../../../../components/studio/RecordingHoldPanel";
import { RevisionRelationshipDataError } from "../../../../../../../modules/db/repositories/recordingRelationshipReadersRepository";
import { loadPublicationPreview, type PublicationPreview } from "../../../../../../../modules/db/repositories/recordingRevisionComparisonRepository";
import { submitForReviewAction, publishAction, unpublishAction, restoreAction, archiveAction, imposeHoldAction, liftHoldAction } from "./actions";
import { startNewDraftAction } from "../draftActions";
import { describeReviewGuidance } from "../../../../../../../modules/publishing/reviewGuidance";
import { reviewNoticeText } from "../../../../../../../modules/publishing/reviewNotices";
import { decodeMessage } from "../../../../../../../modules/studio/decodeMessage";

export default async function ReviewStepPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const { id } = await params;
  const { error, notice } = await searchParams;
  const noticeText = reviewNoticeText(notice);
  const session = await getCurrentStudioSession();
  if (!session) redirect("/studio/signin");

  const recording = await findRecordingById(id);
  if (!recording) redirect("/studio/recordings");

  const openRevisionId = recording.currentDraftRevisionId ?? recording.currentPublishedRevisionId;
  const completeness = openRevisionId ? await getRecordingRevisionCompletenessReport(openRevisionId) : null;
  const ready = completeness ? isReadyToPublish(completeness.report) : false;

  // The read-only "what will publishing change" preview. It never creates a draft and never writes: it only reads the open draft and the published
  // revision. Inconsistent revision data is shown as itself (and nothing is compared), never guessed around.
  let preview: PublicationPreview | null = null;
  let previewProblem: string | null = null;
  try {
    preview = await loadPublicationPreview(id);
  } catch (err) {
    if (!(err instanceof RevisionRelationshipDataError)) throw err;
    previewProblem = err.message;
  }

  // Phase 6J-4: the editable state is explicit. "Open draft" is the only thing that can be reviewed or published;
  // a Recording without one (published with no pending changes, or UNPUBLISHED — which keeps its last published
  // version as history and opens no draft) must start a new draft to be edited and published again.
  const hasOpenDraft = recording.currentDraftRevisionId !== null;
  const hasPublishedRevision = recording.currentPublishedRevisionId !== null;
  const isLive = recording.status === "PUBLISHED";
  const canStartDraft = can(session.user.role, "RECORDING_WRITE") && !hasOpenDraft && hasPublishedRevision && recording.status !== "ARCHIVED";
  const canSubmitForReview = can(session.user.role, "EDITORIAL_REVIEW") && recording.status === "DRAFT" && hasOpenDraft;
  const mayPublish = can(session.user.role, "RECORDING_PUBLISH");
  // Phase 6J-1: an ARCHIVED recording is never published from here — it must be restored first.
  const canPublish = mayPublish && recording.currentDraftRevisionId !== null && ready && recording.status !== "ARCHIVED";
  const canUnpublish = mayPublish && recording.status === "PUBLISHED";
  const canRestore = mayPublish && recording.status === "ARCHIVED";
  const canArchive = mayPublish && recording.status !== "ARCHIVED";

  // Plain-language "where does this stand and what next" for THIS viewer. It only describes: the permission checks above and in the actions decide what is possible.
  const mayEdit = can(session.user.role, "RECORDING_WRITE");
  const guidance = describeReviewGuidance({
    status: recording.status,
    hasOpenDraft,
    hasPublishedRevision,
    report: completeness?.report ?? null,
    held: recording.holdReason !== null,
    viewer: { canEdit: mayEdit, canSubmitForReview: can(session.user.role, "EDITORIAL_REVIEW"), canPublish: mayPublish },
    whoCan: { review: describeRolesThatCan("EDITORIAL_REVIEW"), publish: describeRolesThatCan("RECORDING_PUBLISH") },
  });

  return (
    <div>
      <h2>Review &amp; Publish</h2>
      {error && <p role="alert" className="studio-alert studio-alert--error">{decodeMessage(error)}</p>}
      {noticeText && !error && <p role="status" className="studio-alert studio-alert--success">{noticeText}</p>}

      <section aria-label="Where this recording stands" className="studio-panel">
        <p><strong>{guidance.summary}</strong></p>
        {guidance.blockers.length > 0 && (
          <>
            <p>Required before it can be published:</p>
            <ul>
              {guidance.blockers.map((b) => (
                <li key={b.category}>
                  <strong>{b.category}</strong>: {b.message}{" "}
                  {b.step && mayEdit && <a href={`/studio/recordings/${id}/${b.step.slug}`}>Go to {b.step.label}</a>}
                  {b.step && !mayEdit && <span className="studio-muted">({b.step.label} step)</span>}
                </li>
              ))}
            </ul>
          </>
        )}
        {guidance.suggestions.length > 0 && (
          <p className="studio-muted">
            Recommended, not required: {guidance.suggestions.map((s) => s.category).join(", ")}.
          </p>
        )}
        <ul>
          {guidance.actions.filter((a) => a.state !== "AVAILABLE").map((a) => (
            <li key={a.key}>
              <strong>{a.label}</strong>: {a.reason}
            </li>
          ))}
        </ul>
      </section>

      <RecordingHoldPanel
        // The note is for people who can manage holds; anyone else sees that a hold exists, and why in kind, but not the note.
        hold={recording.holdReason && recording.holdSetAt ? { reason: recording.holdReason, note: mayPublish ? recording.holdNote : null, setAt: recording.holdSetAt } : null}
        isLive={isLive}
        canManage={mayPublish}
        publishers={describeRolesThatCan("RECORDING_PUBLISH")}
        impose={imposeHoldAction.bind(null, id)}
        lift={liftHoldAction.bind(null, id)}
      />
      {!completeness ? (
        <p className="studio-empty">No revision to review yet.</p>
      ) : (
        <>
          <p>
            Readiness of the {hasOpenDraft ? "open draft" : "published version"}: {completeness.readiness}
          </p>
          <div className="studio-table-scroll">
<table>
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>Category</th>
                <th style={{ textAlign: "left" }}>Level</th>
                <th style={{ textAlign: "left" }}>Status</th>
                <th style={{ textAlign: "left" }}>Detail</th>
              </tr>
            </thead>
            <tbody>
              {completeness.report.map((item) => (
                <tr key={item.category}>
                  <td>{item.category}</td>
                  <td>{item.level}</td>
                  <td style={{ color: item.status === "MISSING" && item.level === "REQUIRED" ? "var(--mm-error)" : undefined }}>
                    {item.status}
                  </td>
                  <td>{item.detail ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
</div>
        </>
      )}

      {previewProblem && (
        <p role="alert" className="studio-alert studio-alert--error">
          The comparison could not be shown: {previewProblem} Publishing is not affected by this notice, but the revision data should be looked at.
        </p>
      )}
      {preview?.state === "PREVIEW" && (
        <RevisionComparison comparison={preview.comparison} proposedRevisionNumber={preview.proposedRevisionNumber} publishedRevisionNumber={preview.publishedRevisionNumber} />
      )}
      {preview?.state === "NO_DRAFT" && (
        <p className="studio-muted">There is no open draft, so nothing is proposed for publication and there is nothing to compare.</p>
      )}

      <p>Status: {recording.status}</p>

      {!hasOpenDraft && recording.status !== "ARCHIVED" && (
        <div className="studio-panel">
          {isLive ? (
            <p>This recording is live with no pending changes. Start a new draft to edit it; the live version stays public until the new draft is published.</p>
          ) : (
            <p>
              This recording is <strong>not public</strong>. Its last published version is kept in its history. To change it and publish it again, start a new
              draft — that copies the published version into an editable draft; nothing becomes public until you publish.
            </p>
          )}
          {canStartDraft ? (
            <form action={startNewDraftAction.bind(null, id, "review")}>
              <ConfirmSubmitButton tone="primary" pendingLabel="Starting…">
                Start a new draft
              </ConfirmSubmitButton>
            </form>
          ) : (
            !hasPublishedRevision && <p className="studio-muted">There is no published version to start a draft from.</p>
          )}
        </div>
      )}

      <div style={{ display: "flex", gap: "1rem", marginTop: "1rem", flexWrap: "wrap" }}>
        {canSubmitForReview && (
          <form action={submitForReviewAction.bind(null, id)}>
            <ConfirmSubmitButton tone="primary">Submit for editorial review</ConfirmSubmitButton>
          </form>
        )}
        {canPublish && (
          <form action={publishAction.bind(null, id, recording.currentDraftRevisionId!)}>
            <ConfirmSubmitButton
              confirmMessage="Publish this recording? The current draft will become the version visitors see on the public Museum."
              pendingLabel="Publishing…"
             tone="primary">
              Publish
            </ConfirmSubmitButton>
          </form>
        )}
        {canUnpublish && (
          <form action={unpublishAction.bind(null, id)}>
            <ConfirmSubmitButton
              confirmMessage="Unpublish this recording? It will disappear from the public Museum immediately. Its history is kept, and it can be published again later."
              pendingLabel="Unpublishing…"
             tone="danger">
              Unpublish
            </ConfirmSubmitButton>
          </form>
        )}
        {canRestore && (
          <form action={restoreAction.bind(null, id)}>
            <ConfirmSubmitButton
              confirmMessage="Restore this archived recording to Draft? It stays hidden from the public Museum until it is published again."
              pendingLabel="Restoring…"
            >
              Restore to draft
            </ConfirmSubmitButton>
          </form>
        )}
        {canArchive && (
          <form action={archiveAction.bind(null, id)}>
            <ConfirmSubmitButton
              confirmMessage="Archive this recording? It will be removed from the public Museum. You can restore it later."
              pendingLabel="Archiving…"
             tone="danger">
              Archive
            </ConfirmSubmitButton>
          </form>
        )}
      </div>
    </div>
  );
}
