import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { isPlausibleSlug } from "../../../../../../../modules/mmke/slug/isPlausibleSlug";
import { getCurrentStudioSession } from "../../../../../../../modules/auth/authService";
import { can } from "../../../../../../../modules/auth/policy";
import { getConfiguredAIProvider } from "../../../../../../../modules/ai/provider/aiProviderRegistry";
import { listContextInputs, listDraftProposals } from "../../../../../../../modules/db/repositories/playlistContextRepository";
import { listAddableVideoPages, loadPlaylistForStudio } from "../../../../../../../modules/db/repositories/playlistPageRepository";
import { loadResolvedSettings } from "../../../../../../../modules/db/repositories/siteSettingRepository";
import { DRAFT_CHECKS_DO_NOT_ESTABLISH, DRAFT_CHECKS_ESTABLISH } from "../../../../../../../modules/ai/structuredOutput/validatePlaylistOutput";
import { PLAYLIST_LIMITS } from "../../../../../../../modules/mmke/playlists/playlistFields";
import {
  addMemberAction,
  approveInclusionAction,
  archiveAction,
  checkQualityAction,
  moveMemberAction,
  publishAction,
  removeMemberAction,
  revokeInclusionAction,
  saveDraftAction,
  unarchiveAction,
  unpublishAction,
} from "./actions";
import { acceptProposalAction, addNoteAction, answerAction, askQuestionAction, proposeDraftAction, rejectProposalAction, skipAction, withdrawAction } from "./aiActions";

// Phase 6K-4 / 6K-5 — edit one playlist page: its words, its curated videos, the publication checks (with exactly what is missing), the optional
// AI interview and drafting, and publication. The public page shows only the published snapshot; everything here is the draft.

function aiAvailability(): { available: boolean; detail: string } {
  try {
    const status = getConfiguredAIProvider().validateConfiguration();
    return status.configured ? { available: true, detail: "" } : { available: false, detail: "No AI provider is configured for this deployment." };
  } catch {
    return { available: false, detail: "The configured AI provider is not supported." };
  }
}

