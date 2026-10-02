import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../../modules/auth/authService";
import { can } from "../../../../../../../modules/auth/policy";
import { findChoirById } from "../../../../../../../modules/db/repositories/choirRepository";
import { getChoirRelatedContent } from "../../../../../../../modules/db/repositories/entityRelationshipsRepository";
import { archiveChoirAction, restoreChoirAction, updateChoirAction } from "./actions";

// Phase 6G-4F — the Choir editorial management view, mirroring the
// Artist detail page's shape. No public /choirs/[slug] route exists yet.

export default async function ChoirDetailPage({
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

  const choir = await findChoirById(id);
  if (!choir) {
    notFound();
  }

  const canWrite = can(session.user.role, "CATALOGUE_WRITE");
  const related = await getChoirRelatedContent(choir.id);

  return (
    <div>
      <p>
        <Link href="/studio/catalogue/choirs">← Choirs</Link>
      </p>
      <h1>{choir.name}</h1>
      {error && <p style={{ color: "#b00020" }}>{decodeURIComponent(error)}</p>}

      <p>
        Status: <strong>{choir.archivedAt ? "Archived" : "Active"}</strong>
      </p>

      <h2>Edit</h2>
      {canWrite ? (
        <form
          action={updateChoirAction.bind(null, choir.id)}
          style={{ display: "flex", flexDirection: "column", gap: "0.5rem", maxWidth: "24rem" }}
        >
          <label>
            Name
            <input name="name" required defaultValue={choir.name} style={{ display: "block", width: "100%" }} />
          </label>
          <label>
            Director
            <input name="directorName" defaultValue={choir.directorName ?? ""} style={{ display: "block", width: "100%" }} />
          </label>
          <label>
            Description
            <textarea name="description" defaultValue={choir.description ?? ""} style={{ display: "block", width: "100%" }} />
          </label>
          <button type="submit">Save</button>
        </form>
      ) : (
        <p>You do not have permission to edit this choir.</p>
      )}

      {canWrite && (
        <div style={{ marginTop: "1rem" }}>
          {!choir.archivedAt ? (
            <form action={archiveChoirAction.bind(null, choir.id)}>
              <button type="submit">Archive</button>
            </form>
          ) : (
            <form action={restoreChoirAction.bind(null, choir.id)}>
              <button type="submit">Restore</button>
            </form>
          )}
        </div>
      )}

      <h2>Relationships</h2>
      <p>
        <strong>Performances ({related.performances.length})</strong>
      </p>
      {related.performances.length > 0 ? (
        <ul>
          {related.performances.map((performance) => (
            <li key={performance.id}>
              {performance.performanceDate ? new Date(performance.performanceDate).toLocaleDateString() : "Date unknown"} —{" "}
              {performance.venue.name}
            </li>
          ))}
        </ul>
      ) : (
        <p>No performances linked yet.</p>
      )}

      <p>
        <strong>Recordings ({related.recordings.length})</strong>
      </p>
      {related.recordings.length > 0 ? (
        <ul>
          {related.recordings.map((recording) => (
            <li key={recording.id}>{recording.currentPublishedRevision.title ?? "Untitled recording"}</li>
          ))}
        </ul>
      ) : (
        <p>No published recordings yet.</p>
      )}

      <p>
        <strong>Public Music Madras Videos ({related.videos.length})</strong>
      </p>
      {related.videos.length > 0 ? (
        <ul>
          {related.videos.map((video) => (
            <li key={video.id}>
              <Link href={`/videos/${video.page.slug}`} target="_blank" rel="noopener noreferrer">
                {video.youtubeVideo.title ?? "Untitled video"}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p>No publicly visible videos yet.</p>
      )}
    </div>
  );
}
