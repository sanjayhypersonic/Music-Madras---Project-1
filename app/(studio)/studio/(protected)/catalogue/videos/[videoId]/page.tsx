import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../../modules/auth/authService";
import { can } from "../../../../../../../modules/auth/policy";
import { findYouTubeVideoById } from "../../../../../../../modules/db/repositories/youtubeVideoRepository";
import { findByYouTubeVideoId } from "../../../../../../../modules/db/repositories/youtubeVideoPageRepository";
import { canPublishVideoPage, canUnpublishVideoPage } from "../../../../../../../modules/publishing/videoPageTransitions";
import { isYouTubeVideoPagePublic } from "../../../../../../../modules/mmke/catalogue/isYouTubeVideoPagePublic";
import { deriveCataloguePageState } from "../../../../../../../modules/mmke/catalogue/deriveCataloguePageState";
import { findRecordingLinkedToYouTubeVideo } from "../../../../../../../modules/db/repositories/recordingIntakeRepository";
import {
  approveUnlistedPublicationAction,
  archiveVideoPageAction,
  createCataloguePageAction,
  createRecordingFromVideoAction,
  publishVideoPageAction,
  revokeUnlistedApprovalAction,
  unarchiveVideoPageAction,
  unpublishVideoPageAction,
  updateEditorialFieldsAction,
} from "./actions";

// Phase 6G-1C — the per-video Studio manage page (brief "STUDIO ROUTE 2").
// Extended Phase 6G-2A with the explicit Unlisted-approval control.
// Deliberately shows YouTube's own state and Music Madras's editorial
// state as two separate sections, never implying that a PUBLISHED
// catalogue page means the video is publicly visible — that always comes
// from isYouTubeVideoPagePublic, never duplicated here. This page never
// writes to YouTubeVideo.

