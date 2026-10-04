import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../modules/auth/authService";
import { can } from "../../../../../../modules/auth/policy";
import { listComposersForStudio } from "../../../../../../modules/db/repositories/composerRepository";
import { StatusBadge } from "../../../../../../components/studio/StatusBadge";

// Phase 6G-4C — the Composer catalogue list. Shows every Composer
// regardless of archived state (clearly labelled), with a cheap
// direct-relation work count and a case-insensitive name search. Create
// now lives at its own /new route; this page is purely the searchable
// list + entry point, per the brief's conceptual three-route shape.

export default async function ComposersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const session = await getCurrentStudioSession();
  if (!session) redirect("/studio/signin");
  const { q } = await searchParams;

  const composers = await listComposersForStudio(q);
  const canWrite = can(session.user.role, "CATALOGUE_WRITE");

  return (
    <div>
      <h1>Composers</h1>

      <form method="get" style={{ margin: "1rem 0" }}>
        <label>
          Search by name
          <input type="search" name="q" defaultValue={q ?? ""} style={{ display: "block", width: "100%", maxWidth: "24rem" }} />
        </label>
        <button type="submit" style={{ marginTop: "0.5rem" }}>
          Search
        </button>
        {q && (
          <Link href="/studio/catalogue/composers" style={{ marginLeft: "1rem" }}>
            Clear
          </Link>
        )}
      </form>

      {canWrite && (
        <p>
          <Link href="/studio/catalogue/composers/new">+ New Composer</Link>
        </p>
      )}

      {composers.length === 0 ? (
        <p>
          {q
            ? `No composers match "${q}".`
            : "No composers have been added to the Music Madras archive yet."}
        </p>
      ) : (
        <div className="studio-table-scroll">
<table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left" }}>Name</th>
              <th style={{ textAlign: "left" }}>Status</th>
              <th style={{ textAlign: "left" }}>Works</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {composers.map((composer) => (
              <tr key={composer.id}>
                <td style={{ padding: "0.4rem 0" }}>{composer.name}</td>
                <td><StatusBadge status={composer.archivedAt ? "Archived" : "Active"} /></td>
                <td>{composer._count.works}</td>
                <td>
                  <Link href={`/studio/catalogue/composers/${composer.id}`}>Open</Link>
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
