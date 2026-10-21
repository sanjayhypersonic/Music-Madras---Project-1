import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../../modules/auth/authService";
import { can, describeRolesThatCan } from "../../../../../../../modules/auth/policy";
import { findYouTubeVideoById } from "../../../../../../../modules/db/repositories/youtubeVideoRepository";
import { findByYouTubeVideoId } from "../../../../../../../modules/db/repositories/youtubeVideoPageRepository";
import { listApprovalHistory } from "../../../../../../../modules/db/repositories/videoExposureRepository";
import { loadApprovalLifecycleStatus } from "../../../../../../../modules/db/repositories/videoLifecycleRepository";
import { loadMetadataReviewState } from "../../../../../../../modules/db/repositories/videoMetadataReviewRepository";
import { explainVideoExposure } from "../../../../../../../modules/mmke/catalogue/videoExposure";
import { APPROVAL_STATUS_TEXT } from "../../../../../../../modules/mmke/catalogue/videoLifecycle";
import { canPublishVideoPage, canUnpublishVideoPage } from "../../../../../../../modules/publishing/videoPageTransitions";
import { getVideoHold } from "../../../../../../../modules/db/repositories/unlistedReviewRepository";
import { deriveCataloguePageState } from "../../../../../../../modules/mmke/catalogue/deriveCataloguePageState";
import { findRecordingLinkedToYouTubeVideo } from "../../../../../../../modules/db/repositories/recordingIntakeRepository";
import { ConfirmSubmitButton } from "../../../../../../../components/studio/ConfirmSubmitButton";
import {
  acknowledgeVideoMetadataAction,
  approveDiscoveryAction,
  approveUnlistedPublicationAction,
  archiveVideoPageAction,
  clearVideoHoldAction,
  createCataloguePageAction,
  createRecordingFromVideoAction,
  publishVideoPageAction,
  revokeDiscoveryAction,
  revokeUnlistedApprovalAction,
  setVideoHoldAction,
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
  const canPublish = can(session.user.role, "RECORDING_PUBLISH");
  const canCreateRecording = can(session.user.role, "RECORDING_WRITE");
  const durationLabel =
    video.durationSeconds === null
      ? "—"
      : `${Math.floor(video.durationSeconds / 60)}:${String(video.durationSeconds % 60).padStart(2, "0")}`;
  const approvals = page ? await listApprovalHistory(page.id) : [];
  const activeApprovals = approvals.filter((a) => !a.revokedAt);
  const hasActiveDiscovery = activeApprovals.some((a) => a.scope === "DISCOVERY");
  const hold = await getVideoHold(videoId);
  const lifecycle = page ? await loadApprovalLifecycleStatus(page.id) : null;
  const metadataState = page ? await loadMetadataReviewState(page.id) : null;
  const exposure = page
    ? explainVideoExposure({
        page: { status: page.status, archivedAt: page.archivedAt, unlistedPublicationApprovedAt: page.unlistedPublicationApprovedAt },
        youtubeVideo: { privacyStatus: video.privacyStatus, observabilityState: video.observabilityState },
        activeApprovals: activeApprovals.map((a) => ({ scope: a.scope, playlistPageId: a.playlistPageId })),
        hold: hold?.holdReason ?? null,
      })
    : [];
  // "Public" is the shared rule's verdict for the page surface (it includes holds), never a second predicate.
  const isPublic = exposure.find((line) => line.surface === "PAGE")?.allowed ?? false;
  const isUnlisted = video.privacyStatus === "unlisted";
  const isApprovedUnlisted = Boolean(page?.unlistedPublicationApprovedAt);
  // What clearing a hold does depends on the video: it never approves anything, so an unlisted video needs a fresh approval, while a PUBLIC video needs
  // none and is visible again at once if its page is published.
  const clearHoldConfirm =
    video.privacyStatus === "public"
      ? "Clear this hold? Nothing is approved by clearing it. This video is public on YouTube, so it needs no approval: if its catalogue page is published it will be visible on the public Museum again immediately."
      : video.privacyStatus === "unlisted"
        ? "Clear this hold? Nothing is approved by clearing it: earlier approvals stay revoked, and this unlisted video stays off the public Museum until someone approves it afresh."
        : "Clear this hold? Nothing is approved by clearing it. Whether the video appears on the public Museum afterwards follows its YouTube visibility and its page, as for any other video.";
  const publishers = describeRolesThatCan("RECORDING_PUBLISH");

  return (
    <div>
      <p>
        <Link href="/studio/catalogue/videos">← YouTube Video Catalogue</Link>
      </p>
      <h1>{video.title ?? "(untitled video)"}</h1>
      {error && <p role="alert" className="studio-alert studio-alert--error">{decodeURIComponent(error)}</p>}

      {video.thumbnailUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- internal Studio page, not the public Museum
        <img src={video.thumbnailUrl} alt="" width={320} />
      )}

      <section className="studio-panel" style={{ display: "flex", flexWrap: "wrap", gap: "1rem 3rem" }}>
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

      <section className="studio-panel">
        <h3>Canonical Recording</h3>
        <p style={{ fontSize: "0.9rem", color: "var(--mm-text-muted)" }}>
          YouTube ID: <code>{video.youtubeVideoId}</code> · Published:{" "}
          {video.publishedAt ? new Date(video.publishedAt).toLocaleDateString() : "—"} · Duration: {durationLabel} · Visibility:{" "}
          {video.privacyStatus ?? "unknown"}
        </p>
        {linkedRecording ? (
          <p>
            This YouTube video is linked to Music Madras Recording{" "}
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
                <button type="submit" className="studio-button--primary">Create Recording from this YouTube Video</button>
              </form>
            </>
          ) : (
            <p>This video is not currently available in the synchronized catalogue, so a Recording cannot be created from it.</p>
          )
        ) : (
          <p className="studio-empty">No Recording is linked to this video, and you do not have permission to create one.</p>
        )}
      </section>

      {!page && (
        <>
          {canWrite ? (
            <form action={createCataloguePageAction.bind(null, videoId)}>
              <button type="submit" className="studio-button--primary">Create Catalogue Page</button>
            </form>
          ) : (
            <p>You do not have permission to create a catalogue page for this video.</p>
          )}
        </>
      )}

      {page && (
        <>
          {isUnlisted && (
            <section className="studio-notice">
              <h3>Unlisted — {isApprovedUnlisted ? "approved for public Museum exposure" : "not approved for public Museum exposure"}</h3>
              <p>
                This video is unlisted on YouTube — requires approval for public Museum exposure. Publishing this catalogue
                page alone will never make it public; an editor must separately approve it below. Approving exposes the <em>Music Madras page</em>:
                it shows the video&apos;s embedded player and a link to its YouTube address, so anyone who can open the page can find the unlisted video.
                The video itself stays unlisted on YouTube.
              </p>
              {lifecycle && (
                <p role="status">
                  <strong>{APPROVAL_STATUS_TEXT[lifecycle.status].label}.</strong> {APPROVAL_STATUS_TEXT[lifecycle.status].detail}
                  {lifecycle.status === "APPROVED_METADATA_REVIEW_PENDING" && lifecycle.changedFields.length > 0 ? ` Changed: ${lifecycle.changedFields.join(", ")}.` : ""}
                </p>
              )}
              {canPublish &&
                (isApprovedUnlisted ? (
                  <form action={revokeUnlistedApprovalAction.bind(null, videoId, page.id)}>
                    <ConfirmSubmitButton confirmMessage="Revoke approval? This unlisted video will no longer be shown on the public Museum. Approving it again later needs a fresh, explicit approval." pendingLabel="Revoking…" tone="danger">
                      Revoke Public Museum Approval
                    </ConfirmSubmitButton>
                  </form>
                ) : (
                  <form action={approveUnlistedPublicationAction.bind(null, videoId, page.id)}>
                    <ConfirmSubmitButton confirmMessage="Approve this unlisted video's page for the public Museum? Anyone with the page link will be able to open it, and the page shows the video's embedded player and a link to its YouTube address, so the unlisted video can be found by anyone who opens the page. The video stays unlisted on YouTube. It will not be listed in the catalogue or on the homepage until you also approve listing." pendingLabel="Approving…" tone="primary">
                      Approve for Public Museum
                    </ConfirmSubmitButton>
                  </form>
                ))}
              {!canPublish && <p style={{ fontSize: "0.9rem", color: "var(--mm-text-muted)" }}>Only {publishers} can approve or revoke public exposure.</p>}
            </section>
          )}

          {metadataState && (metadataState.pending || metadataState.history.length > 0) && (
            <section className="studio-panel">
              <h3>Metadata review</h3>
              {metadataState.pending ? (
                <>
                  <p role="status">
                    <strong>{APPROVAL_STATUS_TEXT.APPROVED_METADATA_REVIEW_PENDING.label}.</strong> {APPROVAL_STATUS_TEXT.APPROVED_METADATA_REVIEW_PENDING.detail}
                  </p>
                  <ul style={{ fontSize: "0.9rem" }}>
                    {(Array.isArray(metadataState.pending.changeSummary) ? (metadataState.pending.changeSummary as Array<{ field: string; before: string | null; after: string | null }>) : []).map((c) => (
                      <li key={c.field}>
                        <strong>{c.field}</strong>: was “{c.before ?? "(none)"}” — now “{c.after ?? "(none)"}”
                      </li>
                    ))}
                  </ul>
                  {canPublish && (
                    <form action={acknowledgeVideoMetadataAction.bind(null, videoId, page.id)} style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                      <label>
                        Note (optional)
                        <input type="text" name="note" maxLength={1000} />
                      </label>
                      <ConfirmSubmitButton confirmMessage="Confirm that you have reviewed these changes? The page stays public either way; this records that the changed details were reviewed." pendingLabel="Recording…" tone="primary">
                        I have reviewed this change
                      </ConfirmSubmitButton>
                    </form>
                  )}
                </>
              ) : (
                <p style={{ fontSize: "0.9rem" }}>No metadata change is waiting for review.</p>
              )}
              {metadataState.history.length > 0 && (
                <>
                  <h4>History</h4>
                  <ul style={{ fontSize: "0.9rem" }}>
                    {metadataState.history.map(({ change, resolvedByName }) => (
                      <li key={change.id}>
                        {change.detectedAt.toLocaleString()}: {change.changedFields.join(", ")} — {change.status.toLowerCase()}
                        {change.resolvedAt ? ` on ${change.resolvedAt.toLocaleString()}${resolvedByName ? ` by ${resolvedByName}` : ""}` : ""}
                        {change.resolutionNote ? ` (${change.resolutionNote})` : ""}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>
          )}

          <section className="studio-panel">
            <h3>Public exposure</h3>
            <p style={{ fontSize: "0.9rem" }}>
              What visitors can reach, and why. YouTube visibility, the existence of a page, its publication and its listing are separate decisions; none implies another.
            </p>
            <ul>
              {exposure.map((line) => (
                <li key={line.surface}>
                  <strong>{line.surface === "PAGE" ? "Public page (reachable by its link)" : "Listed in the catalogue, sitemap, homepage, featured videos and related-video sections"}:</strong> {line.allowed ? "YES" : "NO"} - {line.reason}
                </li>
              ))}
            </ul>
            {isUnlisted && isApprovedUnlisted && canPublish && (
              hasActiveDiscovery ? (
                <form action={revokeDiscoveryAction.bind(null, videoId, page.id)}>
                  <ConfirmSubmitButton confirmMessage="Stop listing this video in the catalogue, search, sitemap and homepage? Its page stays reachable by link while the page approval stands." pendingLabel="Revoking..." tone="danger">
                    Revoke listing approval
                  </ConfirmSubmitButton>
                </form>
              ) : (
                <form action={approveDiscoveryAction.bind(null, videoId, page.id)}>
                  <ConfirmSubmitButton confirmMessage="List this unlisted video in the public catalogue, search, sitemap and homepage? Anyone browsing the Museum will find it." pendingLabel="Approving..." tone="primary">
                    Approve listing on the public Museum
                  </ConfirmSubmitButton>
                </form>
              )
            )}
            {approvals.length > 0 && (
              <>
                <h4>Approval history</h4>
                <ul style={{ fontSize: "0.9rem" }}>
                  {approvals.map((a) => (
                    <li key={a.id}>
                      {a.scope.toLowerCase()}{a.playlistPageId ? " (playlist)" : ""}: approved {a.approvedBy ? `by ${a.approvedBy.name}` : "(carried over from the old approval flag, which recorded no approver)"} on {a.approvedAt.toLocaleString()}
                      {a.revokedAt ? `; revoked${a.revokedBy ? ` by ${a.revokedBy.name}` : " by the platform"}${a.revokedReason ? ` (${a.revokedReason.toLowerCase().replace(/_/g, " ")})` : ""} on ${a.revokedAt.toLocaleString()}` : " - active"}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>

          <section className="studio-panel">
            <h3>Rights, copyright or privacy hold</h3>
            {hold?.holdReason ? (
              <>
                <p role="status">
                  <strong>Hold in place: {hold.holdReason.toLowerCase()}.</strong> {hold.holdNote ?? ""} While it stands this video is not shown anywhere on the public Museum, whatever else is approved.
                </p>
                {canPublish && (
                  <form action={clearVideoHoldAction.bind(null, videoId)}>
                    <ConfirmSubmitButton confirmMessage={clearHoldConfirm} pendingLabel="Clearing…" tone="primary">
                      Clear the hold
                    </ConfirmSubmitButton>
                  </form>
                )}
              </>
            ) : canPublish ? (
              <details>
                <summary>Record a hold (removes this video from the public Museum at once)</summary>
                <form action={setVideoHoldAction.bind(null, videoId)} style={{ display: "grid", gap: "0.5rem", maxWidth: "32rem", marginTop: "0.5rem" }}>
                  <label>
                    Kind of hold
                    <select name="hold" required defaultValue="">
                      <option value="" disabled>
                        Choose…
                      </option>
                      <option value="RIGHTS">Rights</option>
                      <option value="COPYRIGHT">Copyright</option>
                      <option value="PRIVACY">Privacy</option>
                      <option value="OTHER">Other</option>
                    </select>
                  </label>
                  <label>
                    Reason
                    <textarea name="note" rows={2} maxLength={2000} />
                  </label>
                  <ConfirmSubmitButton confirmMessage="Record this hold? The video disappears from the public Museum now, and any approval it had is revoked." pendingLabel="Recording…" tone="danger">
                    Record hold
                  </ConfirmSubmitButton>
                </form>
              </details>
            ) : (
              <p style={{ fontSize: "0.9rem", color: "var(--mm-text-muted)" }}>No hold is recorded. Only {publishers} can record or clear one.</p>
            )}
          </section>

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
              <button type="submit" className="studio-button--primary">Save editorial fields</button>
            </form>
          ) : (
            <p>You do not have permission to edit this catalogue page.</p>
          )}

          <h2>Music Madras Page Preview</h2>
          <p style={{ fontStyle: "italic" }}>
            This is an editorial preview of approximately how the Museum page will look once published — it is not the
            public page itself.
          </p>
          <div className="studio-panel" style={{ maxWidth: "32rem" }}>
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
              {canPublish && !page.archivedAt && canPublishVideoPage({ status: page.status, archivedAt: page.archivedAt }) && (
                <form action={publishVideoPageAction.bind(null, videoId, page.id)}>
                  <ConfirmSubmitButton confirmMessage="Publish this catalogue page? It will appear on the public Museum if the video itself is eligible." pendingLabel="Publishing…" tone="primary">
                    Publish
                  </ConfirmSubmitButton>
                </form>
              )}
              {canPublish && !page.archivedAt && canUnpublishVideoPage({ status: page.status, archivedAt: page.archivedAt }) && (
                <form action={unpublishVideoPageAction.bind(null, videoId, page.id)}>
                  <ConfirmSubmitButton confirmMessage="Unpublish this catalogue page? It will disappear from the public Museum." pendingLabel="Unpublishing…" tone="danger">
                    Unpublish
                  </ConfirmSubmitButton>
                </form>
              )}
              {!page.archivedAt && (
                <form action={archiveVideoPageAction.bind(null, videoId, page.id)}>
                  <ConfirmSubmitButton confirmMessage="Archive this catalogue page? It will be removed from the public Museum, and any approval to expose it ends. Restoring the page later does not bring an approval back: an unlisted video needs a fresh approval." pendingLabel="Archiving…" tone="danger">
                    Archive
                  </ConfirmSubmitButton>
                </form>
              )}
              {page.archivedAt && (
                <form action={unarchiveVideoPageAction.bind(null, videoId, page.id)}>
                  <ConfirmSubmitButton confirmMessage="Restore this catalogue page? It comes back as it was (published or draft), but no approval is restored: an unlisted video stays off the public Museum until someone approves it afresh." pendingLabel="Unarchiving…">Unarchive</ConfirmSubmitButton>
                </form>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
