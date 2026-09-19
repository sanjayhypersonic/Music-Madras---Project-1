import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../../modules/auth/authService";
import { can } from "../../../../../../../modules/auth/policy";
import { findRecordingById, getRecordingRevisionCompletenessReport } from "../../../../../../../modules/db/repositories/recordingRepository";
import { isReadyToPublish } from "../../../../../../../modules/mmke/completeness/checkRecordingRevisionCompleteness";
import { submitForReviewAction, publishAction, archiveAction } from "./actions";

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
  const canPublish = can(session.user.role, "RECORDING_PUBLISH") && recording.currentDraftRevisionId !== null && ready;
  const canArchive = can(session.user.role, "RECORDING_PUBLISH") && recording.status !== "ARCHIVED";

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

      <div style={{ display: "flex", gap: "1rem", marginTop: "1rem" }}>
        {canSubmitForReview && (
          <form action={submitForReviewAction.bind(null, id)}>
            <button type="submit">Submit for editorial review</button>
          </form>
        )}
        {canPublish && (
          <form action={publishAction.bind(null, id, recording.currentDraftRevisionId!)}>
            <button type="submit">Publish</button>
          </form>
        )}
        {canArchive && (
          <form action={archiveAction.bind(null, id)}>
            <button type="submit">Archive</button>
          </form>
        )}
      </div>
    </div>
  );
}
