import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../../modules/auth/authService";
import { can } from "../../../../../../../modules/auth/policy";
import { findRecordingById, getDraftPerformanceCloneStatus } from "../../../../../../../modules/db/repositories/recordingRepository";
import { findPerformanceById } from "../../../../../../../modules/db/repositories/performanceRepository";
import { listActiveArtists } from "../../../../../../../modules/db/repositories/artistRepository";
import { listActiveChoirs } from "../../../../../../../modules/db/repositories/choirRepository";
import { listActiveConductors } from "../../../../../../../modules/db/repositories/conductorRepository";
import { addPerformerAction, removePerformerAction, addChoirAction, addConductorAction, discardParticipantChangesAction } from "./actions";
import { decodeMessage } from "../../../../../../../modules/studio/decodeMessage";

export default async function ParticipantsStepPage({
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

  const performanceId = recording.currentDraftRevision?.performanceId;
  if (!performanceId) {
    return (
      <div>
        <h2>Participants</h2>
        <p>Set a Performance first — participants are linked to the performance, not the recording directly.</p>
      </div>
    );
  }

  const canWrite = can(session.user.role, "RECORDING_WRITE");
  const [performance, artists, choirs, conductors] = await Promise.all([
    findPerformanceById(performanceId),
    listActiveArtists(),
    listActiveChoirs(),
    listActiveConductors(),
  ]);
  if (!performance) redirect(`/studio/recordings/${id}/performance`);
  const cloneStatus = await getDraftPerformanceCloneStatus(performanceId);

  return (
    <div>
      <h2>Participants</h2>
      {error && <p role="alert" className="studio-alert studio-alert--error">{decodeMessage(error)}</p>}
      {cloneStatus.isClone && (
        <div role="status" className={cloneStatus.originalChanged ? "studio-alert studio-alert--warning" : "studio-notice"}>
          <p>
            {cloneStatus.originalChanged
              ? "The participants of the published performance were changed by someone else after you started editing, so this draft cannot be published as it is. Discard your participant changes below, then re-apply them."
              : "You are editing this draft's own copy of the performance's participants. They go live only when you publish."}
          </p>
          {canWrite && (
            <form action={discardParticipantChangesAction.bind(null, id)}>
              <button type="submit" className={cloneStatus.originalChanged ? "studio-button--primary" : undefined}>
                Discard my participant changes
              </button>
            </form>
          )}
        </div>
      )}

      <h3>Performers</h3>
      <ul>
        {performance.performers.map((link) => (
          <li key={link.artistId}>
            {link.artist.name}
            {link.role ? ` — ${link.role}` : ""}
            {canWrite && (
              <form action={removePerformerAction.bind(null, id, performanceId, link.artistId)} style={{ display: "inline" }}>
                <button type="submit" className="studio-button--danger">Remove</button>
              </form>
            )}
          </li>
        ))}
      </ul>
      {canWrite && (
        <form action={addPerformerAction.bind(null, id, performanceId)} style={{ display: "flex", gap: "0.5rem", maxWidth: "28rem" }}>
          <select name="artistId" required style={{ flex: 1 }}>
            {artists.map((artist) => (
              <option key={artist.id} value={artist.id}>
                {artist.name}
              </option>
            ))}
          </select>
          <input name="role" placeholder="Role (e.g. Soloist)" />
          <button type="submit" className="studio-button--primary">Add</button>
        </form>
      )}

      <h3>Choirs</h3>
      <ul>
        {performance.choirs.map((link) => (
          <li key={link.choirId}>{link.choir.name}</li>
        ))}
      </ul>
      {canWrite && (
        <form action={addChoirAction.bind(null, id, performanceId)} style={{ display: "flex", gap: "0.5rem", maxWidth: "28rem" }}>
          <select name="choirId" required style={{ flex: 1 }}>
            {choirs.map((choir) => (
              <option key={choir.id} value={choir.id}>
                {choir.name}
              </option>
            ))}
          </select>
          <button type="submit" className="studio-button--primary">Add</button>
        </form>
      )}

      <h3>Conductors</h3>
      <ul>
        {performance.conductors.map((link) => (
          <li key={link.conductorId}>{link.conductor.name}</li>
        ))}
      </ul>
      {canWrite && (
        <form action={addConductorAction.bind(null, id, performanceId)} style={{ display: "flex", gap: "0.5rem", maxWidth: "28rem" }}>
          <select name="conductorId" required style={{ flex: 1 }}>
            {conductors.map((conductor) => (
              <option key={conductor.id} value={conductor.id}>
                {conductor.name}
              </option>
            ))}
          </select>
          <button type="submit" className="studio-button--primary">Add</button>
        </form>
      )}
    </div>
  );
}
