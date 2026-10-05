import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../../modules/auth/authService";
import { can } from "../../../../../../../modules/auth/policy";
import { findRecordingById } from "../../../../../../../modules/db/repositories/recordingRepository";
import { AutosaveStepForm } from "../../../../_components/AutosaveStepForm";
import { findPrimaryYouTubeVideoForRevision } from "../../../../../../../modules/db/repositories/recordingIntakeRepository";
import { saveSourceStep } from "./actions";
import { startNewDraftAction } from "../draftActions";

export default async function SourceStepPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getCurrentStudioSession();
  if (!session) redirect("/studio/signin");

  const recording = await findRecordingById(id);
  if (!recording) redirect("/studio/recordings");

  if (!recording.currentDraftRevision) {
    const archived = recording.status === "ARCHIVED";
    const canWrite = can(session.user.role, "RECORDING_WRITE") && !archived;
    return (
      <div>
        <h2>Source</h2>
        <p>
          {recording.status === "PUBLISHED"
            ? "This recording is live with no pending changes"
            : "This recording is not public and has no open draft"}{" "}
          (last published version “{recording.currentPublishedRevision?.title ?? recording.slug}”).
        </p>
        {archived && <p>This recording is archived. Restore it from the Review &amp; Publish step before making changes.</p>}
        {canWrite && (
          <form action={startNewDraftAction.bind(null, id, "source")}>
            <button type="submit" className="studio-button--primary">
              Start a new draft to make changes
            </button>
          </form>
        )}
      </div>
    );
  }

  const youtubeVideo = await findPrimaryYouTubeVideoForRevision(recording.currentDraftRevision.id);
  const hasTitle = Boolean(recording.currentDraftRevision.title?.trim());

  return (
    <div>
      <h2>Source</h2>
      <p>The Music Madras title and description for this recording&apos;s current draft.</p>
      {youtubeVideo && (
        <div className="studio-panel">
          <p>
            <strong>YouTube title</strong> (reference only — it is YouTube&apos;s metadata and is never changed here):
          </p>
          <p>{youtubeVideo.title ?? "(untitled video)"}</p>
          <p className="studio-muted">
            {hasTitle
              ? "The Title below is the canonical Music Madras title."
              : "A Music Madras title is required before this recording can be published. Enter the canonical title below — it is not taken from YouTube."}
          </p>
        </div>
      )}
      <AutosaveStepForm
        recordingId={id}
        initialUpdatedAt={recording.currentDraftRevision.updatedAt.toISOString()}
        initialValues={{
          title: recording.currentDraftRevision.title ?? "",
          description: recording.currentDraftRevision.description ?? "",
        }}
        fields={[
          { name: "title", label: "Title", type: "text" },
          { name: "description", label: "Description", type: "textarea" },
        ]}
        saveAction={saveSourceStep}
      />
    </div>
  );
}
