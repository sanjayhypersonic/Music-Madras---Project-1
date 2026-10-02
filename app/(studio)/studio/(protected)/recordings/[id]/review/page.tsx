import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../../modules/auth/authService";
import { can } from "../../../../../../../modules/auth/policy";
import { findRecordingById, getRecordingRevisionCompletenessReport } from "../../../../../../../modules/db/repositories/recordingRepository";
import { isReadyToPublish } from "../../../../../../../modules/mmke/completeness/checkRecordingRevisionCompleteness";
import { ConfirmSubmitButton } from "../../../../../../../components/studio/ConfirmSubmitButton";
import { submitForReviewAction, publishAction, unpublishAction, restoreAction, archiveAction } from "./actions";

export default async function ReviewStepPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;
  const session = await getCurrentStudioSession();
  if (!session) redirect("/studio/signin");

  const recording = await findRecordingById(id);
  if (!recording) redirect("/studio/recordings");

  const openRevisionId = recording.currentDraftRevisionId ?? recording.currentPublishedRevisionId;
  const completeness = openRevisionId ? await getRecordingRevisionCompletenessReport(openRevisionId) : null;
  const ready = completeness ? isReadyToPublish(completeness.report) : false;

  const canSubmitForReview = can(session.user.role, "EDITORIAL_REVIEW") && recording.status === "DRAFT";
  const mayPublish = can(session.user.role, "RECORDING_PUBLISH");
  // Phase 6J-1: an ARCHIVED recording is never published from here — it must be restored first.
  const canPublish = mayPublish && recording.currentDraftRevisionId !== null && ready && recording.status !== "ARCHIVED";
  const canUnpublish = mayPublish && recording.status === "PUBLISHED";
  const canRestore = mayPublish && recording.status === "ARCHIVED";
  const canArchive = mayPublish && recording.status !== "ARCHIVED";

  return (
    <div>
      <h2>Review &amp; Publish</h2>
      {error && <p style={{ color: "#b00020" }}>{decodeURIComponent(error)}</p>}

      {!completeness ? (
        <p>No revision to review yet.</p>
      ) : (
        <>
          <p>Readiness: {completeness.readiness}</p>
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
                  <td style={{ color: item.status === "MISSING" && item.level === "REQUIRED" ? "#b00020" : undefined }}>
                    {item.status}
                  </td>
                  <td>{item.detail ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <p>Status: {recording.status}</p>

      <div style={{ display: "flex", gap: "1rem", marginTop: "1rem", flexWrap: "wrap" }}>
        {canSubmitForReview && (
          <form action={submitForReviewAction.bind(null, id)}>
            <ConfirmSubmitButton>Submit for editorial review</ConfirmSubmitButton>
          </form>
        )}
        {canPublish && (
          <form action={publishAction.bind(null, id, recording.currentDraftRevisionId!)}>
            <ConfirmSubmitButton
              confirmMessage="Publish this recording? The current draft will become the version visitors see on the public Museum."
              pendingLabel="Publishing…"
            >
              Publish
            </ConfirmSubmitButton>
          </form>
        )}
        {canUnpublish && (
          <form action={unpublishAction.bind(null, id)}>
            <ConfirmSubmitButton
              confirmMessage="Unpublish this recording? It will disappear from the public Museum immediately. Its history is kept, and it can be published again later."
              pendingLabel="Unpublishing…"
            >
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
            >
              Archive
            </ConfirmSubmitButton>
          </form>
        )}
      </div>
    </div>
  );
}
