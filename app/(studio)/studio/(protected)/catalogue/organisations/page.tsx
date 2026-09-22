import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../modules/auth/authService";
import { can } from "../../../../../../modules/auth/policy";
import { listOrganisationsForStudio } from "../../../../../../modules/db/repositories/organisationRepository";

// Phase 6G-4E — the Organisation catalogue list, mirroring the Composer
// list's shape exactly (search, active/archived, a cheap direct-relation
// Venue count, a separate /new route for creation).

export default async function OrganisationsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const session = await getCurrentStudioSession();
  if (!session) redirect("/studio/signin");
  const { q } = await searchParams;

  const organisations = await listOrganisationsForStudio(q);
  const canWrite = can(session.user.role, "CATALOGUE_WRITE");

  return (
    <div>
      <h1>Organisations</h1>

      <form method="get" style={{ margin: "1rem 0" }}>
        <label>
          Search by name
          <input type="search" name="q" defaultValue={q ?? ""} style={{ display: "block", width: "100%", maxWidth: "24rem" }} />
        </label>
        <button type="submit" style={{ marginTop: "0.5rem" }}>
          Search
        </button>
        {q && (
          <Link href="/studio/catalogue/organisations" style={{ marginLeft: "1rem" }}>
            Clear
          </Link>
        )}
      </form>

      {canWrite && (
        <p>
          <Link href="/studio/catalogue/organisations/new">+ New Organisation</Link>
        </p>
      )}

      {organisations.length === 0 ? (
        <p>{q ? `No organisations match "${q}".` : "No organisations have been added to the MusicMadras archive yet."}</p>
      ) : (
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>Name</th>
              <th style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>Status</th>
              <th style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>Venues</th>
              <th style={{ borderBottom: "1px solid #ccc" }}></th>
            </tr>
          </thead>
          <tbody>
            {organisations.map((organisation) => (
              <tr key={organisation.id}>
                <td style={{ padding: "0.4rem 0" }}>{organisation.name}</td>
                <td>{organisation.archivedAt ? "Archived" : "Active"}</td>
                <td>{organisation._count.venues}</td>
                <td>
                  <Link href={`/studio/catalogue/organisations/${organisation.id}`}>Open</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
