import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../../modules/auth/authService";
import { findRecordingById } from "../../../../../../../modules/db/repositories/recordingRepository";
import { AutosaveStepForm } from "../../../../_components/AutosaveStepForm";
import { saveEducationalStep } from "./actions";

export default async function EducationalStepPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getCurrentStudioSession();
  if (!session) redirect("/studio/signin");

  const recording = await findRecordingById(id);
  if (!recording) redirect("/studio/recordings");

  if (!recording.currentDraftRevision) {
    return (
      <div>
        <h2>Educational Content</h2>
        <p>Open a draft from the Source step before editing educational content.</p>
      </div>
    );
  }

  return (
    <div>
      <h2>Educational Content</h2>
      <p>Optional context for listeners — a listening guide and analysis, and a difficulty level.</p>
      <AutosaveStepForm
        recordingId={id}
        initialUpdatedAt={recording.currentDraftRevision.updatedAt.toISOString()}
        initialValues={{
          educationalDifficultyLevel: recording.currentDraftRevision.educationalDifficultyLevel ?? "",
          educationalListeningGuide: recording.currentDraftRevision.educationalListeningGuide ?? "",
          educationalAnalysis: recording.currentDraftRevision.educationalAnalysis ?? "",
        }}
        fields={[
          { name: "educationalDifficultyLevel", label: "Difficulty level", type: "text" },
          { name: "educationalListeningGuide", label: "Listening guide", type: "textarea" },
          { name: "educationalAnalysis", label: "Analysis", type: "textarea" },
        ]}
        saveAction={saveEducationalStep}
      />
    </div>
  );
}
