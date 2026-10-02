import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../../modules/auth/authService";
import { can } from "../../../../../../../modules/auth/policy";
import { findConductorById } from "../../../../../../../modules/db/repositories/conductorRepository";
import { getConductorRelatedContent } from "../../../../../../../modules/db/repositories/entityRelationshipsRepository";
import { archiveConductorAction, restoreConductorAction, updateConductorAction } from "./actions";

// Phase 6G-4F — the Conductor editorial management view, mirroring the
// Artist/Choir detail pages' shape. No public /conductors/[slug] route
// exists yet.

export default async function ConductorDetailPage({
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

  const conductor = await findConductorById(id);
  if (!conductor) {
    notFound();
  }

  const canWrite = can(session.user.role, "CATALOGUE_WRITE");
  const related = await getConductorRelatedContent(conductor.id);

  return (
    <div>
      <p>
        <Link href="/studio/catalogue/conductors">← Conductors</Link>
      </p>
      <h1>{conductor.name}</h1>
      {error && <p style={{ color: "#b00020" }}>{decodeURIComponent(error)}</p>}

      <p>
        Status: <strong>{conductor.archivedAt ? "Archived" : "Active"}</strong>
      </p>

      <h2>Edit</h2>
      {canWrite ? (
        <form
          action={updateConductorAction.bind(null, conductor.id)}
          style={{ display: "flex", flexDirection: "column", gap: "0.5rem", maxWidth: "24rem" }}
        >
          <label>
            Name
            <input name="name" required defaultValue={conductor.name} style={{ display: "block", width: "100%" }} />
          </label>
          <label>
            Biography
            <textarea name="biography" defaultValue={conductor.biography ?? ""} style={{ display: "block", width: "100%" }} />
          </label>
          <button type="submit">Save</button>
        </form>
      ) : (
        <p>You do not have permission to edit this conductor.</p>
      )}

      {canWrite && (
        <div style={{ marginTop: "1rem" }}>
          {!conductor.archivedAt ? (
            <form action={archiveConductorAction.bind(null, conductor.id)}>
              <button type="submit">Archive</button>
            </form>
          ) : (
            <form action={restoreConductorAction.bind(null, conductor.id)}>
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
