import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../../modules/auth/authService";
import { findRecordingById } from "../../../../../../../modules/db/repositories/recordingRepository";
import { AutosaveStepForm } from "../../../../_components/AutosaveStepForm";
import { saveSeoStep } from "./actions";

export default async function SeoStepPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getCurrentStudioSession();
  if (!session) redirect("/studio/signin");

  const recording = await findRecordingById(id);
  if (!recording) redirect("/studio/recordings");

  if (!recording.currentDraftRevision) {
    return (
      <div>
        <h2>SEO</h2>
        <p>Open a draft from the Source step before editing SEO metadata.</p>
      </div>
    );
  }

  return (
    <div>
      <h2>SEO</h2>
      <p>Metadata for this recording&apos;s public page — distinct from catalogue data (ADR §19).</p>
      <AutosaveStepForm
        recordingId={id}
        initialUpdatedAt={recording.currentDraftRevision.updatedAt.toISOString()}
        initialValues={{
          seoMetaTitle: recording.currentDraftRevision.seoMetaTitle ?? "",
          seoMetaDescription: recording.currentDraftRevision.seoMetaDescription ?? "",
          seoCanonicalPath: recording.currentDraftRevision.seoCanonicalPath ?? "",
        }}
        fields={[
          { name: "seoMetaTitle", label: "Meta title", type: "text" },
          { name: "seoMetaDescription", label: "Meta description", type: "textarea" },
          { name: "seoCanonicalPath", label: "Canonical path", type: "text" },
        ]}
        saveAction={saveSeoStep}
      />
    </div>
  );
}
