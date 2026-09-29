import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../../modules/auth/authService";
import { can } from "../../../../../../../modules/auth/policy";
import { findLearningGuideDetailForStudio } from "../../../../../../../modules/db/repositories/learningGuideRepository";
import { listMusicalWorksForStudio } from "../../../../../../../modules/db/repositories/musicalWorkRepository";
import { listRecordingsForStudio } from "../../../../../../../modules/db/repositories/recordingRepository";
import EntityActivity from "../../../../../../../components/studio/EntityActivity";
import {
  archiveLearningGuideAction,
  attachRecordingAction,
  attachWorkAction,
  detachRecordingAction,
  detachWorkAction,
  restoreLearningGuideAction,
  updateLearningGuideAction,
} from "./actions";

// Phase 6G-16 — the Learning Guide editorial management view, mirroring
// the established Composer/Collection detail-page pattern: plain-edit
// fields, archive/restore, and canonical-entity attach/detach pickers
// (Work, Recording) using upsert-based no-op-on-duplicate semantics.

function recordingTitle(recording: {
  slug: string;
  currentPublishedRevision: { title: string | null } | null;
  currentDraftRevision: { title: string | null } | null;
}): string {
  return recording.currentPublishedRevision?.title ?? recording.currentDraftRevision?.title ?? recording.slug;
}

export default async function LearningGuideDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await getCurrentStudioSession();
  if (!session) redirect("/studio/signin");

  const { id } = await params;
  const { error } = await searchParams;

  const guide = await findLearningGuideDetailForStudio(id);
  if (!guide) {
    notFound();
  }

  const canWrite = can(session.user.role, "CATALOGUE_WRITE");

  const [allWorks, allRecordings] = await Promise.all([listMusicalWorksForStudio(), listRecordingsForStudio()]);
  const attachedWorkIds = new Set(guide.workLinks.map((link) => link.musicalWorkId));
  const attachedRecordingIds = new Set(guide.recordingLinks.map((link) => link.recordingId));
  const pickableWorks = allWorks.filter((work) => !work.archivedAt && !attachedWorkIds.has(work.id));
  const pickableRecordings = allRecordings.filter((recording) => recording.status !== "ARCHIVED" && !attachedRecordingIds.has(recording.id));

  return (
    <div>
      <p>
        <Link href="/studio/catalogue/learning-guides">← Learning Guides</Link>
      </p>
      <h1>{guide.title}</h1>
      {error && <p style={{ color: "#b00020" }}>{decodeURIComponent(error)}</p>}

      <p>
        Status: <strong>{guide.archivedAt ? "Archived" : "Active"}</strong>
        <br />
        Slug: <code>{guide.slug}</code> (not publicly routed in this phase)
      </p>

      <h2>Edit</h2>
      {canWrite ? (
        <form
          action={updateLearningGuideAction.bind(null, guide.id)}
          style={{ display: "flex", flexDirection: "column", gap: "0.5rem", maxWidth: "32rem" }}
        >
          <label>
            Title
            <input name="title" required defaultValue={guide.title} style={{ display: "block", width: "100%" }} />
          </label>
          <label>
            Difficulty level (free text)
            <input name="difficultyLevel" defaultValue={guide.difficultyLevel ?? ""} style={{ display: "block", width: "100%" }} />
          </label>
          <label>
            Estimated reading time (minutes)
            <input
              name="estimatedReadingTimeMinutes"
              type="number"
              min="0"
              defaultValue={guide.estimatedReadingTimeMinutes ?? ""}
              style={{ display: "block", width: "100%" }}
            />
          </label>
          <label>
            Content (Markdown)
            <textarea name="contentMarkdown" rows={10} defaultValue={guide.contentMarkdown ?? ""} style={{ display: "block", width: "100%" }} />
          </label>
          <button type="submit">Save</button>
        </form>
      ) : (
        <p>You do not have permission to edit this learning guide.</p>
      )}

      {canWrite && (
        <div style={{ marginTop: "1rem" }}>
          {!guide.archivedAt ? (
            <form action={archiveLearningGuideAction.bind(null, guide.id)}>
              <button type="submit">Archive</button>
            </form>
          ) : (
            <form action={restoreLearningGuideAction.bind(null, guide.id)}>
              <button type="submit">Restore</button>
            </form>
          )}
        </div>
      )}

      <h2>Musical Works ({guide.workLinks.length})</h2>
      {guide.workLinks.length === 0 ? (
        <p>No musical works have been attached to this learning guide yet.</p>
      ) : (
        <ul>
          {guide.workLinks.map((link) => (
            <li key={link.musicalWorkId}>
              <Link href={`/studio/catalogue/works/${link.musicalWorkId}`}>{link.musicalWork.title}</Link>
              {link.musicalWork.archivedAt ? " (archived)" : ""}
              {canWrite && (
                <form action={detachWorkAction.bind(null, guide.id, link.musicalWorkId)} style={{ display: "inline" }}>
                  <button type="submit">Remove</button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
      {canWrite && pickableWorks.length > 0 && (
        <form action={attachWorkAction.bind(null, guide.id)} style={{ display: "flex", gap: "0.5rem", maxWidth: "28rem" }}>
          <select name="musicalWorkId" required style={{ flex: 1 }}>
            {pickableWorks.map((work) => (
              <option key={work.id} value={work.id}>
                {work.title} — {work.composer.name}
              </option>
            ))}
          </select>
          <button type="submit">Attach work</button>
        </form>
      )}

      <h2>Recordings ({guide.recordingLinks.length})</h2>
      {guide.recordingLinks.length === 0 ? (
        <p>No recordings have been attached to this learning guide yet.</p>
      ) : (
        <ul>
          {guide.recordingLinks.map((link) => (
            <li key={link.recordingId}>
              {recordingTitle(link.recording)}
              {canWrite && (
                <form action={detachRecordingAction.bind(null, guide.id, link.recordingId)} style={{ display: "inline" }}>
                  <button type="submit">Remove</button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
      {canWrite && pickableRecordings.length > 0 && (
        <form action={attachRecordingAction.bind(null, guide.id)} style={{ display: "flex", gap: "0.5rem", maxWidth: "28rem" }}>
          <select name="recordingId" required style={{ flex: 1 }}>
            {pickableRecordings.map((recording) => (
              <option key={recording.id} value={recording.id}>
                {recordingTitle(recording)}
              </option>
            ))}
          </select>
          <button type="submit">Attach recording</button>
        </form>
      )}

      <EntityActivity entityType="LearningGuide" entityId={guide.id} role={session.user.role} />
    </div>
  );
}
