import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../modules/auth/authService";
import { can } from "../../../../../../modules/auth/policy";
import { listRightsInformation } from "../../../../../../modules/db/repositories/rightsInformationRepository";

// Phase 6G-13 — the Rights Information catalogue list. RightsInformation
// has no archived state in the existing schema, unlike Composer/Occasion.

export default async function RightsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const session = await getCurrentStudioSession();
  if (!session) redirect("/studio/signin");
  const { q } = await searchParams;

  const records = await listRightsInformation(q);
  const canWrite = can(session.user.role, "CATALOGUE_WRITE");

  return (
    <div>
      <h1>Rights Information</h1>
      <p>
        The rights, permissions, licensing, ownership, or usage restrictions associated with material. Entered and
        maintained by Studio editors only — never inferred automatically.
      </p>

      <form method="get" style={{ margin: "1rem 0" }}>
        <label>
          Search by holder or licence type
          <input type="search" name="q" defaultValue={q ?? ""} style={{ display: "block", width: "100%", maxWidth: "24rem" }} />
        </label>
        <button type="submit" style={{ marginTop: "0.5rem" }}>
          Search
        </button>
        {q && (
          <Link href="/studio/catalogue/rights" style={{ marginLeft: "1rem" }}>
            Clear
          </Link>
        )}
      </form>

      {canWrite && (
        <p>
          <Link href="/studio/catalogue/rights/new">+ New Rights Information</Link>
        </p>
      )}

      {records.length === 0 ? (
        <p>{q ? `No rights information matches "${q}".` : "No rights information has been added yet."}</p>
      ) : (
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>Holder</th>
              <th style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>Licence Type</th>
              <th style={{ borderBottom: "1px solid #ccc" }}></th>
            </tr>
          </thead>
          <tbody>
            {records.map((rights) => (
              <tr key={rights.id}>
                <td style={{ borderBottom: "1px solid #eee", padding: "0.25rem 0" }}>{rights.holder ?? "—"}</td>
                <td style={{ borderBottom: "1px solid #eee" }}>{rights.licenseType ?? "—"}</td>
                <td style={{ borderBottom: "1px solid #eee" }}>
                  <Link href={`/studio/catalogue/rights/${rights.id}`}>Manage</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