export default async function YouTubeVideoManagePage({
  params,
  searchParams,
}: {
  params: Promise<{ videoId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await getCurrentStudioSession();
  if (!session) redirect("/studio/signin");

  const { videoId } = await params;
  const { error } = await searchParams;

  const video = await findYouTubeVideoById(videoId);
  if (!video) {
    notFound();
  }

  const page = await findByYouTubeVideoId(videoId);
  const linkedRecording = await findRecordingLinkedToYouTubeVideo(videoId);
  const canWrite = can(session.user.role, "CATALOGUE_WRITE");
  const canCreateRecording = can(session.user.role, "RECORDING_WRITE");
  const durationLabel =
    video.durationSeconds === null
      ? "—"
      : `${Math.floor(video.durationSeconds / 60)}:${String(video.durationSeconds % 60).padStart(2, "0")}`;
  const isPublic = page
    ? isYouTubeVideoPagePublic({
        page: { status: page.status, archivedAt: page.archivedAt, unlistedPublicationApprovedAt: page.unlistedPublicationApprovedAt },
        youtubeVideo: { privacyStatus: video.privacyStatus, observabilityState: video.observabilityState },
      })
    : false;
  const isUnlisted = video.privacyStatus === "unlisted";
  const isApprovedUnlisted = Boolean(page?.unlistedPublicationApprovedAt);

  return (
    <div>
      <p>
        <Link href="/studio/catalogue/videos">← YouTube Video Catalogue</Link>
      </p>
      <h1>{video.title ?? "(untitled video)"}</h1>
      {error && <p style={{ color: "#b00020" }}>{decodeURIComponent(error)}</p>}

      {video.thumbnailUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- internal Studio page, not the public Museum
        <img src={video.thumbnailUrl} alt="" width={320} />
      )}

      <section style={{ display: "flex", gap: "3rem", margin: "1.5rem 0", padding: "1rem", border: "1px solid #ccc" }}>
        <div>
          <h3>YouTube</h3>
          <p>
            Status: <strong>{video.privacyStatus ?? "unknown"}</strong>
            <br />
            Availability: <strong>{video.observabilityState}</strong>
          </p>
        </div>
        <div>
          <h3>Music Madras</h3>
          {page ? (
            <p>
              Catalogue Page: <strong>{deriveCataloguePageState(page)}</strong>
              <br />
              Public: <strong>{isPublic ? "YES" : "NO"}</strong>
              <br />
              URL: <code>/videos/{page.slug}</code>
            </p>
          ) : (
            <p>
              Catalogue Page: <strong>No Page</strong>
            </p>
          )}
        </div>
      </section>

      <section style={{ margin: "1.5rem 0", padding: "1rem", border: "1px solid #ccc" }}>
        <h3>Canonical Recording</h3>
        <p style={{ fontSize: "0.9rem", color: "#666" }}>
          YouTube ID: <code>{video.youtubeVideoId}</code> · Published:{" "}
          {video.publishedAt ? new Date(video.publishedAt).toLocaleDateString() : "—"} · Duration: {durationLabel} · Visibility:{" "}
          {video.privacyStatus ?? "unknown"}
        </p>
        {linkedRecording ? (
          <p>
            This YouTube video is linked to MusicMadras Recording{" "}
            <Link href={`/studio/recordings/${linkedRecording.recordingId}/media`}>{linkedRecording.title ?? linkedRecording.slug}</Link> (
            {linkedRecording.status}).
          </p>
        ) : canCreateRecording ? (
          video.observabilityState === "OBSERVED" ? (
            <>
              <p style={{ fontSize: "0.9rem" }}>
                Creates a <strong>draft</strong> Recording whose primary video is this YouTube video. The YouTube title becomes an editable
                working title only — no composer, work, programme, performance, venue or participant is created or guessed, nothing is
                generated, and nothing becomes public.
              </p>
              <form action={createRecordingFromVideoAction.bind(null, videoId)}>
                <button type="submit">Create Recording from this YouTube Video</button>
              </form>
            </>
          ) : (
            <p>This video is not currently available in the synchronized catalogue, so a Recording cannot be created from it.</p>
          )
        ) : (
          <p>No Recording is linked to this video, and you do not have permission to create one.</p>
        )}
      </section>

      {!page && (
        <>
          {canWrite ? (
            <form action={createCataloguePageAction.bind(null, videoId)}>
              <button type="submit">Create Catalogue Page</button>
            </form>
          ) : (
            <p>You do not have permission to create a catalogue page for this video.</p>
          )}
        </>
      )}

      {page && (
        <>
          {isUnlisted && (
            <section style={{ margin: "1rem 0", padding: "1rem", border: "1px dashed #b8860b", background: "#fffaf0" }}>
              <h3>Unlisted — {isApprovedUnlisted ? "approved for public Museum exposure" : "not approved for public Museum exposure"}</h3>
              <p>
                This video is unlisted on YouTube — requires approval for public Museum exposure. Publishing this catalogue
                page alone will never make it public; an editor must separately approve it below.
              </p>
              {canWrite &&
                (isApprovedUnlisted ? (
                  <form action={revokeUnlistedApprovalAction.bind(null, videoId, page.id)}>
                    <button type="submit">Revoke Public Museum Approval</button>
                  </form>
                ) : (
                  <form action={approveUnlistedPublicationAction.bind(null, videoId, page.id)}>
                    <button type="submit">Approve for Public Museum</button>
                  </form>
                ))}
            </section>
          )}

          <h2>Editorial fields</h2>
          {canWrite ? (
            <form
              action={updateEditorialFieldsAction.bind(null, videoId, page.id)}
              style={{ display: "flex", flexDirection: "column", gap: "0.5rem", maxWidth: "32rem" }}
            >
              <label>
                Curator note
                <textarea name="curatorNote" defaultValue={page.curatorNote ?? ""} style={{ display: "block", width: "100%" }} />
              </label>
              <label>
                SEO meta title
                <input name="seoMetaTitle" defaultValue={page.seoMetaTitle ?? ""} style={{ display: "block", width: "100%" }} />
              </label>
              <label>
                SEO meta description
                <textarea
                  name="seoMetaDescription"
                  defaultValue={page.seoMetaDescription ?? ""}
                  style={{ display: "block", width: "100%" }}
                />
              </label>
              <button type="submit">Save editorial fields</button>
            </form>
          ) : (
            <p>You do not have permission to edit this catalogue page.</p>
          )}

          <h2>Music Madras Page Preview</h2>
          <p style={{ fontStyle: "italic" }}>
            This is an editorial preview of approximately how the Museum page will look once published — it is not the
            public page itself.
          </p>
          <div style={{ border: "1px solid #ccc", padding: "1rem", maxWidth: "32rem" }}>
            {video.thumbnailUrl && (
              // eslint-disable-next-line @next/next/no-img-element -- editorial preview, not the public Museum
              <img src={video.thumbnailUrl} alt="" width={320} />
            )}
            <h3>{video.title ?? "(untitled video)"}</h3>
            {page.curatorNote && <p>{page.curatorNote}</p>}
            <p style={{ whiteSpace: "pre-wrap" }}>{video.description}</p>
            <p>
              <small>Public URL: /videos/{page.slug}</small>
            </p>
          </div>

          {canWrite && (
            <div style={{ display: "flex", gap: "1rem", marginTop: "1.5rem" }}>
              {!page.archivedAt && canPublishVideoPage({ status: page.status, archivedAt: page.archivedAt }) && (
                <form action={publishVideoPageAction.bind(null, videoId, page.id)}>
                  <button type="submit">Publish</button>
                </form>
              )}
              {!page.archivedAt && canUnpublishVideoPage({ status: page.status, archivedAt: page.archivedAt }) && (
                <form action={unpublishVideoPageAction.bind(null, videoId, page.id)}>
                  <button type="submit">Unpublish</button>
                </form>
              )}
              {!page.archivedAt && (
                <form action={archiveVideoPageAction.bind(null, videoId, page.id)}>
                  <button type="submit">Archive</button>
                </form>
              )}
              {page.archivedAt && (
                <form action={unarchiveVideoPageAction.bind(null, videoId, page.id)}>
                  <button type="submit">Unarchive</button>
                </form>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
