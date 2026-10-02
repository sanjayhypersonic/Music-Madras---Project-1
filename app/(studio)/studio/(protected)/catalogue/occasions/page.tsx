import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../modules/auth/authService";
import { can } from "../../../../../../modules/auth/policy";
import { listOccasionsForStudio } from "../../../../../../modules/db/repositories/occasionRepository";

// Phase 6G-12 — the Occasion catalogue list, mirroring the established
// Composer list page exactly: every Occasion regardless of archived state
// (clearly labelled), a case-insensitive name search, and a role-gated
// "+ New Occasion" entry point.

export default async function OccasionsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const session = await getCurrentStudioSession();
  if (!session) redirect("/studio/signin");
  const { q } = await searchParams;

  const occasions = await listOccasionsForStudio(q);
  const canWrite = can(session.user.role, "CATALOGUE_WRITE");

  return (
    <div>
      <h1>Occasions</h1>
      <p>
        A canonical cultural, liturgical, ceremonial, seasonal, or contextual circumstance (Christmas, Easter, a
        Wedding, ...) that a Programme, Performance, Recording, or Collection can be attached to. Distinct from a
        Collection — see each Occasion&apos;s own record for details.
      </p>

      <form method="get" style={{ margin: "1rem 0" }}>
        <label>
          Search by name
          <input type="search" name="q" defaultValue={q ?? ""} style={{ display: "block", width: "100%", maxWidth: "24rem" }} />
        </label>
        <button type="submit" style={{ marginTop: "0.5rem" }}>
          Search
        </button>
        {q && (
          <Link href="/studio/catalogue/occasions" style={{ marginLeft: "1rem" }}>
            Clear
          </Link>
        )}
      </form>

      {canWrite && (
        <p>
          <Link href="/studio/catalogue/occasions/new">+ New Occasion</Link>
        </p>
      )}

      {occasions.length === 0 ? (
        <p>{q ? `No occasions match "${q}".` : "No occasions have been added to the Music Madras archive yet."}</p>
      ) : (
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>Name</th>
              <th style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>Status</th>
              <th style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>Description</th>
              <th style={{ borderBottom: "1px solid #ccc" }}></th>
            </tr>
          </thead>
          <tbody>
            {occasions.map((occasion) => (
              <tr key={occasion.id}>
                <td style={{ borderBottom: "1px solid #eee", padding: "0.25rem 0" }}>{occasion.name}</td>
                <td style={{ borderBottom: "1px solid #eee" }}>{occasion.archivedAt ? "Archived" : "Active"}</td>
                <td style={{ borderBottom: "1px solid #eee" }}>{occasion.description ?? "—"}</td>
                <td style={{ borderBottom: "1px solid #eee" }}>
                  <Link href={`/studio/catalogue/occasions/${occasion.id}`}>Manage</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