export default async function PlaylistPageEditor({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; notice?: string }> }) {
  const session = await getCurrentStudioSession();
  if (!session || session.user.status !== "ACTIVE") redirect("/studio/signin");
  if (!can(session.user.role, "CATALOGUE_WRITE")) redirect("/studio/dashboard");
  const canEdit = true;
  const canPublish = can(session.user.role, "RECORDING_PUBLISH");
  const { id } = await params;
  // An id no row could have (a NUL byte, which PostgreSQL rejects as text, or an absurd length) is not found, not a database error. After the sign-in check, so a visitor who is not signed in is still sent to sign in.
  if (!isPlausibleSlug(id)) notFound();
  const { error, notice } = await searchParams;

  const view = await loadPlaylistForStudio(id);
  if (!view) notFound();
  const { page, members, quality, orphanApprovals, publications } = view;
  const archived = page.archivedAt !== null;
  const [addable, inputs, proposals, settings] = await Promise.all([archived ? Promise.resolve([]) : listAddableVideoPages(id), listContextInputs(id), listDraftProposals(id), loadResolvedSettings()]);
  const assistantOn = settings.get("playlistAssistant.enabled");
  const ai = aiAvailability();
  const assistantUsable = assistantOn && ai.available && !archived;
  const awaiting = inputs.find((i) => i.status === "AWAITING_ANSWER") ?? null;
  const active = inputs.filter((i) => i.status === "ACTIVE");
  const pendingProposals = proposals.filter((p) => p.proposal.status === "PROPOSED");
  const state = archived ? "archived" : page.status === "PUBLISHED" ? (page.publishedVersion === page.version ? "published" : "published, with unpublished changes") : "draft";

  return (
    <div>
      <p>
        <Link href="/studio/catalogue/playlists">← Playlist pages</Link>
      </p>
      <h1>{page.title}</h1>
      <p>
        <strong>State:</strong> {state} · draft version {page.version}
        {page.status === "PUBLISHED" && !archived ? (
          <>
            {" "}
            · <Link href={`/playlists/${page.slug}`}>view live page</Link>
          </>
        ) : null}
      </p>
      {error && (
        <p role="alert" className="studio-alert studio-alert--error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}

      <section style={{ borderTop: "1px solid var(--mm-border)", paddingTop: "1rem" }}>
        <h2>Publication checks</h2>
        <p>These are checked against the current draft. A page that does not pass stays a draft.</p>
        <ul>
          {quality.criteria.map((c) => (
            <li key={c.key}>
              <strong>{c.status === "PASS" ? "✔" : c.status === "FAIL" ? "✘" : "ℹ"}</strong> {c.label} — {c.detail}
            </li>
          ))}
        </ul>
        <p>
          {quality.passed ? "This draft passes every required check." : `${quality.failing.length} required check${quality.failing.length === 1 ? "" : "s"} not met.`}
        </p>
        {!archived && (
          <form action={checkQualityAction.bind(null, id)}>
            <button type="submit">Check now and update my notifications</button>
          </form>
        )}
      </section>

      <section style={{ borderTop: "1px solid var(--mm-border)", paddingTop: "1rem" }}>
        <h2>The page</h2>
        <form action={saveDraftAction.bind(null, id)} style={{ display: "grid", gap: "0.75rem", maxWidth: "40rem" }}>
          <input type="hidden" name="expectedVersion" value={page.version} />
          <label>
            Title
            <input name="title" defaultValue={page.title} maxLength={PLAYLIST_LIMITS.title} disabled={archived} />
          </label>
          <label>
            Summary (what this playlist is and why these videos belong together)
            <textarea name="summary" defaultValue={page.summary ?? ""} rows={3} maxLength={PLAYLIST_LIMITS.summary} disabled={archived} />
          </label>
          <label>
            Introduction (blank line between paragraphs; a line starting with ## or ### is a heading; nothing else is interpreted)
            <textarea name="body" defaultValue={page.body ?? ""} rows={10} maxLength={PLAYLIST_LIMITS.body} disabled={archived} />
          </label>
          <label>
            Search title (optional)
            <input name="seoTitle" defaultValue={page.seoTitle ?? ""} maxLength={PLAYLIST_LIMITS.seoTitle} disabled={archived} />
          </label>
          <label>
            Search description
            <textarea name="seoDescription" defaultValue={page.seoDescription ?? ""} rows={3} maxLength={PLAYLIST_LIMITS.seoDescription} disabled={archived} />
          </label>
          {canEdit && !archived && (
            <button type="submit" className="studio-button--primary">
              Save draft
            </button>
          )}
        </form>
      </section>

      <section style={{ borderTop: "1px solid var(--mm-border)", paddingTop: "1rem" }}>
        <h2>Videos ({members.length})</h2>
        <p>Chosen by you; being in a YouTube playlist does not put a video here. An unlisted video is shown only after its page and this playlist are approved.</p>
        {members.length === 0 ? (
          <p className="studio-empty">No videos yet.</p>
        ) : (
          <ol>
            {members.map((m, index) => (
              <li key={m.item.id} style={{ marginBottom: "0.75rem" }}>
                <strong>{m.video.title ?? "(untitled video)"}</strong> — {m.video.privacyStatus ?? "unknown visibility"} on YouTube · {m.shown ? "shown to visitors" : `not shown: ${m.whyNot}`}
                {m.video.privacyStatus === "unlisted" && m.playlistApproval && <em> · approved for this playlist</em>}
                {!archived && (
                  <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginTop: "0.25rem" }}>
                    <form action={moveMemberAction.bind(null, id)}>
                      <input type="hidden" name="videoPageId" value={m.page.id} />
                      <input type="hidden" name="direction" value="up" />
                      <button type="submit" disabled={index === 0}>
                        Move up
                      </button>
                    </form>
                    <form action={moveMemberAction.bind(null, id)}>
                      <input type="hidden" name="videoPageId" value={m.page.id} />
                      <input type="hidden" name="direction" value="down" />
                      <button type="submit" disabled={index === members.length - 1}>
                        Move down
                      </button>
                    </form>
                    <form action={removeMemberAction.bind(null, id)}>
                      <input type="hidden" name="videoPageId" value={m.page.id} />
                      <button type="submit">Remove</button>
                    </form>
                    {canPublish && m.video.privacyStatus === "unlisted" && !m.playlistApproval && (
                      <form action={approveInclusionAction.bind(null, id)}>
                        <input type="hidden" name="videoPageId" value={m.page.id} />
                        <button type="submit">Approve for this playlist</button>
                      </form>
                    )}
                    {canPublish && m.playlistApproval && (
                      <form action={revokeInclusionAction.bind(null, id)}>
                        <input type="hidden" name="videoPageId" value={m.page.id} />
                        <button type="submit" className="studio-button--danger">
                          Revoke for this playlist
                        </button>
                      </form>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}
        {orphanApprovals.length > 0 && (
          <div>
            <h3>Approved for this playlist but no longer in the draft</h3>
            <ul>
              {orphanApprovals.map(({ approval, title }) => (
                <li key={approval.id}>
                  {title ?? "(untitled video)"}
                  {canPublish && (
                    <form action={revokeInclusionAction.bind(null, id)} style={{ display: "inline", marginLeft: "0.5rem" }}>
                      <input type="hidden" name="videoPageId" value={approval.videoPageId} />
                      <button type="submit">Revoke</button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
        {!archived && addable.length > 0 && (
          <form action={addMemberAction.bind(null, id)} style={{ display: "grid", gap: "0.5rem", maxWidth: "36rem", marginTop: "1rem" }}>
            <label>
              Add a video (newest first)
              <select name="videoPageId" required defaultValue="">
                <option value="" disabled>
                  Choose…
                </option>
                {addable.map((v) => (
                  <option key={v.pageId} value={v.pageId}>
                    {v.title ?? "(untitled video)"} — {v.privacy ?? "unknown"}, page {v.status.toLowerCase()}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Note shown beside the video (optional)
              <input name="note" maxLength={PLAYLIST_LIMITS.note} />
            </label>
            <button type="submit">Add to draft</button>
          </form>
        )}
      </section>

      <section style={{ borderTop: "1px solid var(--mm-border)", paddingTop: "1rem" }}>
        <h2>Context about this playlist</h2>
        <p>
          What only you know — why these videos belong together, the occasion, the people. The assistant asks questions one at a time; it never answers for you, and it can
          draft text only from what is recorded here and from the videos&rsquo; titles and dates.
        </p>
        {!assistantUsable && !archived && (
          <p role="status">
            The AI assistant is unavailable: {!assistantOn ? "it is switched off in settings." : ai.detail} You can still add your own notes below.
          </p>
        )}

        {awaiting && (
          <div style={{ border: "1px solid var(--mm-border)", padding: "0.75rem 1rem", margin: "0.75rem 0" }}>
            <p style={{ marginTop: 0 }}>
              <strong>The assistant asks:</strong> {awaiting.question}
            </p>
            <form action={answerAction.bind(null, id, awaiting.id)} style={{ display: "grid", gap: "0.5rem", maxWidth: "36rem" }}>
              <label>
                Your answer
                <textarea name="answer" rows={3} maxLength={2000} required />
              </label>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <button type="submit" className="studio-button--primary">
                  Record answer
                </button>
              </div>
            </form>
            <form action={skipAction.bind(null, id, awaiting.id)} style={{ marginTop: "0.5rem" }}>
              <button type="submit">Skip this question</button>
            </form>
          </div>
        )}
        {!awaiting && assistantUsable && (
          <form action={askQuestionAction.bind(null, id)}>
            <button type="submit">Ask me the next question</button>
          </form>
        )}

        {active.length > 0 && (
          <>
            <h3>Recorded context ({active.length})</h3>
            <ul>
              {active.map((i) => (
                <li key={i.id}>
                  {i.question && (
                    <>
                      <em>{i.question}</em>
                      <br />
                    </>
                  )}
                  {i.body} <small>— {i.answeredBy?.name ?? i.createdBy.name}</small>
                  {!archived && (
                    <form action={withdrawAction.bind(null, id, i.id)} style={{ display: "inline", marginLeft: "0.5rem" }}>
                      <button type="submit">Withdraw</button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
        {!archived && (
          <form action={addNoteAction.bind(null, id)} style={{ display: "grid", gap: "0.5rem", maxWidth: "36rem", marginTop: "0.75rem" }}>
            <label>
              Add your own note
              <textarea name="note" rows={2} maxLength={2000} required />
            </label>
            <button type="submit">Record note</button>
          </form>
        )}
      </section>

      <section style={{ borderTop: "1px solid var(--mm-border)", paddingTop: "1rem" }}>
        <h2>Drafts from the assistant</h2>
        <p>The assistant proposes; you decide. Nothing changes until you accept a draft, and accepting changes only this page&rsquo;s draft — it still has to pass the checks and be published by someone who may publish.</p>
        {assistantUsable && (
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <form action={proposeDraftAction.bind(null, id, "SUMMARY")}>
              <button type="submit">Propose a summary</button>
            </form>
            <form action={proposeDraftAction.bind(null, id, "BODY")}>
              <button type="submit">Propose an introduction</button>
            </form>
          </div>
        )}
        {pendingProposals.length === 0 ? (
          <p className="studio-empty">No draft is waiting for your decision.</p>
        ) : (
          pendingProposals.map(({ proposal, sentences, evidenceText, stale }) => (
            <div key={proposal.id} style={{ border: "1px solid var(--mm-border)", padding: "0.75rem 1rem", margin: "0.75rem 0" }}>
              <p style={{ marginTop: 0 }}>
                <strong>Proposed {proposal.target === "SUMMARY" ? "summary" : "introduction"}</strong> <small>({proposal.provider}, {proposal.model})</small>
              </p>
              <p role="status" style={{ border: "1px solid var(--mm-border-strong)", padding: "0.5rem 0.75rem" }}>
                <strong>Not verified.</strong> This passed the automatic checks, which establish only this: {DRAFT_CHECKS_ESTABLISH} {DRAFT_CHECKS_DO_NOT_ESTABLISH}
              </p>
              <p style={{ whiteSpace: "pre-wrap" }}>{proposal.proposedContent}</p>
              {sentences ? (
                <>
                  <h4>Each statement beside the evidence it rests on</h4>
                  <ol>
                    {sentences.map((s, i) => (
                      <li key={i} style={{ marginBottom: "0.75rem" }}>
                        <p style={{ margin: 0 }}>
                          <strong>{s.text}</strong>
                        </p>
                        {s.evidenceIds.map((evidenceId) => (
                          <p key={evidenceId} style={{ margin: "0.25rem 0 0 1rem", fontSize: "0.9rem" }}>
                            <em>{evidenceId}:</em> {evidenceText[evidenceId] ?? "(evidence no longer available)"}
                            <br />
                            Quoted: {s.quotes.map((q) => `“${q}”`).join(" · ")}
                          </p>
                        ))}
                      </li>
                    ))}
                  </ol>
                </>
              ) : (
                <p role="status">This draft was created by an earlier version of the checks and cannot be accepted. Ask for a new draft.</p>
              )}
              {stale ? (
                <p role="status">The context or videos have changed since this was written, so it can no longer be accepted. Ask for a new draft.</p>
              ) : (
                sentences && (
                  <form action={acceptProposalAction.bind(null, id, proposal.id)} style={{ display: "grid", gap: "0.5rem" }}>
                    <input type="hidden" name="expectedVersion" value={page.version} />
                    <label>
                      <input type="checkbox" name="verified" required /> I have read each statement above against the evidence beside it and I am satisfied that it says nothing the evidence does not say.
                    </label>
                    <div>
                      <button type="submit" className="studio-button--primary">
                        Accept into the draft
                      </button>
                    </div>
                  </form>
                )
              )}
              <form action={rejectProposalAction.bind(null, id, proposal.id)} style={{ display: "inline", marginLeft: "0.5rem" }}>
                <button type="submit">Dismiss</button>
              </form>
            </div>
          ))
        )}
      </section>

      <section style={{ borderTop: "1px solid var(--mm-border)", paddingTop: "1rem" }}>
        <h2>Publication</h2>
        {canPublish ? (
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            {!archived && (
              <form action={publishAction.bind(null, id)}>
                <input type="hidden" name="expectedVersion" value={page.version} />
                <button type="submit" className="studio-button--primary" disabled={!quality.passed}>
                  Publish this version ({page.version})
                </button>
              </form>
            )}
            {page.status === "PUBLISHED" && !archived && (
              <form action={unpublishAction.bind(null, id)}>
                <button type="submit" className="studio-button--danger">
                  Take off the public site
                </button>
              </form>
            )}
            {!archived ? (
              <form action={archiveAction.bind(null, id)}>
                <button type="submit">Archive</button>
              </form>
            ) : (
              <form action={unarchiveAction.bind(null, id)}>
                <button type="submit">Restore as a draft</button>
              </form>
            )}
          </div>
        ) : (
          <p>
            <em>Publishing needs the right to publish.</em>
          </p>
        )}
        {publications.length > 0 && (
          <>
            <h3>History</h3>
            <ul>
              {publications.map((p) => (
                <li key={p.id}>
                  {p.createdAt.toLocaleString()} — {p.kind === "PUBLISHED" ? "published" : "unpublished"} version {p.version}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}
