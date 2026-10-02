import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../modules/auth/authService";
import { can } from "../../../../../../modules/auth/policy";
import { listVenuesForStudio } from "../../../../../../modules/db/repositories/venueRepository";

// Phase 6G-4E — the Venue catalogue list, mirroring the Composer list's
// shape exactly (search, active/archived, Organisation joined, a
// separate /new route for creation).

export default async function VenuesPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const session = await getCurrentStudioSession();
  if (!session) redirect("/studio/signin");
  const { q } = await searchParams;

  const venues = await listVenuesForStudio(q);
  const canWrite = can(session.user.role, "CATALOGUE_WRITE");

  return (
    <div>
      <h1>Venues / Churches</h1>

      <form method="get" style={{ margin: "1rem 0" }}>
        <label>
          Search by name
          <input type="search" name="q" defaultValue={q ?? ""} style={{ display: "block", width: "100%", maxWidth: "24rem" }} />
        </label>
        <button type="submit" style={{ marginTop: "0.5rem" }}>
          Search
        </button>
        {q && (
          <Link href="/studio/catalogue/venues" style={{ marginLeft: "1rem" }}>
            Clear
          </Link>
        )}
      </form>

      {canWrite && (
        <p>
          <Link href="/studio/catalogue/venues/new">+ New Venue</Link>
        </p>
      )}

      {venues.length === 0 ? (
        <p>{q ? `No venues match "${q}".` : "No venues have been added to the Music Madras archive yet."}</p>
      ) : (
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>Name</th>
              <th style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>Type</th>
              <th style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>Organisation</th>
              <th style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>Status</th>
              <th style={{ borderBottom: "1px solid #ccc" }}></th>
            </tr>
          </thead>
          <tbody>
            {venues.map((venue) => (
              <tr key={venue.id}>
                <td style={{ padding: "0.4rem 0" }}>
                  {venue.name}
                  {venue.city ? `, ${venue.city}` : ""}
                </td>
                <td>{venue.type}</td>
                <td>{venue.organisation?.name ?? "—"}</td>
                <td>{venue.archivedAt ? "Archived" : "Active"}</td>
                <td>
                  <Link href={`/studio/catalogue/venues/${venue.id}`}>Open</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
