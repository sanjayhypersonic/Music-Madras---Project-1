import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../../modules/auth/authService";
import { can } from "../../../../../../../modules/auth/policy";
import { findRecordingById, getCanonicalContextForRevision } from "../../../../../../../modules/db/repositories/recordingRepository";
import { listActiveComposers } from "../../../../../../../modules/db/repositories/composerRepository";
import { listMusicalWorksByComposer } from "../../../../../../../modules/db/repositories/musicalWorkRepository";
import { attachWorkAction, detachWorkAction } from "./actions";

export default async function WorksStepPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;
  const session = await getCurrentStudioSession();
  if (!session) redirect("/studio/signin");

  const recording = await findRecordingById(id);
  if (!recording) redirect("/studio/recordings");

  if (!recording.currentDraftRevisionId) {
    return (
      <div>
        <h2>Composer / Works</h2>
        <p>Open a draft from the Source step before attaching works.</p>
      </div>
    );
  }

  const canWrite = can(session.user.role, "RECORDING_WRITE");
  const [context, composers] = await Promise.all([
    getCanonicalContextForRevision(recording.currentDraftRevisionId),
    listActiveComposers(),
  ]);
  const worksByComposer = await Promise.all(
    composers.map(async (c) => ({ composer: c, works: await listMusicalWorksByComposer(c.id) }))
  );

  return (
    <div>
      <h2>Composer / Works</h2>
      <p>The musical works this specific recording features (this drives the &quot;Musical Works&quot; completeness check).</p>
      {error && <p role="alert" className="studio-alert studio-alert--error">{decodeURIComponent(error)}</p>}

      {context && context.directWorks.length > 0 ? (
        <ul>
          {context.directWorks.map((work) => (
            <li key={work.id}>
              {work.title}
              {canWrite && (
                <form
                  action={detachWorkAction.bind(null, id, recording.currentDraftRevisionId!, work.id)}
                  style={{ display: "inline" }}
                >
                  <button type="submit" className="studio-button--danger">Remove</button>
                </form>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="studio-empty">No works attached yet.</p>
      )}

      {canWrite && (
        <form
          action={attachWorkAction.bind(null, id, recording.currentDraftRevisionId!)}
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
          <button type="submit" className="studio-button--primary">Attach work</button>
        </form>
      )}
    </div>
  );
}
