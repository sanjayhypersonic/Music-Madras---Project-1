import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../modules/auth/authService";
import { can } from "../../../../../../modules/auth/policy";
import { listChoirsForStudio } from "../../../../../../modules/db/repositories/choirRepository";
import { StatusBadge } from "../../../../../../components/studio/StatusBadge";

// Phase 6G-4F — the Choir catalogue list, mirroring the Artist list's shape exactly.

export default async function ChoirsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const session = await getCurrentStudioSession();
  if (!session) redirect("/studio/signin");
  const { q } = await searchParams;

  const choirs = await listChoirsForStudio(q);
  const canWrite = can(session.user.role, "CATALOGUE_WRITE");

  return (
    <div>
      <h1>Choirs</h1>

      <form method="get" style={{ margin: "1rem 0" }}>
        <label>
          Search by name
          <input type="search" name="q" defaultValue={q ?? ""} style={{ display: "block", width: "100%", maxWidth: "24rem" }} />
        </label>
        <button type="submit" style={{ marginTop: "0.5rem" }}>
          Search
        </button>
        {q && (
          <Link href="/studio/catalogue/choirs" style={{ marginLeft: "1rem" }}>
            Clear
          </Link>
        )}
      </form>

      {canWrite && (
        <p>
          <Link href="/studio/catalogue/choirs/new">+ New Choir</Link>
        </p>
      )}

      {choirs.length === 0 ? (
        <p>{q ? `No choirs match "${q}".` : "No choirs have been added to the Music Madras archive yet."}</p>
      ) : (
        <div className="studio-table-scroll">
<table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left" }}>Name</th>
              <th style={{ textAlign: "left" }}>Director</th>
              <th style={{ textAlign: "left" }}>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {choirs.map((choir) => (
              <tr key={choir.id}>
                <td style={{ padding: "0.4rem 0" }}>{choir.name}</td>
                <td>{choir.directorName ?? "—"}</td>
                <td><StatusBadge status={choir.archivedAt ? "Archived" : "Active"} /></td>
                <td>
                  <Link href={`/studio/catalogue/choirs/${choir.id}`}>Open</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
</div>
      )}
    </div>
  );
}
