import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RecordingSteps } from "../../../../../../components/studio/RecordingSteps";
import {
  findRecordingById,
  getRecordingRevisionCompletenessReport,
} from "../../../../../../modules/db/repositories/recordingRepository";
import { computeEditorialPhase } from "../../../../../../modules/publishing/editorialPhase";

const STEPS: Array<{ slug: string; label: string }> = [
  { slug: "source", label: "1. Source" },
  { slug: "programme", label: "2. Programme" },
  { slug: "works", label: "3. Composer / Works" },
  { slug: "performance", label: "4. Performance" },
  { slug: "venue", label: "5. Venue" },
  { slug: "participants", label: "6. Participants" },
  { slug: "educational", label: "7. Educational Content" },
  { slug: "media", label: "8. Media Assets" },
  { slug: "seo", label: "9. SEO" },
  { slug: "relationships", label: "10. Relationships" },
  { slug: "review", label: "11. Review & Publish" },
];

export default async function RecordingWorkflowLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const recording = await findRecordingById(id);
  if (!recording) {
    notFound();
  }

  const openRevisionId = recording.currentDraftRevisionId ?? recording.currentPublishedRevisionId;
  const completeness = openRevisionId ? await getRecordingRevisionCompletenessReport(openRevisionId) : null;

  const phase = computeEditorialPhase({
    aggregateStatus: recording.status,
    hasPublishedRevision: recording.currentPublishedRevisionId !== null,
    draftReadiness: recording.currentDraftRevisionId ? completeness?.readiness ?? null : null,
    draftHasAnyContent: completeness?.report.some((item) => item.status === "COMPLETE") ?? false,
    hasOpenDraft: recording.currentDraftRevisionId !== null,
  });

  // An untitled recording (a fresh intake draft has no Music Madras title yet) is shown as such, not by its URL slug.
  const title = recording.currentDraftRevision?.title || recording.currentPublishedRevision?.title || "Untitled recording";

  return (
    <div>
      <p>
        <Link href="/studio/recordings">← All recordings</Link>
      </p>
      <h1>
        {title} <small style={{ fontWeight: "normal" }}>({phase})</small>
      </h1>
      <div className="studio-steps-layout">
        <RecordingSteps recordingId={id} steps={STEPS} />
        <div className="studio-steps-layout__content">{children}</div>
      </div>    </div>
  );
}
