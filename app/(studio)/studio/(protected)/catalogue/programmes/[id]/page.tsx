import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../../modules/auth/authService";
import { can } from "../../../../../../../modules/auth/policy";
import { findProgrammeById } from "../../../../../../../modules/db/repositories/programmeRepository";
import { listActiveComposers } from "../../../../../../../modules/db/repositories/composerRepository";
import { listMusicalWorksByComposer } from "../../../../../../../modules/db/repositories/musicalWorkRepository";
import {
  addProgrammeItemAction,
  archiveProgrammeAction,
  moveProgrammeItemAction,
  removeProgrammeItemAction,
  restoreProgrammeAction,
  updateProgrammeAction,
} from "./actions";

// Phase 6G-4G — the Programme editorial management view. Distinct from
// the existing /studio/recordings/[id]/programme wizard step (brief §2):
// that page is a narrow "pick or create one for this recording" tool and
// is left completely unchanged; this page is for browsing/editing every
// Programme as a canonical catalogue record, with full running-order
// management (add, remove, reorder) that the wizard step never exposed.

export default async function ProgrammeDetailPage({
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

  const programme = await findProgrammeById(id);
  if (!programme) {
    notFound();
  }

  const canWrite = can(session.user.role, "CATALOGUE_WRITE");
  const composers = await listActiveComposers();
  const worksByComposer = await Promise.all(
    composers.map(async (composer) => ({ composer, works: await listMusicalWorksByComposer(composer.id) }))
  );

  return (
    <div>
      <p>
        <Link href="/studio/catalogue/programmes">← Programmes</Link>
      </p>
      <h1>{programme.title}</h1>
      {error && <p style={{ color: "#b00020" }}>{decodeURIComponent(error)}</p>}

      <p>
        Status: <strong>{programme.archivedAt ? "Archived" : "Active"}</strong>
        <br />
        Slug: <code>{programme.slug}</code>
      </p>

      <h2>Edit</h2>
      {canWrite ? (
        <form
          action={updateProgrammeAction.bind(null, programme.id)}
          style={{ display: "flex", flexDirection: "column", gap: "0.5rem", maxWidth: "24rem" }}
        >
          <label>
            Title
            <input name="title" required defaultValue={programme.title} style={{ display: "block", width: "100%" }} />
          </label>
          <label>
            Notes
            <textarea name="notes" defaultValue={programme.notes ?? ""} style={{ display: "block", width: "100%" }} />
          </label>
          <button type="submit">Save</button>
        </form>
      ) : (
        <p>You do not have permission to edit this programme.</p>
      )}

      {canWrite && (
        <div style={{ marginTop: "1rem" }}>
          {!programme.archivedAt ? (
            <form action={archiveProgrammeAction.bind(null, programme.id)}>
              <button type="submit">Archive</button>
            </form>
          ) : (
            <form action={restoreProgrammeAction.bind(null, programme.id)}>
              <button type="submit">Restore</button>
            </form>
          )}
        </div>
      )}

      <h2>Running order ({programme.items.length})</h2>
      {programme.items.length === 0 ? (
        <p>No works have been added to this programme yet.</p>
      ) : (
        <ol>
          {programme.items.map((item, index) => (
            <li key={item.id}>
              {item.musicalWork.title}
              {item.movement ? ` — ${item.movement}` : ""}
              {item.isEncore ? " (encore)" : ""}
              {canWrite && (
                <>
                  {index > 0 && (
                    <form action={moveProgrammeItemAction.bind(null, programme.id, item.id, index - 1)} style={{ display: "inline" }}>
                      <button type="submit" aria-label={`Move ${item.musicalWork.title} up`}>
                        ▲
                      </button>
                    </form>
                  )}
                  {index < programme.items.length - 1 && (
                    <form action={moveProgrammeItemAction.bind(null, programme.id, item.id, index + 1)} style={{ display: "inline" }}>
                      <button type="submit" aria-label={`Move ${item.musicalWork.title} down`}>
                        ▼
                      </button>
                    </form>
                  )}
                  <form action={removeProgrammeItemAction.bind(null, programme.id, item.id)} style={{ display: "inline" }}>
                    <button type="submit">Remove</button>
                  </form>
                </>
              )}
            </li>
          ))}
        </ol>
      )}

      {canWrite && (
        <form
          action={addProgrammeItemAction.bind(null, programme.id)}
          style={{ display: "flex", flexDirection: "column", gap: "0.5rem", maxWidth: "24rem" }}
        >
          <label>
            Work
            <select name="musicalWorkId" required style={{ display: "block", width: "100%" }}>
              {worksByComposer.map(({ composer, works }) =>
                works.length > 0 ? (
                  <optgroup key={composer.id} label={composer.name}>
                    {works.map((work) => (
                      <option key={work.id} value={work.id}>
                        {work.title}
                      </option>
                    ))}
                  </optgroup>
                ) : null
              )}
            </select>
          </label>
          <label>
            Movement (optional)
            <input name="movement" style={{ display: "block", width: "100%" }} />
          </label>
          <label>
            <input type="checkbox" name="isEncore" /> Encore
          </label>
          <button type="submit">Add to programme</button>
        </form>
      )}
    </div>
  );
}
