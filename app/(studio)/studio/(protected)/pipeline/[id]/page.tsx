import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../modules/auth/authService";
import { can } from "../../../../../../modules/auth/policy";
import { loadBundleForApproval, loadVideoPageFacts } from "../../../../../../modules/db/repositories/pipelineRepository";
import { canBulkApprove, videoPagePlanFor } from "../../../../../../modules/pipeline/approve";
import { readPipelineConfig } from "../../../../../../modules/pipeline/config";
import type { PageDraft } from "../../../../../../modules/pipeline/drafts";
import { decodeMessage } from "../../../../../../modules/studio/decodeMessage";
import { approveBundleAction, rejectBundleAction } from "../actions";

// R-34: one pipeline bundle — everything the owner approves in one place: the video page draft (editable), the new entity pages, the existing
// entities the video will only be LINKED to, the research claims with their sources (each one accepted or rejected; a conflict must be decided),
// and the flags. Approving creates the DRAFT Recording and new entities through the existing services and publishes through the existing
// publish flow. RECORDING_PUBLISH only.

const RELATION: Record<string, string> = { AGREES: "agrees with the video", CONFLICTS: "CONFLICTS with the video", NOT_STATED: "not in the video" };

function DraftView({ draft }: { draft: PageDraft }) {
  return (
    <div className="studio-panel">
      <p>
        <strong>SEO title</strong> ({draft.seoTitle.length}): {draft.seoTitle}
        <br />
        <strong>Meta description</strong> ({draft.metaDescription.length}): {draft.metaDescription}
      </p>
      <p>
        <strong>Summary</strong> (answer first): {draft.summary.map((s, i) => `${s} [${draft.summarySupport[i]?.join(", ") || "no source"}]`).join(" ")}
      </p>
      {draft.keyFacts.length > 0 && (
        <dl>
          {draft.keyFacts.map((f, i) => (
            <div key={`${f.label}-${i}`}>
              <dt>{f.label}</dt>
              <dd>
                {f.value} <span className="studio-muted">[{f.support.join(", ")}]</span>
              </dd>
            </div>
          ))}
        </dl>
      )}
      {draft.questions.length > 0 && (
        <p>
          <strong>Questions it answers:</strong> {draft.questions.map((q) => `${q.question} ${q.answer}`).join(" · ")}
        </p>
      )}
      {draft.searchQueries.length > 0 && <p className="studio-muted">Search patterns considered: {draft.searchQueries.join(" · ")}</p>}
      {draft.notes.length > 0 && <p className="studio-muted">{draft.notes.join(" · ")}</p>}
      <details>
        <summary>JSON-LD</summary>
        <pre className="studio-pre">{JSON.stringify(draft.jsonLd, null, 2)}</pre>
      </details>
    </div>
  );
}

