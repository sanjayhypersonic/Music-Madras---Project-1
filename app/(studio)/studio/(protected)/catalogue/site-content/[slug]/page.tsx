import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { isPlausibleSlug } from "../../../../../../../modules/mmke/slug/isPlausibleSlug";
import { EditorialBlockBody } from "../../../../../../../components/museum/EditorialBlockBody";
import { getCurrentStudioSession } from "../../../../../../../modules/auth/authService";
import { can } from "../../../../../../../modules/auth/policy";
import { deriveEditorialBlockState, findEditorialContentBySlug, listEditorialPublications } from "../../../../../../../modules/db/repositories/editorialContentRepository";
import { EDITORIAL_LIMITS, findEditorialBlock, listPublishProblems } from "../../../../../../../modules/mmke/editorial/editorialBlocks";
import { findBuiltInCopy } from "../../../../../../../modules/mmke/editorial/builtInCopy";
import { createDraftAction, createDraftFromBuiltInAction, publishAction, saveDraftAction, unpublishAction } from "./actions";

// Phase 6K-1 — edit, preview, publish and unpublish one editorial block. The preview shows the DRAFT as it would be published;
// publishing records the version previewed, so a draft edited after the preview cannot be published unseen. The public site only ever
// shows the published snapshot.

export default async function EditorialBlockPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const session = await getCurrentStudioSession();
  if (!session || session.user.status !== "ACTIVE") redirect("/studio/signin");
  const { slug } = await params;
  // An id no row could have (a NUL byte, which PostgreSQL rejects as text, or an absurd length) is not found, not a database error. After the sign-in check, so a visitor who is not signed in is still sent to sign in.
  if (!isPlausibleSlug(slug)) notFound();
  const query = await searchParams;
  const block = findEditorialBlock(slug);
  if (!block) notFound();

  const canEdit = can(session.user.role, "CATALOGUE_WRITE");
  const canPublish = can(session.user.role, "RECORDING_PUBLISH");
  const row = await findEditorialContentBySlug(slug);
  const state = deriveEditorialBlockState(row);
  const publications = row ? await listEditorialPublications(row.id) : [];
  const builtIn = findBuiltInCopy(slug);
  const showingBuiltIn = builtIn !== null && (state === "NOT_CREATED" || state === "DRAFT");
  const problems = row ? listPublishProblems(block, { title: row.title, body: row.body, seoTitle: row.seoTitle, seoDescription: row.seoDescription }) : [];

  return (
    <div>
      <p>
        <Link href="/studio/catalogue/site-content">← Site content</Link>
      </p>
      <h1>{block.label}</h1>
      <p>{block.purpose}</p>
      <p>
        <strong>Appears on:</strong> {block.usedOn}
      </p>
      {query.error && (
        <p role="alert" className="studio-alert studio-alert--error">
          {query.error}
        </p>
      )}
      {query.saved && <p role="status">Draft saved. The live site is unchanged until you publish.</p>}
      {query.published && <p role="status">Published.</p>}
      {query.unpublished && <p role="status">Taken off the public site.</p>}

      {!row ? (
        <>
          <p className="studio-empty">
            {builtIn
              ? "This block has not been started. The public site currently shows built-in text (below) until you publish your own."
              : "This block has not been started. Until it is published, nothing is shown on the public site."}
          </p>
          {builtIn && (
            <section style={{ border: "1px solid var(--mm-border)", padding: "0.75rem 1rem", margin: "1rem 0" }}>
              <h2 style={{ marginTop: 0 }}>Built-in text now on the site</h2>
              <p>
                <strong>{builtIn.title}</strong>
              </p>
              {block.usesBody && <EditorialBlockBody body={builtIn.body} headingOffset={1} />}
              {block.usesSeo && (
                <p>
                  {builtIn.seoTitle} — {builtIn.seoDescription}
                </p>
              )}
            </section>
          )}
          {canEdit && (
            <div style={{ display: "flex", gap: "0.5rem" }}>
              {builtIn && (
                <form action={createDraftFromBuiltInAction.bind(null, slug)}>
                  <button type="submit" className="studio-button--primary">
                    Start a draft from the built-in text
                  </button>
                </form>
              )}
              <form action={createDraftAction.bind(null, slug)}>
                <button type="submit">Start a blank draft</button>
              </form>
            </div>
          )}
        </>
      ) : (
        <>
          {showingBuiltIn && <p role="status">Until this block is published, the public site shows built-in text. Publishing this draft replaces it.</p>}
          <p>
            <strong>State:</strong> {state.replaceAll("_", " ").toLowerCase()} · draft version {row.version}
            {row.publishedAt ? ` · last published ${row.publishedAt.toLocaleString()} (version ${row.publishedVersion})` : ""}
          </p>

          <form action={saveDraftAction.bind(null, slug)} style={{ margin: "1rem 0" }}>
            <input type="hidden" name="expectedVersion" value={row.version} />
            <label style={{ display: "block" }}>
              {block.slug === "museum-footer-tagline" ? "Tagline" : "Title"}
              <input name="title" defaultValue={row.title} maxLength={EDITORIAL_LIMITS.title} disabled={!canEdit} style={{ display: "block", width: "100%", maxWidth: "40rem" }} />
            </label>
            {block.usesBody && (
              <label style={{ display: "block", marginTop: "1rem" }}>
                Body (blank line between paragraphs; a line starting with ## or ### is a heading; nothing else is interpreted)
                <textarea name="body" defaultValue={row.body ?? ""} rows={12} maxLength={EDITORIAL_LIMITS.body} disabled={!canEdit} style={{ display: "block", width: "100%", maxWidth: "40rem" }} />
              </label>
            )}
            {block.usesSeo && (
              <>
                <label style={{ display: "block", marginTop: "1rem" }}>
                  SEO title
                  <input name="seoTitle" defaultValue={row.seoTitle ?? ""} maxLength={EDITORIAL_LIMITS.seoTitle} disabled={!canEdit} style={{ display: "block", width: "100%", maxWidth: "40rem" }} />
                </label>
                <label style={{ display: "block", marginTop: "1rem" }}>
                  SEO description
                  <textarea name="seoDescription" defaultValue={row.seoDescription ?? ""} rows={3} maxLength={EDITORIAL_LIMITS.seoDescription} disabled={!canEdit} style={{ display: "block", width: "100%", maxWidth: "40rem" }} />
                </label>
              </>
            )}
            {canEdit ? (
              <p>
                <button type="submit" className="studio-button--primary">
                  Save draft
                </button>
              </p>
            ) : (
              <p>
                <em>You can view this block but not edit it.</em>
              </p>
            )}
          </form>

          <section style={{ borderTop: "1px solid var(--mm-border)", paddingTop: "1rem" }}>
            <h2>Preview of the draft</h2>
            {row.title && block.usesBody && <h3>{row.title}</h3>}
            {!block.usesBody && !block.usesSeo && <p>{row.title || <em>(empty)</em>}</p>}
            {block.usesBody && <EditorialBlockBody body={row.body} headingOffset={1} />}
            {block.usesSeo && (
              <div>
                <p>
                  <strong>{row.seoTitle || "(no SEO title)"}</strong>
                </p>
                <p>{row.seoDescription || "(no SEO description)"}</p>
              </div>
            )}
          </section>

          <section style={{ borderTop: "1px solid var(--mm-border)", paddingTop: "1rem" }}>
            <h2>Publication</h2>
            {problems.length > 0 ? (
              <ul>
                {problems.map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
            ) : (
              <p>This draft is complete for its block.</p>
            )}
            {canPublish ? (
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <form action={publishAction.bind(null, slug)}>
                  <input type="hidden" name="expectedVersion" value={row.version} />
                  <button type="submit" className="studio-button--primary" disabled={problems.length > 0}>
                    Publish this version ({row.version})
                  </button>
                </form>
                {row.status === "PUBLISHED" && (
                  <form action={unpublishAction.bind(null, slug)}>
                    <button type="submit" className="studio-button--danger">
                      Take off the public site
                    </button>
                  </form>
                )}
              </div>
            ) : (
              <p>
                <em>Publishing needs the right to publish.</em>
              </p>
            )}
          </section>

          {publications.length > 0 && (
            <section style={{ borderTop: "1px solid var(--mm-border)", paddingTop: "1rem" }}>
              <h2>Publication history</h2>
              <ul>
                {publications.map((publication) => (
                  <li key={publication.id}>
                    {publication.createdAt.toLocaleString()} — {publication.kind === "PUBLISHED" ? "published" : "unpublished"} version {publication.version}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
