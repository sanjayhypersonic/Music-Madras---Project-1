import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../../modules/auth/authService";
import { can } from "../../../../../../../modules/auth/policy";
import { findRecordingById } from "../../../../../../../modules/db/repositories/recordingRepository";
import { AutosaveStepForm } from "../../../../_components/AutosaveStepForm";
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

  return (
    <div>
      <h2>Source</h2>
      <p>The working title and description for this recording&apos;s current draft.</p>
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
