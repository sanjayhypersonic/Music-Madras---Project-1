import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../../modules/auth/authService";
import { can, describeRolesThatCan } from "../../../../../../../modules/auth/policy";
import { isPlausibleSlug } from "../../../../../../../modules/mmke/slug/isPlausibleSlug";
import { ReadOnlyStepNotice } from "../../../../../../../components/studio/ReadOnlyStepNotice";
import { listProgrammes, findProgrammeById } from "../../../../../../../modules/db/repositories/programmeRepository";
import { listActiveComposers } from "../../../../../../../modules/db/repositories/composerRepository";
import { listMusicalWorksByComposer } from "../../../../../../../modules/db/repositories/musicalWorkRepository";
import { createProgrammeAction, addProgrammeItemAction, removeProgrammeItemAction } from "./actions";
import { decodeMessage } from "../../../../../../../modules/studio/decodeMessage";

export default async function ProgrammeStepPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ programmeId?: string; error?: string }>;
}) {
  const { id } = await params;
  const { programmeId, error } = await searchParams;
  const session = await getCurrentStudioSession();
  if (!session) redirect("/studio/signin");

  const canWrite = can(session.user.role, "CATALOGUE_WRITE");
  const [programmes, composers] = await Promise.all([listProgrammes(), listActiveComposers()]);
  // A programme id from the URL that no programme could have (a NUL byte) selects nothing, rather than reaching the database.
  const selectedProgramme = programmeId && isPlausibleSlug(programmeId) ? await findProgrammeById(programmeId) : null;
  const worksByComposer = selectedProgramme
    ? await Promise.all(composers.map(async (c) => ({ composer: c, works: await listMusicalWorksByComposer(c.id) })))
    : [];

  return (
    <div>
      <h2>Programme</h2>
      <p>The concert programme this recording belongs to — a real, ordered running order, not free text.</p>
      {error && <p role="alert" className="studio-alert studio-alert--error">{decodeMessage(error)}</p>}

      <form method="get" style={{ display: "flex", gap: "0.5rem", alignItems: "flex-end", maxWidth: "28rem" }}>
        <label style={{ flex: 1 }}>
          Select an existing programme
          <select name="programmeId" defaultValue={programmeId ?? ""} style={{ display: "block", width: "100%" }}>
            <option value="">— none selected —</option>
            {programmes.map((programme) => (
              <option key={programme.id} value={programme.id}>
                {programme.title}
              </option>
            ))}
          </select>
        </label>
        <button type="submit">View</button>
      </form>

      {!canWrite && <ReadOnlyStepNotice roles={describeRolesThatCan("CATALOGUE_WRITE")} what="create or change programmes" />}
      {canWrite && (
        <>
          <h3>Create a new programme</h3>
          <form
            action={createProgrammeAction.bind(null, id)}
            style={{ display: "flex", flexDirection: "column", gap: "0.5rem", maxWidth: "24rem" }}
          >
            <label>
              Title
              <input name="title" required style={{ display: "block", width: "100%" }} />
            </label>
            <label>
              Notes
              <textarea name="notes" style={{ display: "block", width: "100%" }} />
            </label>
            <button type="submit" className="studio-button--primary">Create programme</button>
          </form>
        </>
      )}

      {selectedProgramme && (
        <div style={{ marginTop: "1.5rem" }}>
          <h3>{selectedProgramme.title} — running order</h3>
          {selectedProgramme.items.length === 0 ? (
            <p className="studio-empty">No items yet.</p>
          ) : (
            <ol>
              {selectedProgramme.items.map((item) => (
                <li key={item.id}>
                  {item.musicalWork.title}
                  {item.movement ? ` — ${item.movement}` : ""}
                  {item.isEncore ? " (encore)" : ""}
                  {canWrite && (
                    <form
                      action={removeProgrammeItemAction.bind(null, id, selectedProgramme.id, item.id)}
                      style={{ display: "inline" }}
                    >
                      <button type="submit" className="studio-button--danger">Remove</button>
                    </form>
                  )}
                </li>
              ))}
            </ol>
          )}

          {canWrite && (
            <form
              action={addProgrammeItemAction.bind(null, id, selectedProgramme.id)}
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
      )}
    </div>
  );
}
