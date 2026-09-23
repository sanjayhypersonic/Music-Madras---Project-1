import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../../modules/auth/authService";
import { can } from "../../../../../../../modules/auth/policy";
import { findArtistById } from "../../../../../../../modules/db/repositories/artistRepository";
import { getArtistRelatedContent } from "../../../../../../../modules/db/repositories/entityRelationshipsRepository";
import { archiveArtistAction, restoreArtistAction, updateArtistAction } from "./actions";

// Phase 6G-4F — the Artist editorial management view, mirroring the
// Venue/Organisation detail pages' shape. No public /artists/[slug]
// route exists yet (explicitly out of scope this phase) and Artist has
// no slug field at all today, so there is no "View public page" link.

export default async function ArtistDetailPage({
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

  const artist = await findArtistById(id);
  if (!artist) {
    notFound();
  }

  const canWrite = can(session.user.role, "CATALOGUE_WRITE");
  const related = await getArtistRelatedContent(artist.id);

  return (
    <div>
      <p>
        <Link href="/studio/catalogue/artists">← Artists</Link>
      </p>
      <h1>{artist.name}</h1>
      {error && <p style={{ color: "#b00020" }}>{decodeURIComponent(error)}</p>}

      <p>
        Status: <strong>{artist.archivedAt ? "Archived" : "Active"}</strong>
      </p>

      <h2>Edit</h2>
      {canWrite ? (
        <form
          action={updateArtistAction.bind(null, artist.id)}
          style={{ display: "flex", flexDirection: "column", gap: "0.5rem", maxWidth: "24rem" }}
        >
          <label>
            Name
            <input name="name" required defaultValue={artist.name} style={{ display: "block", width: "100%" }} />
          </label>
          <label>
            Instrument
            <input name="instrument" defaultValue={artist.instrument ?? ""} style={{ display: "block", width: "100%" }} />
          </label>
          <label>
            Biography
            <textarea name="biography" defaultValue={artist.biography ?? ""} style={{ display: "block", width: "100%" }} />
          </label>
          <button type="submit">Save</button>
        </form>
      ) : (
        <p>You do not have permission to edit this artist.</p>
      )}

      {canWrite && (
        <div style={{ marginTop: "1rem" }}>
          {!artist.archivedAt ? (
            <form action={archiveArtistAction.bind(null, artist.id)}>
              <button type="submit">Archive</button>
            </form>
          ) : (
            <form action={restoreArtistAction.bind(null, artist.id)}>
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
        <strong>Public MusicMadras Videos ({related.videos.length})</strong>
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
