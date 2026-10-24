import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentStudioSession } from "../../../../../../modules/auth/authService";
import { loadRecordingVisibilityWorkspace, type RecordingVisibilityWorkspace } from "../../../../../../modules/db/repositories/recordingVisibilityRepository";
import { parseVisibilityView } from "../../../../../../modules/mmke/recordingVisibility/recordingVisibility";
import { RecordingVisibility } from "../../../../../../components/studio/RecordingVisibility";

// The Recording public-visibility workspace: which recordings visitors can find, which are published but not public, and why. READ-ONLY — it loads and
// shows; it creates no draft and changes nothing, and it has no action of its own (every link opens an existing Studio record). Like the Recordings list it
// is open to any signed-in Studio user, and the session is checked on the server BEFORE anything is loaded.

export default async function RecordingVisibilityPage({ searchParams }: { searchParams: Promise<{ view?: string; page?: string }> }) {
  const session = await getCurrentStudioSession();
  if (!session) redirect("/studio/signin");
  const { view, page } = await searchParams;

  let workspace: RecordingVisibilityWorkspace | null = null;
  try {
    workspace = await loadRecordingVisibilityWorkspace({ view: parseVisibilityView(view), page: Number(page) });
  } catch (err) {
    // Never show the database's own message.
    console.error("Recording visibility workspace could not be loaded:", err instanceof Error ? err.name : "unknown error");
  }

  return (
    <div>
      <p>
        <Link href="/studio/recordings">← Recordings</Link>
      </p>
      <h1>Recording public visibility</h1>
      <p className="studio-muted">What visitors can find on the public Museum, what is published but not public, and the reason for each. Read-only.</p>
      {workspace ? <RecordingVisibility workspace={workspace} /> : <p role="alert" className="studio-alert studio-alert--error">The visibility of recordings could not be loaded just now. Try again in a moment.</p>}
    </div>
  );
}
