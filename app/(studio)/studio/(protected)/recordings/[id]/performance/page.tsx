import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentStudioSession } from "../../../../../../../modules/auth/authService";
import { can } from "../../../../../../../modules/auth/policy";
import { findRecordingById } from "../../../../../../../modules/db/repositories/recordingRepository";
import { findPerformanceById } from "../../../../../../../modules/db/repositories/performanceRepository";
import { listProgrammes } from "../../../../../../../modules/db/repositories/programmeRepository";
import { listActiveVenues } from "../../../../../../../modules/db/repositories/venueRepository";
import { createPerformanceAction } from "./actions";

export default async function PerformanceStepPage({
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

  if (!recording.currentDraftRevision) {
    return (
      <div>
        <h2>Performance</h2>
        <p>Open a draft from the Source step before setting a performance.</p>
      </div>
    );
  }

  const existingPerformance = recording.currentDraftRevision.performanceId
    ? await findPerformanceById(recording.currentDraftRevision.performanceId)
    : null;

  if (existingPerformance) {
    return (
      <div>
        <h2>Performance</h2>
        <p>
          {existingPerformance.programme.title} at {existingPerformance.venue.name}
          {existingPerformance.performanceDate ? ` on ${existingPerformance.performanceDate.toDateString()}` : ""}
        </p>
        <p>
          <Link href={`/studio/recordings/${id}/participants`}>Manage participants →</Link>
        </p>
      </div>
    );
  }

  const canWrite = can(session.user.role, "RECORDING_WRITE");
  const [programmes, venues] = await Promise.all([listProgrammes(), listActiveVenues()]);

  return (
    <div>
      <h2>Performance</h2>
      <p>Link this recording to the specific concert it was captured at.</p>
      {error && <p style={{ color: "#b00020" }}>{decodeURIComponent(error)}</p>}
      {(programmes.length === 0 || venues.length === 0) && (
        <p>
          You need at least one Programme and one Venue first — see the previous two steps.
        </p>
      )}

      {canWrite && programmes.length > 0 && venues.length > 0 && (
        <form
          action={createPerformanceAction.bind(null, id, recording.currentDraftRevision.updatedAt.toISOString())}
          style={{ display: "flex", flexDirection: "column", gap: "0.5rem", maxWidth: "24rem" }}
        >
          <label>
            Programme
            <select name="programmeId" required style={{ display: "block", width: "100%" }}>
              {programmes.map((programme) => (
                <option key={programme.id} value={programme.id}>
                  {programme.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            Venue
            <select name="venueId" required style={{ display: "block", width: "100%" }}>
              {venues.map((venue) => (
                <option key={venue.id} value={venue.id}>
                  {venue.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Performance date (optional)
            <input type="date" name="performanceDate" style={{ display: "block", width: "100%" }} />
          </label>
          <button type="submit">Create performance</button>
        </form>
      )}
    </div>
  );
}