export default async function PipelineBundlePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; done?: string }> }) {
  const { id } = await params;
  const { error, done } = await searchParams;
  const session = await getCurrentStudioSession();
  if (!session || session.user.status !== "ACTIVE") redirect("/studio/signin");
  if (!can(session.user.role, "RECORDING_PUBLISH")) redirect("/studio/dashboard");
  const bundle = await loadBundleForApproval(id);
  if (!bundle) notFound();
  const open = bundle.status === "AWAITING_APPROVAL" || bundle.status === "APPROVED";
  const held = bundle.draft.heldReasons.length > 0;
  const pagePlan = videoPagePlanFor(bundle, await loadVideoPageFacts(bundle.youtubeVideoRowId), readPipelineConfig(process.env).approvePublicVideoPage);
  const video = bundle.draft.video;

  return (
    <div>
      <p>
        <Link href="/studio/pipeline">← Pipeline</Link>
      </p>
      <h1>{video.name}</h1>
      <p className="studio-muted">
        YouTube: <a href={`https://www.youtube.com/watch?v=${bundle.youtubeVideoId}`}>{bundle.youtubeTitle ?? bundle.youtubeVideoId}</a> · status {bundle.status} · {canBulkApprove(bundle) ? "no flags" : `${bundle.flags.length} flag(s)`}
        {bundle.draft.titleOnly ? " · title-only video" : ""}
      </p>
      {error && <p role="alert" className="studio-alert studio-alert--error">{decodeMessage(error)}</p>}
      {done && <p role="status" className="studio-alert studio-alert--success">{decodeMessage(done)}</p>}

      {bundle.flags.length > 0 && (
        <>
          <h2>Flags</h2>
          <ul>
            {bundle.flags.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </>
      )}

      <form action={approveBundleAction}>
        <input type="hidden" name="id" value={bundle.id} />
        <h2>Video page</h2>
        <DraftView draft={video} />
        {open && (
          <fieldset>
            <legend>Your edits (optional; your words replace the draft&apos;s)</legend>
            <p>
              <label>
                SEO title (about 60 characters)
                <br />
                <input name="seoTitle" defaultValue={video.seoTitle} maxLength={70} size={70} />
              </label>
            </p>
            <p>
              <label>
                Meta description (about 155 characters)
                <br />
                <textarea name="metaDescription" defaultValue={video.metaDescription} maxLength={170} rows={3} cols={70} />
              </label>
            </p>
            <p>
              <label>
                Summary
                <br />
                <textarea name="summary" defaultValue={video.summary.join(" ")} rows={4} cols={70} />
              </label>
            </p>
          </fieldset>
        )}

        <h2>New entities ({bundle.draft.entities.length})</h2>
        {bundle.draft.entities.length === 0 ? <p className="studio-empty">Every entity in this video already exists.</p> : bundle.draft.entities.map((e) => (
          <section key={e.subjectKey}>
            <h3>
              {e.name} <span className="studio-badge studio-badge--info">{e.kind.toLowerCase()}</span>
            </h3>
            <DraftView draft={e} />
          </section>
        ))}

        <h2>Existing entities (linked only)</h2>
        {bundle.draft.mapped.length === 0 ? (
          <p className="studio-empty">None.</p>
        ) : (
          <ul>
            {bundle.draft.mapped.map((m) => (
              <li key={`${m.kind}-${m.entityId}`}>
                {m.role.toLowerCase()}: {m.name} ({m.kind.toLowerCase()}){m.aliasApplied ? " — matched through an approved alias" : ""}
              </li>
            ))}
          </ul>
        )}
        {bundle.draft.exceptions.length > 0 && (
          <>
            <h3>Exceptions (not created, not linked)</h3>
            <ul>
              {bundle.draft.exceptions.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          </>
        )}

        <h2>Claims and sources ({bundle.claims.length})</h2>
        {bundle.claims.length === 0 ? (
          <p className="studio-empty">No research claims.</p>
        ) : (
          <div className="studio-table-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">Id</th>
                  <th scope="col">Claim</th>
                  <th scope="col">Source</th>
                  <th scope="col">Tier</th>
                  <th scope="col">Video</th>
                  <th scope="col">Decision</th>
                </tr>
              </thead>
              <tbody>
                {bundle.claims.map((c) => (
                  <tr key={c.dbId}>
                    <td>{c.id}</td>
                    <td>
                      {c.statement}
                      <br />
                      <span className="studio-muted">“{c.excerpt}”</span>
                      {c.entityLevel && (
                        <>
                          <br />
                          <span className="studio-muted">Entity research, shared with every video that names it ({c.provenance ?? "manual"})</span>
                        </>
                      )}
                    </td>
                    <td>
                      <a href={c.sourceUrl} rel="noopener noreferrer nofollow">{c.sourceTitle ?? c.sourceUrl}</a>
                    </td>
                    <td>{c.sourceTier}</td>
                    <td>{RELATION[c.videoRelation] ?? c.videoRelation}</td>
                    <td>
                      {open && (c.status === "PROPOSED" || c.status === "CONFLICT") ? (
                        <>
                          <label>
                            <input type="radio" name={`claim:${c.dbId}`} value="accept" defaultChecked={c.status === "PROPOSED"} /> accept
                          </label>{" "}
                          <label>
                            <input type="radio" name={`claim:${c.dbId}`} value="reject" /> reject
                          </label>
                          {c.status === "CONFLICT" && <span className="studio-badge studio-badge--warning">decide</span>}
                        </>
                      ) : (
                        c.status.toLowerCase()
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {open && (
          <section className="studio-panel" aria-label="What goes live">
            <h2>What goes live when you approve</h2>
            <ul>
              <li>
                <strong>Recording page:</strong>{" "}
                {held ? `no — the planner held this bundle out (${bundle.draft.heldReasons[0]}); approval will be refused.` : "yes, if it passes the usual publish checks (completeness); otherwise nothing goes live and the reason is shown."}
              </li>
              <li>
                <strong>Entity pages:</strong>{" "}
                {bundle.draft.entities.length ? `${bundle.draft.entities.length} new (${bundle.draft.entities.map((e) => e.name).join(", ")})` : "no new pages"}
                {bundle.draft.mapped.length ? `; ${bundle.draft.mapped.length} existing page(s) will list this recording` : ""}. They become public with the recording.
              </li>
              <li>
                <strong>Video page:</strong> {pagePlan.action === "PUBLISH" ? "yes" : pagePlan.action === "ALREADY_LIVE" ? "already live" : "no"} — {pagePlan.reason}
              </li>
            </ul>
            <p className="studio-muted">The recording and the video page go live in one transaction: both or neither.</p>
          </section>
        )}

        {open && (
          <p>
            <label>
              Note (optional)
              <br />
              <input name="note" size={70} maxLength={300} />
            </label>
            <br />
            <button type="submit" className="studio-button--primary">Approve and publish</button>
          </p>
        )}
      </form>

      {bundle.status === "AWAITING_APPROVAL" && (
        <form action={rejectBundleAction}>
          <input type="hidden" name="id" value={bundle.id} />
          <p>
            <label>
              Reason for rejecting
              <br />
              <input name="note" size={70} maxLength={300} />
            </label>{" "}
            <button type="submit" className="studio-button--danger">Reject the bundle</button>
          </p>
        </form>
      )}
    </div>
  );
}
