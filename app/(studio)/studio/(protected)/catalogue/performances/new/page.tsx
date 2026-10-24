import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../../modules/auth/authService";
import { can } from "../../../../../../../modules/auth/policy";
import { listProgrammesForStudio } from "../../../../../../../modules/db/repositories/programmeRepository";
import { listVenuesForStudio } from "../../../../../../../modules/db/repositories/venueRepository";
import { createPerformanceAction } from "./actions";
import { decodeMessage } from "../../../../../../../modules/studio/decodeMessage";

export default async function NewPerformancePage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const session = await getCurrentStudioSession();
  if (!session) redirect("/studio/signin");
  if (!can(session.user.role, "CATALOGUE_WRITE")) {
    redirect("/studio/catalogue/performances?error=You+do+not+have+permission+to+add+performances.");
  }
  const { error } = await searchParams;

  const [programmes, venues] = await Promise.all([listProgrammesForStudio(), listVenuesForStudio()]);

  return (
    <div>
      <p>
        <Link href="/studio/catalogue/performances">← Performances</Link>
      </p>
      <h1>New Performance</h1>
      {error && <p role="alert" className="studio-alert studio-alert--error">{decodeMessage(error)}</p>}

      {programmes.length === 0 || venues.length === 0 ? (
        <p>
          A Performance needs both a canonical Programme and a Venue.{" "}
          {programmes.length === 0 && (
            <>
              <Link href="/studio/catalogue/programmes/new">Create a programme</Link>{" "}
            </>
          )}
          {venues.length === 0 && <Link href="/studio/catalogue/venues/new">Create a venue</Link>} first.
        </p>
      ) : (
        <form action={createPerformanceAction} style={{ display: "flex", flexDirection: "column", gap: "0.5rem", maxWidth: "24rem" }}>
          <label>
            Programme
            <select name="programmeId" required style={{ display: "block", width: "100%" }}>
              {programmes.map((programme) => (
                <option key={programme.id} value={programme.id}>
                  {programme.title}
                  {programme.archivedAt ? " (archived)" : ""}
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
                  {venue.archivedAt ? " (archived)" : ""}
                </option>
              ))}
            </select>
          </label>
          <label>
            Performance date (optional)
            <input type="date" name="performanceDate" style={{ display: "block", width: "100%" }} />
          </label>
          <button type="submit" className="studio-button--primary">Create Performance</button>
        </form>
      )}
    </div>
  );
}
