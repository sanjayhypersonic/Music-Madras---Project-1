import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../modules/auth/authService";
import { can } from "../../../../../../modules/auth/policy";
import { listPlaylistPagesForStudio, listYouTubePlaylistsWithoutPage } from "../../../../../../modules/db/repositories/playlistPageRepository";
import { createPlaylistPageAction } from "./actions";

// Phase 6K-4 — playlist pages: curated editorial pages about a themed set of videos. A page is a draft until it passes the publication checks
// and someone who may publish publishes it.

export default async function PlaylistPagesPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const session = await getCurrentStudioSession();
  if (!session || session.user.status !== "ACTIVE") redirect("/studio/signin");
  if (!can(session.user.role, "CATALOGUE_WRITE")) redirect("/studio/dashboard");
  const { error } = await searchParams;
  const [rows, sources] = await Promise.all([listPlaylistPagesForStudio(), listYouTubePlaylistsWithoutPage()]);

  return (
    <div>
      <h1>Playlist pages</h1>
      <p>
        A playlist page is a curated, written page about a themed set of videos. Its videos are chosen here — being in a YouTube playlist does not put a video on a page. A
        page is published only when it passes the publication checks (see <Link href="/studio/settings/site">settings</Link>).
      </p>
      {error && (
        <p role="alert" className="studio-alert studio-alert--error">
          {error}
        </p>
      )}

      {rows.length === 0 ? (
        <p className="studio-empty">No playlist pages yet.</p>
      ) : (
        <ul>
          {rows.map((row) => (
            <li key={row.id}>
              <Link href={`/studio/catalogue/playlists/${row.id}`}>{row.title}</Link> — {row.archived ? "archived" : row.status === "PUBLISHED" ? (row.publishedVersion === row.version ? "published" : "published, with unpublished changes") : "draft"} · {row.memberCount}{" "}
              {row.memberCount === 1 ? "video" : "videos"}
            </li>
          ))}
        </ul>
      )}

      <h2>Start a playlist page</h2>
      <form action={createPlaylistPageAction} style={{ display: "grid", gap: "0.5rem", maxWidth: "36rem" }}>
        <label>
          Title
          <input name="title" required maxLength={160} />
        </label>
        {sources.length > 0 && (
          <>
            <label>
              Start from a YouTube playlist (optional)
              <select name="youtubePlaylistId" defaultValue="">
                <option value="">None — start empty</option>
                {sources.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title ?? "(untitled playlist)"} ({s.itemCount} videos)
                  </option>
                ))}
              </select>
            </label>
            <label>
              <input type="checkbox" name="seedMembers" /> Copy over the videos that already have a Music Madras page (you can change the selection afterwards)
            </label>
          </>
        )}
        <button type="submit" className="studio-button--primary">
          Create draft
        </button>
      </form>
    </div>
  );
}
