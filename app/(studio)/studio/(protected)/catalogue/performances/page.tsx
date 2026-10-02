import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../modules/auth/authService";
import { can } from "../../../../../../modules/auth/policy";
import { listPerformancesForStudio } from "../../../../../../modules/db/repositories/performanceRepository";

// Phase 6G-4H — the Performance catalogue list, mirroring the Programme
// list's shape (search, active/archived, cheap direct-relation counts, a
// separate /new route for creation). A Performance has no name of its own,
// so the table shows its linked Programme and Venue instead.

export default async function PerformancesPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const session = await getCurrentStudioSession();
  if (!session) redirect("/studio/signin");
  const { q } = await searchParams;

  const performances = await listPerformancesForStudio(q);
  const canWrite = can(session.user.role, "CATALOGUE_WRITE");

  return (
    <div>
      <h1>Performances</h1>

      <form method="get" style={{ margin: "1rem 0" }}>
        <label>
          Search by programme or venue
          <input type="search" name="q" defaultValue={q ?? ""} style={{ display: "block", width: "100%", maxWidth: "24rem" }} />
        </label>
        <button type="submit" style={{ marginTop: "0.5rem" }}>
          Search
        </button>
        {q && (
          <Link href="/studio/catalogue/performances" style={{ marginLeft: "1rem" }}>
            Clear
          </Link>
        )}
      </form>

      {canWrite && (
        <p>
          <Link href="/studio/catalogue/performances/new">+ New Performance</Link>
        </p>
      )}

      {performances.length === 0 ? (
        <p>{q ? `No performances match "${q}".` : "No performances have been added to the Music Madras archive yet."}</p>
      ) : (
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>Programme</th>
              <th style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>Venue</th>
              <th style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>Date</th>
              <th style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>Status</th>
              <th style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>Participants</th>
              <th style={{ borderBottom: "1px solid #ccc" }}></th>
            </tr>
          </thead>
          <tbody>
            {performances.map((performance) => (
              <tr key={performance.id}>
                <td style={{ padding: "0.4rem 0" }}>{performance.programme.title}</td>
                <td>{performance.venue.name}</td>
                <td>{performance.performanceDate ? new Date(performance.performanceDate).toLocaleDateString() : "—"}</td>
                <td>{performance.archivedAt ? "Archived" : "Active"}</td>
                <td>
                  {performance._count.performers} artists, {performance._count.choirs} choirs, {performance._count.conductors}{" "}
                  conductors
                </td>
                <td>
                  <Link href={`/studio/catalogue/performances/${performance.id}`}>Open</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
