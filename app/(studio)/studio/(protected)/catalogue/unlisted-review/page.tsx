import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../modules/auth/authService";
import { can, describeRolesThatCan } from "../../../../../../modules/auth/policy";
import { loadResolvedSettings } from "../../../../../../modules/db/repositories/siteSettingRepository";
import { listCarriedOverApprovals } from "../../../../../../modules/db/repositories/carriedOverApprovalsRepository";
import { listPendingMetadataReviews } from "../../../../../../modules/db/repositories/videoMetadataReviewRepository";
import { APPROVAL_STATUS_TEXT } from "../../../../../../modules/mmke/catalogue/videoLifecycle";
import { decisionLabel } from "../../../../../../modules/mmke/videoReview/decisionLabels";
import { listReviewDecisions, loadReviewQueue, runUnlistedReviewSweep, type QueueItem } from "../../../../../../modules/db/repositories/unlistedReviewRepository";
import type { ReviewClass } from "../../../../../../modules/mmke/videoReview/reviewQueue";
import { acknowledgeMetadataAction, clearHoldAction, confirmCarriedOverAction, decideReviewAction, setHoldAction, withdrawCarriedOverAction } from "./actions";

// Phase 6K-2 — the review queue for unlisted YouTube videos. Nothing here is public until a person with publishing permission approves it,
// each decision is recorded with who/when/why, and an item you have already decided on is not shown again as new unless it changes
// (or a deferral falls due). Approving a page and listing it publicly are separate decisions.

const CLASS_LABEL: Record<ReviewClass, string> = {
  NEW: "New",
  PENDING: "Waiting for a decision",
  CHANGED: "Changed since you last looked",
  DUE: "Deferred — now due",
  NEEDS_DECISION: "Approval ended — needs a fresh approval",
  ARCHIVED_PAGE: "Page archived — restore it before it can be approved",
  DEFERRED: "Deferred",
  INFO_REQUESTED: "Waiting for information",
  DECLINED: "Declined",
  APPROVED: "Approved",
};

function Decision({ item }: { item: QueueItem }) {
  return (
    <form action={decideReviewAction} style={{ display: "grid", gap: "0.5rem", maxWidth: "36rem", marginTop: "0.5rem" }}>
      <input type="hidden" name="videoId" value={item.videoId} />
      <input type="hidden" name="fingerprint" value={item.fingerprint} />
      <label>
        Decision
        <select name="decision" defaultValue="" required>
          <option value="" disabled>
            Choose…
          </option>
          {!item.holdReason && (
            <>
              <option value="APPROVE_PAGE">Approve the public page (not listed in the catalogue)</option>
              <option value="APPROVE_PAGE_AND_LISTING">Approve the page and list it publicly</option>
            </>
          )}
          <option value="REQUEST_INFO">Ask for more information{item.activeScopes.length ? " (withdraws the current approval until answered)" : ""}</option>
          <option value="DEFER">Decide later{item.activeScopes.length ? " (withdraws the current approval until then)" : ""}</option>
          <option value="DECLINE">Decline — keep it off the public site</option>
          {item.activeScopes.includes("PAGE") && <option value="REVOKE">Revoke — remove it from the public site</option>}
        </select>
      </label>
      {item.playlists.length > 0 && !item.holdReason && (
        <fieldset style={{ border: "1px solid var(--mm-border)", padding: "0.5rem 0.75rem" }}>
          <legend>If you approve, also approve it for these playlist pages</legend>
          {item.playlists.map((playlist) => (
            <label key={playlist.id} style={{ display: "block" }}>
              <input type="checkbox" name="playlist" value={playlist.id} defaultChecked={false} disabled={playlist.approved} /> {playlist.title}
              {playlist.approved ? " (already approved)" : ""}
            </label>
          ))}
        </fieldset>
      )}
      <label>
        Note (required when asking for information; kept in the history)
        <textarea name="note" rows={2} maxLength={2000} />
      </label>
      <label>
        Decide later until (optional; default comes from settings)
        <input type="date" name="until" />
      </label>
      <button type="submit">Record decision</button>
    </form>
  );
}

function Hold({ item }: { item: QueueItem }) {
  if (item.holdReason) {
    return (
      <form action={clearHoldAction} style={{ marginTop: "0.5rem" }}>
        <input type="hidden" name="videoId" value={item.videoId} />
        <p role="status">
          <strong>Hold in place: {item.holdReason.toLowerCase()}.</strong> {item.holdNote ?? ""} It cannot be approved while this is in place.
        </p>
        <p>Clearing the hold approves nothing. This video is unlisted, so it stays off the public site until someone approves it afresh.</p>
        <button type="submit">Clear the hold</button>
      </form>
    );
  }
  return (
    <details style={{ marginTop: "0.5rem" }}>
      <summary>Record a rights, copyright or privacy hold</summary>
      <form action={setHoldAction} style={{ display: "grid", gap: "0.5rem", maxWidth: "36rem", marginTop: "0.5rem" }}>
        <input type="hidden" name="videoId" value={item.videoId} />
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
        <button type="submit">Record hold (removes it from the public site now)</button>
      </form>
    </details>
  );
}

