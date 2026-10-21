import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../modules/auth/authService";
import { can } from "../../../../../../modules/auth/policy";
import { listPinCandidates, loadFeaturedPlan } from "../../../../../../modules/db/repositories/featuredVideoRepository";
import { moveAction, pinAction, unpinAction } from "./actions";

// Phase 6K-3 — manage the featured videos. Pinned videos come first, in the order set here; remaining slots are filled automatically from the
// videos the Museum lists, and every slot says why it is there. The "what the homepage shows" list is exactly what visitors see now.

export default async function FeaturedPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const session = await getCurrentStudioSession();
  if (!session || session.user.status !== "ACTIVE") redirect("/studio/signin");
  if (!can(session.user.role, "CATALOGUE_WRITE")) redirect("/studio/dashboard");
  const canChange = can(session.user.role, "RECORDING_PUBLISH");
  const { error, notice } = await searchParams;

  const [plan, candidates] = await Promise.all([loadFeaturedPlan(), canChange ? listPinCandidates() : Promise.resolve([])]);
  const { settings } = plan;

  return (
    <div>
      <h1>Featured videos</h1>
      <p>
        Videos you pin come first, in the order below. {settings.autoFill ? "Any remaining slots are filled automatically" : "Automatic fill is off, so only pinned videos are featured"}
        {settings.autoFill ? " from the videos the Museum lists, ranked by YouTube view count and how recently each was published." : "."} Only a video the Museum currently lists can be shown. The number of slots and the automatic ranking are in{" "}
        <Link href="/studio/settings/site">settings</Link>.
      </p>
      {error && (
        <p role="alert" className="studio-alert studio-alert--error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {!canChange && <p role="status">You can see the featured videos, but changing them needs publishing permission.</p>}

      <h2>What the homepage shows now ({plan.entries.length} of {settings.count})</h2>
      {plan.entries.length === 0 ? (
        <p className="studio-empty">Nothing is featured: no video is pinned and {settings.autoFill ? "no video is currently listed" : "automatic fill is off"}.</p>
      ) : (
        <ol>
          {plan.entries.map(({ slot, page, youtubeVideo }) => (
            <li key={page.id}>
              <strong>{youtubeVideo.title ?? "(untitled video)"}</strong> — {slot.reason}
            </li>
          ))}
        </ol>
      )}

      <h2>Pinned ({plan.pinned.length})</h2>
      {plan.pinned.length === 0 ? (
        <p className="studio-empty">Nothing is pinned.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0 }}>
          {plan.pinned.map(({ row, youtubeVideo, currentlyShown }, index) => (
            <li key={row.id} style={{ borderTop: "1px solid var(--mm-border)", padding: "0.5rem 0" }}>
              <p style={{ margin: 0 }}>
                {index + 1}. <strong>{youtubeVideo.title ?? "(untitled video)"}</strong>
                {!currentlyShown && <em> — pinned, but not shown: the Museum does not currently list this video</em>}
              </p>
              {row.note && <p style={{ margin: "0.25rem 0" }}>Note: {row.note}</p>}
              {canChange && (
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  {(["up", "down"] as const).map((direction) => (
                    <form key={direction} action={moveAction}>
                      <input type="hidden" name="videoPageId" value={row.videoPageId} />
                      <input type="hidden" name="direction" value={direction} />
                      <button type="submit" disabled={(direction === "up" && index === 0) || (direction === "down" && index === plan.pinned.length - 1)}>
                        Move {direction}
                      </button>
                    </form>
                  ))}
                  <form action={unpinAction}>
                    <input type="hidden" name="videoPageId" value={row.videoPageId} />
                    <button type="submit" className="studio-button--danger">
                      Unfeature
                    </button>
                  </form>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {canChange && (
        <>
          <h2>Pin a video</h2>
          {candidates.length === 0 ? (
            <p className="studio-empty">No other listed video is available to pin.</p>
          ) : (
            <form action={pinAction} style={{ display: "grid", gap: "0.5rem", maxWidth: "36rem" }}>
              <label>
                Video (most viewed first)
                <select name="videoPageId" required defaultValue="">
                  <option value="" disabled>
                    Choose…
                  </option>
                  {candidates.map((c) => (
                    <option key={c.pageId} value={c.pageId}>
                      {c.title ?? "(untitled video)"}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Note for editors (not shown to visitors)
                <textarea name="note" rows={2} maxLength={1000} />
              </label>
              <button type="submit" className="studio-button--primary">
                Pin this video
              </button>
            </form>
          )}
        </>
      )}
    </div>
  );
}
