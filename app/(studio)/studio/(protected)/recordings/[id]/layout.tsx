import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
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
  });

  const title = recording.currentDraftRevision?.title ?? recording.currentPublishedRevision?.title ?? recording.slug;

  return (
    <div>
      <p>
        <Link href="/studio/recordings">← All recordings</Link>
      </p>
      <h1>
        {title} <small style={{ fontWeight: "normal" }}>({phase})</small>
      </h1>
      <div style={{ display: "flex", gap: "2rem" }}>
        <nav style={{ minWidth: "12rem", flexShrink: 0 }}>
          <ul style={{ listStyle: "none", padding: 0, display: "flex", flexDirection: "column", gap: "0.4rem" }}>
            {STEPS.map((step) => (
              <li key={step.slug}>
                <Link href={`/studio/recordings/${id}/${step.slug}`}>{step.label}</Link>
              </li>
            ))}
          </ul>
          <hr />
          <Link href={`/studio/recordings/${id}/preview`}>Preview</Link>
        </nav>
        <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
      </div>
    </div>
  );
}
