import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../modules/auth/authService";
import { can } from "../../../../../../modules/auth/policy";
import { listConductorsForStudio } from "../../../../../../modules/db/repositories/conductorRepository";

// Phase 6G-4F — the Conductor catalogue list, mirroring the Artist list's shape exactly.

export default async function ConductorsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const session = await getCurrentStudioSession();
  if (!session) redirect("/studio/signin");
  const { q } = await searchParams;

  const conductors = await listConductorsForStudio(q);
  const canWrite = can(session.user.role, "CATALOGUE_WRITE");

  return (
    <div>
      <h1>Conductors</h1>

      <form method="get" style={{ margin: "1rem 0" }}>
        <label>
          Search by name
          <input type="search" name="q" defaultValue={q ?? ""} style={{ display: "block", width: "100%", maxWidth: "24rem" }} />
        </label>
        <button type="submit" style={{ marginTop: "0.5rem" }}>
          Search
        </button>
        {q && (
          <Link href="/studio/catalogue/conductors" style={{ marginLeft: "1rem" }}>
            Clear
          </Link>
        )}
      </form>

      {canWrite && (
        <p>
          <Link href="/studio/catalogue/conductors/new">+ New Conductor</Link>
        </p>
      )}

      {conductors.length === 0 ? (
        <p>{q ? `No conductors match "${q}".` : "No conductors have been added to the MusicMadras archive yet."}</p>
      ) : (
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>Name</th>
              <th style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>Status</th>
              <th style={{ borderBottom: "1px solid #ccc" }}></th>
            </tr>
          </thead>
          <tbody>
            {conductors.map((conductor) => (
              <tr key={conductor.id}>
                <td style={{ padding: "0.4rem 0" }}>{conductor.name}</td>
                <td>{conductor.archivedAt ? "Archived" : "Active"}</td>
                <td>
                  <Link href={`/studio/catalogue/conductors/${conductor.id}`}>Open</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
