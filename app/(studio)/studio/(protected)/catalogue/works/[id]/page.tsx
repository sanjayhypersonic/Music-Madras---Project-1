import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../../modules/auth/authService";
import { can } from "../../../../../../../modules/auth/policy";
import { listActiveComposers, findComposerById } from "../../../../../../../modules/db/repositories/composerRepository";
import { findMusicalWorkDetailForStudio } from "../../../../../../../modules/db/repositories/musicalWorkRepository";
import { archiveWorkAction, restoreWorkAction, updateWorkAction } from "./actions";

// Phase 6G-4C — the Musical Work editorial management view. No public
// /works/[slug] route exists yet (deliberately deferred, per 6G-4A/4B),
// so there is no "View public page" link here — that will be added once
// that route ships.

export default async function MusicalWorkDetailPage({
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

  const work = await findMusicalWorkDetailForStudio(id);
  if (!work) {
    notFound();
  }

  const canWrite = can(session.user.role, "CATALOGUE_WRITE");
  const composers = await listActiveComposers();
  // The work's current composer may itself be archived — always include
  // it in the picker's options so saving the form without changing the
  // composer doesn't silently reassign it to whatever is first in the list.
  const currentComposerStillActive = composers.some((c) => c.id === work.composerId);
  const currentComposer = currentComposerStillActive ? null : await findComposerById(work.composerId);

  return (
    <div>
      <p>
        <Link href="/studio/catalogue/works">← Musical Works</Link>
      </p>
      <h1>{work.title}</h1>
      {error && <p style={{ color: "#b00020" }}>{decodeURIComponent(error)}</p>}

      <p>
        Status: <strong>{work.archivedAt ? "Archived" : "Active"}</strong>
        <br />
        Slug: <code>{work.slug}</code>
        <br />
        Composer: <Link href={`/studio/catalogue/composers/${work.composer.id}`}>{work.composer.name}</Link>
      </p>

      <h2>Edit</h2>
      {canWrite ? (
        <form
          action={updateWorkAction.bind(null, work.id)}
          style={{ display: "flex", flexDirection: "column", gap: "0.5rem", maxWidth: "24rem" }}
        >
          <label>
            Composer
            <select name="composerId" required defaultValue={work.composerId} style={{ display: "block", width: "100%" }}>
              {currentComposer && (
                <option value={currentComposer.id}>{currentComposer.name} (archived)</option>
              )}
              {composers.map((composer) => (
                <option key={composer.id} value={composer.id}>
                  {composer.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Title
            <input name="title" required defaultValue={work.title} style={{ display: "block", width: "100%" }} />
          </label>
          <label>
            Catalogue number
            <input name="catalogueNumber" defaultValue={work.catalogueNumber ?? ""} style={{ display: "block", width: "100%" }} />
          </label>
          <label>
            Key signature
            <input name="keySignature" defaultValue={work.keySignature ?? ""} style={{ display: "block", width: "100%" }} />
          </label>
          <label>
            Language
            <input name="language" defaultValue={work.language ?? ""} style={{ display: "block", width: "100%" }} />
          </label>
          <label>
            Notes
            <textarea name="notes" defaultValue={work.notes ?? ""} style={{ display: "block", width: "100%" }} />
          </label>
          <button type="submit">Save</button>
        </form>
      ) : (
        <p>You do not have permission to edit this musical work.</p>
      )}

      {canWrite && (
        <div style={{ marginTop: "1rem" }}>
          {!work.archivedAt ? (
            <form action={archiveWorkAction.bind(null, work.id)}>
              <button type="submit">Archive</button>
            </form>
          ) : (
            <form action={restoreWorkAction.bind(null, work.id)}>
              <button type="submit">Restore</button>
            </form>
          )}
        </div>
      )}

      <h2>Relationships</h2>
      <p>
        <strong>Programmes ({work.programmeItems.length})</strong>
      </p>
      {work.programmeItems.length > 0 ? (
        <ul>
          {work.programmeItems.map((item) => (
            <li key={item.id}>{item.programme.title}</li>
          ))}
        </ul>
      ) : (
        <p>Not part of any programme yet.</p>
      )}

      <p>
        <strong>Recordings ({work.recordingRevisionLinks.length})</strong>
      </p>
      {work.recordingRevisionLinks.length > 0 ? (
        <ul>
          {work.recordingRevisionLinks.map((link) => (
            <li key={link.revisionId}>{link.revision.title ?? "Untitled recording revision"}</li>
          ))}
        </ul>
      ) : (
        <p>Not attached to any recording yet.</p>
      )}
    </div>
  );
}
