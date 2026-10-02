import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../../modules/auth/authService";
import { can } from "../../../../../../../modules/auth/policy";
import { findRecordingById, forkDraftFromPublished } from "../../../../../../../modules/db/repositories/recordingRepository";
import { AutosaveStepForm } from "../../../../_components/AutosaveStepForm";
import { saveSourceStep } from "./actions";

export default async function SourceStepPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getCurrentStudioSession();
  if (!session) redirect("/studio/signin");

  const recording = await findRecordingById(id);
  if (!recording) redirect("/studio/recordings");

  if (!recording.currentDraftRevision) {
    const archived = recording.status === "ARCHIVED";
    const canWrite = can(session.user.role, "RECORDING_WRITE") && !archived;
    async function forkAction() {
      "use server";
      const session = await getCurrentStudioSession();
      if (!session || !can(session.user.role, "RECORDING_WRITE")) return;
      // Phase 6J-1: forking an ARCHIVED Recording would quietly move it to IN_REVIEW, bypassing
      // restore (and its audit entry); a double-click would also fork twice. Re-check the live state.
      const current = await findRecordingById(id);
      if (current && current.status !== "ARCHIVED" && current.currentDraftRevisionId === null) {
        try {
          await forkDraftFromPublished(id, session.user.id);
        } catch {
          // Nothing to fork (never published) — fall through to the page, which explains the state.
        }
      }
      redirect(`/studio/recordings/${id}/source`);
    }

    return (
      <div>
        <h2>Source</h2>
        <p>
          This recording is published with no pending changes (revision “
          {recording.currentPublishedRevision?.title ?? recording.slug}”).
        </p>
        {archived && <p>This recording is archived. Restore it from the Review &amp; Publish step before making changes.</p>}
        {canWrite && (
          <form action={forkAction}>
            <button type="submit">Start a new draft to make changes</button>
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
