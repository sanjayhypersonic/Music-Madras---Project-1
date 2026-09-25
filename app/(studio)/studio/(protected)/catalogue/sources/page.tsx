import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../modules/auth/authService";
import { can } from "../../../../../../modules/auth/policy";
import { listSources } from "../../../../../../modules/db/repositories/sourceRepository";

// Phase 6G-13 — the Source catalogue list. Source has no archived state
// in the existing schema, so there is no "Active/Archived" column here,
// unlike Composer/Occasion.

export default async function SourcesPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const session = await getCurrentStudioSession();
  if (!session) redirect("/studio/signin");
  const { q } = await searchParams;

  const sources = await listSources(q);
  const canWrite = can(session.user.role, "CATALOGUE_WRITE");

  return (
    <div>
      <h1>Sources</h1>
      <p>Where information or material originated from. Distinct from Citations (specific evidence, held under each Source) and Rights Information (permissions/licensing).</p>

      <form method="get" style={{ margin: "1rem 0" }}>
        <label>
          Search by title, URL, or publisher
          <input type="search" name="q" defaultValue={q ?? ""} style={{ display: "block", width: "100%", maxWidth: "24rem" }} />
        </label>
        <button type="submit" style={{ marginTop: "0.5rem" }}>
          Search
        </button>
        {q && (
          <Link href="/studio/catalogue/sources" style={{ marginLeft: "1rem" }}>
            Clear
          </Link>
        )}
      </form>

      {canWrite && (
        <p>
          <Link href="/studio/catalogue/sources/new">+ New Source</Link>
        </p>
      )}

      {sources.length === 0 ? (
        <p>{q ? `No sources match "${q}".` : "No sources have been added yet."}</p>
      ) : (
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>Title</th>
              <th style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>Publisher</th>
              <th style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>URL</th>
              <th style={{ borderBottom: "1px solid #ccc" }}></th>
            </tr>
          </thead>
          <tbody>
            {sources.map((source) => (
              <tr key={source.id}>
                <td style={{ borderBottom: "1px solid #eee", padding: "0.25rem 0" }}>{source.title ?? "—"}</td>
                <td style={{ borderBottom: "1px solid #eee" }}>{source.publisher ?? "—"}</td>
                <td style={{ borderBottom: "1px solid #eee" }}>{source.url ?? "—"}</td>
                <td style={{ borderBottom: "1px solid #eee" }}>
                  <Link href={`/studio/catalogue/sources/${source.id}`}>Manage</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
