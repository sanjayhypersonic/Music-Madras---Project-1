import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { isPlausibleSlug } from "../../../../../../../modules/mmke/slug/isPlausibleSlug";
import { getCurrentStudioSession } from "../../../../../../../modules/auth/authService";
import { can } from "../../../../../../../modules/auth/policy";
import { findProgrammeById } from "../../../../../../../modules/db/repositories/programmeRepository";
import { listActiveComposers } from "../../../../../../../modules/db/repositories/composerRepository";
import { listMusicalWorksByComposer } from "../../../../../../../modules/db/repositories/musicalWorkRepository";
import { listActiveOccasions, listOccasionsForEntity } from "../../../../../../../modules/db/repositories/occasionRepository";
import { StatusBadge } from "../../../../../../../components/studio/StatusBadge";
import {
  addProgrammeItemAction,
  archiveProgrammeAction,
  attachOccasionAction,
  detachOccasionAction,
  moveProgrammeItemAction,
  removeProgrammeItemAction,
  restoreProgrammeAction,
  updateProgrammeAction,
} from "./actions";
import { decodeMessage } from "../../../../../../../modules/studio/decodeMessage";

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
  // An id no row could have (a NUL byte, which PostgreSQL rejects as text, or an absurd length) is not found, not a database error. After the sign-in check, so a visitor who is not signed in is still sent to sign in.
  if (!isPlausibleSlug(id)) notFound();
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
  const [activeOccasions, attachedOccasions] = await Promise.all([
    listActiveOccasions(),
    listOccasionsForEntity("PROGRAMME", programme.id),
  ]);
  const attachableOccasions = activeOccasions.filter(
    (occasion) => !attachedOccasions.some((link) => link.occasionId === occasion.id)
  );

  return (
    <div>
      <p>
        <Link href="/studio/catalogue/programmes">← Programmes</Link>
      </p>
      <h1>{programme.title}</h1>
      {error && <p role="alert" className="studio-alert studio-alert--error">{decodeMessage(error)}</p>}

      <p>
        Status: <strong><StatusBadge status={programme.archivedAt ? "Archived" : "Active"} /></strong>
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
          <button type="submit" className="studio-button--primary">Save</button>
        </form>
      ) : (
        <p>You do not have permission to edit this programme.</p>
      )}

      {canWrite && (
        <div style={{ marginTop: "1rem" }}>
          {!programme.archivedAt ? (
            <form action={archiveProgrammeAction.bind(null, programme.id)}>
              <button type="submit" className="studio-button--danger">Archive</button>
            </form>
          ) : (
            <form action={restoreProgrammeAction.bind(null, programme.id)}>
              <button type="submit">Restore</button>
            </form>
          )}
        </div>
      )}

      <h2>Occasions ({attachedOccasions.length})</h2>
      {attachedOccasions.length === 0 ? (
        <p className="studio-empty">No occasions have been attached to this programme yet.</p>
      ) : (
        <ul>
          {attachedOccasions.map((link) => (
            <li key={link.occasionId}>
              {link.occasion.name}
              {link.occasion.archivedAt ? " (archived)" : ""}
              {canWrite && (
                <form action={detachOccasionAction.bind(null, programme.id, link.occasionId)} style={{ display: "inline" }}>
                  <button type="submit" className="studio-button--danger">Remove</button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
      {canWrite && attachableOccasions.length > 0 && (
        <form action={attachOccasionAction.bind(null, programme.id)} style={{ display: "flex", gap: "0.5rem", maxWidth: "28rem" }}>
          <select name="occasionId" required style={{ flex: 1 }}>
            {attachableOccasions.map((occasion) => (
              <option key={occasion.id} value={occasion.id}>
                {occasion.name}
              </option>
            ))}
          </select>
          <button type="submit" className="studio-button--primary">Attach occasion</button>
        </form>
      )}
      {activeOccasions.length === 0 && (
        <p>
          No occasions exist yet. <Link href="/studio/catalogue/occasions/new">Create one</Link>.
        </p>
      )}

      <h2>Running order ({programme.items.length})</h2>
      {programme.items.length === 0 ? (
        <p className="studio-empty">No works have been added to this programme yet.</p>
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
                    <button type="submit" className="studio-button--danger">Remove</button>
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
          <button type="submit" className="studio-button--primary">Add to programme</button>
        </form>
      )}
    </div>
  );
}