async function History({ videoId }: { videoId: string }) {
  const rows = await listReviewDecisions(videoId);
  if (rows.length === 0) return null;
  return (
    <details style={{ marginTop: "0.5rem" }}>
      <summary>Decision history ({rows.length})</summary>
      <ul>
        {rows.map((r) => (
          <li key={r.id}>
            {r.createdAt.toLocaleString()} — {r.actor.name}: {decisionLabel(r.kind)}
            {r.note ? ` — ${r.note}` : ""}
          </li>
        ))}
      </ul>
    </details>
  );
}

export default async function UnlistedReviewPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string; all?: string }> }) {
  const session = await getCurrentStudioSession();
  if (!session || session.user.status !== "ACTIVE") redirect("/studio/signin");
  if (!can(session.user.role, "CATALOGUE_WRITE")) redirect("/studio/dashboard");
  const canDecide = can(session.user.role, "RECORDING_PUBLISH");
  const { error, notice, all } = await searchParams;

  const settings = await loadResolvedSettings();
  const enabled = settings.get("unlistedReview.enabled");
  // A failed refresh (database hiccup, a clash with another refresh) must never take the page down: show what is recorded and say so.
  let refreshFailed = false;
  if (enabled) {
    try {
      await runUnlistedReviewSweep();
    } catch {
      refreshFailed = true;
    }
  }
  const queue = await loadReviewQueue();
  const carriedOver = await listCarriedOverApprovals();
  const pendingMetadata = await listPendingMetadataReviews();
  const awaiting = queue.filter((i) => i.awaitingDecision);
  const others = queue.filter((i) => !i.awaitingDecision);

  return (
    <div>
      <h1>Unlisted videos</h1>
      <p>
        These videos are <strong>unlisted</strong> on YouTube. None of them is public on Music Madras until a person approves it here, and approving the page and
        listing it in the public catalogue are separate decisions. Nothing you decide changes the video on YouTube — but an approved page shows the video&apos;s embedded player and a link to
        its YouTube address, so anyone who can open the page can find the unlisted video. An approval ends by itself if the video becomes private or its page is archived; a fresh approval is then needed.
      </p>
      {error && (
        <p role="alert" className="studio-alert studio-alert--error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {refreshFailed && <p role="status">The queue could not be refreshed just now, so this shows what was last recorded. Reload in a moment.</p>}
      {!enabled && (
        <p role="status">
          The unlisted-video review is switched off in <Link href="/studio/settings/site">settings</Link>, so this list is not being refreshed and no reminders are raised.
        </p>
      )}
      {!canDecide && <p role="status">You can see this queue, but deciding needs publishing permission ({describeRolesThatCan("RECORDING_PUBLISH")}).</p>}

      <h2>Awaiting a decision ({awaiting.length})</h2>
      {awaiting.length === 0 ? (
        <p className="studio-empty">Nothing is waiting for a decision.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0 }}>
          {awaiting.map((item) => (
            <li key={item.videoId} style={{ borderTop: "1px solid var(--mm-border)", padding: "0.75rem 0" }}>
              <p style={{ margin: 0 }}>
                <strong>{item.title ?? "(untitled video)"}</strong> — {CLASS_LABEL[item.class]}
              </p>
              <p style={{ margin: "0.25rem 0" }}>
                {item.viewCount !== null ? `${item.viewCount.toLocaleString()} views on YouTube · ` : ""}
                {item.page ? (
                  <>
                    Page exists ({item.page.status.toLowerCase()}) · <Link href={`/studio/catalogue/videos/${item.videoId}`}>open the page</Link>
                  </>
                ) : (
                  <>
                    No Music Madras page yet — <Link href={`/studio/catalogue/videos/${item.videoId}`}>create it first</Link>; approval is of a page.
                  </>
                )}
              </p>
              {item.infoRequest && <p style={{ margin: "0.25rem 0" }}>Information requested: {item.infoRequest}</p>}
              {item.lifecycle && (item.lifecycle.status === "AWAITING_FRESH_APPROVAL" || item.lifecycle.status === "REVOKED_BY_LIFECYCLE") && (
                <p style={{ margin: "0.25rem 0" }} role="status">
                  <strong>{APPROVAL_STATUS_TEXT[item.lifecycle.status].label}.</strong> {APPROVAL_STATUS_TEXT[item.lifecycle.status].detail}
                </p>
              )}
              {canDecide && <Decision item={item} />}
              {canDecide && <Hold item={item} />}
              <History videoId={item.videoId} />
            </li>
          ))}
        </ul>
      )}

      <h2>Approved videos whose metadata changed ({pendingMetadata.length})</h2>
      <p>
        An approved page stays public while an editor looks at a change to its video&apos;s title, description, thumbnail, length, date, player availability or channel. Confirming a change records that you
        reviewed it; it does not alter the video or the approval, and an approval that has ended (the video became private, or the page was archived) is not shown here.
      </p>
      {pendingMetadata.length === 0 ? (
        <p className="studio-empty">No approved video has changes waiting for review.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0 }}>
          {pendingMetadata.map((item) => (
            <li key={item.videoPageId} style={{ borderTop: "1px solid var(--mm-border)", padding: "0.5rem 0" }}>
              <p style={{ margin: 0 }}>
                <strong>{item.title ?? "(untitled video)"}</strong> — {APPROVAL_STATUS_TEXT.APPROVED_METADATA_REVIEW_PENDING.label}: {item.changedFields.join(", ")} changed (detected {item.detectedAt.toLocaleDateString()}) ·{" "}
                <Link href={`/studio/catalogue/videos/${item.videoId}`}>open the video</Link>
              </p>
              {canDecide && (
                <form action={acknowledgeMetadataAction} style={{ marginTop: "0.25rem", display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                  <input type="hidden" name="videoPageId" value={item.videoPageId} />
                  <label>
                    Note (optional)
                    <input type="text" name="note" maxLength={1000} />
                  </label>
                  <button type="submit">I have reviewed this change</button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}

      <h2>Carried-over approvals ({carriedOver.length})</h2>
      <p>
        These videos were approved under the old single approval. So that nothing disappeared from the site, that approval was carried over: their pages stay public and, as before, they stay listed. Each is marked here until you reconsider it. Keeping one only records
        that you looked; nothing changes until you decide.
      </p>
      {carriedOver.length === 0 ? (
        <p className="studio-empty">Nothing is waiting to be reconsidered.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0 }}>
          {carriedOver.map((item) => (
            <li key={item.videoPageId} style={{ borderTop: "1px solid var(--mm-border)", padding: "0.5rem 0" }}>
              <p style={{ margin: 0 }}>
                <strong>{item.title ?? "(untitled video)"}</strong> — <Link href={`/studio/catalogue/videos/${item.videoId}`}>open the video</Link> · carried over: {item.approvals.map((a) => `${a.scope === "PAGE" ? "public page" : a.scope === "DISCOVERY" ? "public listing" : "playlist"} (${a.origin === "MIGRATED_LEGACY" ? "by the migration" : "by reconciliation"}, approved ${a.approvedAt.toLocaleDateString()}${a.approvedByName ? ` by ${a.approvedByName}` : "; the old approval flag recorded no approver"})`).join("; ")}
              </p>
              {canDecide && (
                <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginTop: "0.25rem" }}>
                  <form action={confirmCarriedOverAction}>
                    <input type="hidden" name="videoPageId" value={item.videoPageId} />
                    <button type="submit">Keep as approved</button>
                  </form>
                  {item.approvals.some((a) => a.scope === "DISCOVERY") && (
                    <form action={withdrawCarriedOverAction}>
                      <input type="hidden" name="videoPageId" value={item.videoPageId} />
                      <input type="hidden" name="scope" value="DISCOVERY" />
                      <button type="submit">Stop listing (page stays reachable by link)</button>
                    </form>
                  )}
                  <form action={withdrawCarriedOverAction}>
                    <input type="hidden" name="videoPageId" value={item.videoPageId} />
                    <input type="hidden" name="scope" value="PAGE" />
                    <button type="submit" className="studio-button--danger">
                      Withdraw completely
                    </button>
                  </form>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <h2>Already decided or waiting ({others.length})</h2>
      {others.length === 0 ? (
        <p className="studio-empty">Nothing else.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0 }}>
          {others.map((item) => (
            <li key={item.videoId} style={{ borderTop: "1px solid var(--mm-border)", padding: "0.5rem 0" }}>
              <p style={{ margin: 0 }}>
                <strong>{item.title ?? "(untitled video)"}</strong> — {CLASS_LABEL[item.class]}
                {item.deferUntil ? ` until ${item.deferUntil.toLocaleDateString()}` : ""}
                {item.activeScopes.length ? ` · approved for: ${item.activeScopes.map((s) => s.toLowerCase()).join(", ")}` : ""}
                {item.lifecycle && item.lifecycle.status !== "NOT_APPROVED" ? ` · ${APPROVAL_STATUS_TEXT[item.lifecycle.status].label}` : ""}
              </p>
              {canDecide && all === "1" && (
                <>
                  <Decision item={item} />
                  <Hold item={item} />
                </>
              )}
              <History videoId={item.videoId} />
            </li>
          ))}
        </ul>
      )}
      {canDecide && (all === "1" ? <Link href="/studio/catalogue/unlisted-review">Hide controls for decided items</Link> : <Link href="/studio/catalogue/unlisted-review?all=1">Reopen a decided item</Link>)}
    </div>
  );
}
