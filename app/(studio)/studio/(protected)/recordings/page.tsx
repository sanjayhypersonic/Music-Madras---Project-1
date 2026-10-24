import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentStudioSession } from "../../../../../modules/auth/authService";
import { can } from "../../../../../modules/auth/policy";
import { createDraftRecording, listRecordingsForStudio } from "../../../../../modules/db/repositories/recordingRepository";
import { slugify } from "../../../../../modules/mmke/slug/slugify";
import { StatusBadge } from "../../../../../components/studio/StatusBadge";

export default async function RecordingsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const session = await getCurrentStudioSession();
  if (!session) redirect("/studio/signin");
  const { error } = await searchParams;

  const recordings = await listRecordingsForStudio();
  const canWrite = can(session.user.role, "RECORDING_WRITE");

  async function createDraftAction(formData: FormData) {
    "use server";
    const session = await getCurrentStudioSession();
    if (!session || !can(session.user.role, "RECORDING_WRITE")) {
      redirect("/studio/recordings?error=You+do+not+have+permission+to+create+recordings.");
    }

    const title = String(formData.get("title") ?? "").trim();
    if (!title) {
      redirect("/studio/recordings?error=Title+is+required.");
    }

    const slugBase = slugify(title);
    const slug = `${slugBase}-${Date.now().toString(36)}`;

    const recording = await createDraftRecording({ slug, title, actorId: session.user.id });
    redirect(`/studio/recordings/${recording.id}/source`);
  }

  return (
    <div>
      <h1>Recordings</h1>
      <p>
        <Link href="/studio/recordings/visibility">Public visibility →</Link> <span className="studio-muted">what visitors can find, what is published but not public, and why</span>
      </p>
      {error && <p role="alert" className="studio-alert studio-alert--error">{decodeURIComponent(error)}</p>}

      <div className="studio-table-scroll">
<table>
        <thead>
          <tr>
            <th style={{ textAlign: "left" }}>Title</th>
            <th style={{ textAlign: "left" }}>Status</th>
            <th style={{ textAlign: "left" }}>Updated</th>
          </tr>
        </thead>
        <tbody>
          {recordings.map((recording) => (
            <tr key={recording.id}>
              <td>
                <Link href={`/studio/recordings/${recording.id}/source`}>
                  {recording.currentDraftRevision?.title ??
                    recording.currentPublishedRevision?.title ??
                    recording.slug}
                </Link>
              </td>
              <td><StatusBadge status={recording.status} /></td>
              <td>{recording.updatedAt.toISOString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
</div>
      {recordings.length === 0 && <p className="studio-empty">No recordings yet.</p>}

      {canWrite && (
        <>
          <h2>Start a new recording</h2>
          <form action={createDraftAction} style={{ display: "flex", flexDirection: "column", gap: "0.5rem", maxWidth: "24rem" }}>
            <label>
              Working title
              <input name="title" required style={{ display: "block", width: "100%" }} />
            </label>
            <button type="submit" className="studio-button--primary">Create draft</button>
          </form>
        </>
      )}
    </div>
  );
}
