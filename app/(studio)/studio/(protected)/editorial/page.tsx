import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentStudioSession } from "../../../../../modules/auth/authService";
import {
  getRecordingRevisionCompletenessReport,
  listRecordingsForStudio,
} from "../../../../../modules/db/repositories/recordingRepository";
import { computeEditorialPhase, type EditorialPhase } from "../../../../../modules/publishing/editorialPhase";

export default async function EditorialPage() {
  const session = await getCurrentStudioSession();
  if (!session) redirect("/studio/signin");

  const recordings = await listRecordingsForStudio();

  const withPhase = await Promise.all(
    recordings.map(async (recording) => {
      const openRevisionId = recording.currentDraftRevisionId;
      const completeness = openRevisionId ? await getRecordingRevisionCompletenessReport(openRevisionId) : null;
      const phase = computeEditorialPhase({
        aggregateStatus: recording.status,
        hasPublishedRevision: recording.currentPublishedRevisionId !== null,
        draftReadiness: completeness?.readiness ?? null,
        draftHasAnyContent: completeness?.report.some((item) => item.status === "COMPLETE") ?? false,
        hasOpenDraft: recording.currentDraftRevisionId !== null,
      });
      return { recording, phase };
    })
  );

  const byPhase = new Map<EditorialPhase, typeof withPhase>();
  for (const entry of withPhase) {
    const bucket = byPhase.get(entry.phase) ?? [];
    bucket.push(entry);
    byPhase.set(entry.phase, bucket);
  }

  const phaseOrder: EditorialPhase[] = [
    "DRAFT",
    "ENRICHMENT",
    "EDITORIAL_REVIEW",
    "APPROVED",
    "UPDATED",
    "PUBLISHED",
    "ARCHIVED",
  ];

  return (
    <div>
      <h1>Editorial</h1>
      <p>Every recording, grouped by where it stands in the editorial workflow.</p>
      {phaseOrder.map((phase) => {
        const entries = byPhase.get(phase) ?? [];
        if (entries.length === 0) return null;
        return (
          <section key={phase}>
            <h2>
              {phase} ({entries.length})
            </h2>
            <ul>
              {entries.map(({ recording }) => (
                <li key={recording.id}>
                  <Link href={`/studio/recordings/${recording.id}/review`}>
                    {recording.currentDraftRevision?.title ?? recording.currentPublishedRevision?.title ?? recording.slug}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      {recordings.length === 0 && <p>No recordings yet.</p>}
    </div>
  );
}
