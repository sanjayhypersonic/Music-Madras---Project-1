import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../modules/auth/authService";
import { listYouTubeVideosForStudioCatalogue } from "../../../../../../modules/db/repositories/youtubeVideoRepository";
import { listRecordingLinksForYouTubeVideos } from "../../../../../../modules/db/repositories/recordingIntakeRepository";
import { deriveCataloguePageState } from "../../../../../../modules/mmke/catalogue/deriveCataloguePageState";

// Phase 6G-1C — the YouTube Video Catalogue list (brief "STUDIO ROUTE 1").
// This is an internal Studio view: it intentionally does NOT apply the
// public Museum visibility gate (isYouTubeVideoPagePublic) — unlisted and
// otherwise non-public videos are shown here on purpose, since an editor
// needs to see every synchronized video to decide which ones deserve a
// Music Madras catalogue page. Read-only with respect to YouTube-owned
// data: nothing on this page writes to YouTubeVideo.

export default async function YouTubeVideoCataloguePage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const session = await getCurrentStudioSession();
  if (!session) redirect("/studio/signin");
  const { q } = await searchParams;

  const videos = await listYouTubeVideosForStudioCatalogue(q);
  // Phase 6I-1 — one batched lookup: which of these videos already back a Recording.
  const recordingLinks = await listRecordingLinksForYouTubeVideos(videos.map((video) => video.id));

  return (
    <div>
      <h1>YouTube Video Catalogue</h1>
      <p>
        Every video synchronized from the Music Madras YouTube channel. Selecting a video lets you decide whether it
        receives its own Music Madras catalogue page, or becomes the primary video of a new draft Recording — nothing here is
        public until you explicitly publish it.
      </p>
      <form method="get" style={{ margin: "1rem 0" }}>
        <label>
          Search by title or YouTube ID
          <input type="search" name="q" defaultValue={q ?? ""} style={{ display: "block", width: "100%", maxWidth: "24rem" }} />
        </label>
        <button type="submit" style={{ marginTop: "0.5rem" }}>
          Search
        </button>
        {q && (
          <Link href="/studio/catalogue/videos" style={{ marginLeft: "1rem" }}>
            Clear
          </Link>
        )}
      </form>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>
            <th>Thumbnail</th>
            <th>Title</th>
            <th>Published</th>
            <th>YouTube Status</th>
            <th>Availability</th>
            <th>Catalogue Page</th>
            <th>Recording</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {videos.map((video) => (
            <tr key={video.id} style={{ borderBottom: "1px solid #eee" }}>
              <td>
                {video.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- internal Studio table, not the public Museum
                  <img src={video.thumbnailUrl} alt="" width={96} />
                ) : (
                  "—"
                )}
              </td>
              <td>{video.title ?? "(untitled)"}</td>
              <td>{video.publishedAt ? new Date(video.publishedAt).toLocaleDateString() : "—"}</td>
              <td>{video.privacyStatus ?? "unknown"}</td>
              <td>{video.observabilityState}</td>
              <td>{deriveCataloguePageState(video.videoPage)}</td>
              <td>
                {recordingLinks.get(video.id) ? (
                  <Link href={`/studio/recordings/${recordingLinks.get(video.id)!.recordingId}/media`}>
                    {recordingLinks.get(video.id)!.status}
                  </Link>
                ) : (
                  "—"
                )}
              </td>
              <td>
                <Link href={`/studio/catalogue/videos/${video.id}`}>Manage</Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {videos.length === 0 && <p>{q ? `No videos match "${q}".` : "No YouTube videos have been synchronized yet."}</p>}
    </div>
  );
}
