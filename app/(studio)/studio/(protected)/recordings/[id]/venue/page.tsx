import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../../modules/auth/authService";
import { can, describeRolesThatCan } from "../../../../../../../modules/auth/policy";
import { ReadOnlyStepNotice } from "../../../../../../../components/studio/ReadOnlyStepNotice";
import { listActiveVenues } from "../../../../../../../modules/db/repositories/venueRepository";
import { createVenueForRecordingAction } from "./actions";
import type { VenueType } from "@prisma/client";
import { decodeMessage } from "../../../../../../../modules/studio/decodeMessage";

const VENUE_TYPES: VenueType[] = ["CHURCH", "CATHEDRAL", "CONCERT_HALL", "STUDIO", "OUTDOOR"];

export default async function VenueStepPage({
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

  const venues = await listActiveVenues();
  const canWrite = can(session.user.role, "CATALOGUE_WRITE");

  return (
    <div>
      <h2>Venue</h2>
      <p>
        Ensure the church or venue for this recording&apos;s performance exists — you will select it in the
        Performance step next.
      </p>
      {error && <p role="alert" className="studio-alert studio-alert--error">{decodeMessage(error)}</p>}

      <ul>
        {venues.map((venue) => (
          <li key={venue.id}>
            {venue.name} — {venue.type}
            {venue.city ? `, ${venue.city}` : ""}
          </li>
        ))}
      </ul>
      {venues.length === 0 && <p className="studio-empty">No venues yet.</p>}

      {!canWrite && <ReadOnlyStepNotice roles={describeRolesThatCan("CATALOGUE_WRITE")} what="add venues" />}
      {canWrite && (
        <form
          action={createVenueForRecordingAction.bind(null, id)}
          style={{ display: "flex", flexDirection: "column", gap: "0.5rem", maxWidth: "24rem" }}
        >
          <label>
            Name
            <input name="name" required style={{ display: "block", width: "100%" }} />
          </label>
          <label>
            Type
            <select name="type" required style={{ display: "block", width: "100%" }}>
              {VENUE_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </label>
          <label>
            City
            <input name="city" style={{ display: "block", width: "100%" }} />
          </label>
          <label>
            Country
            <input name="country" style={{ display: "block", width: "100%" }} />
          </label>
          <button type="submit" className="studio-button--primary">Add venue</button>
        </form>
      )}
    </div>
  );
}
