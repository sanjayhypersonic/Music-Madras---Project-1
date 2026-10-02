import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../modules/auth/authService";
import { can } from "../../../../../../modules/auth/policy";
import { listProgrammesForStudio } from "../../../../../../modules/db/repositories/programmeRepository";

// Phase 6G-4G — the Programme catalogue list, mirroring the Composer
// list's shape exactly (search, active/archived, a cheap direct-relation
// item count, a separate /new route for creation). Distinct from the
// existing /studio/recordings/[id]/programme wizard step, which is a
// narrower "pick or create one for this recording" tool — this page is
// for browsing and managing Programmes as canonical catalogue records in
// their own right, independent of any specific recording.

export default async function ProgrammesPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const session = await getCurrentStudioSession();
  if (!session) redirect("/studio/signin");
  const { q } = await searchParams;

  const programmes = await listProgrammesForStudio(q);
  const canWrite = can(session.user.role, "CATALOGUE_WRITE");

  return (
    <div>
      <h1>Programmes</h1>

      <form method="get" style={{ margin: "1rem 0" }}>
        <label>
          Search by title
          <input type="search" name="q" defaultValue={q ?? ""} style={{ display: "block", width: "100%", maxWidth: "24rem" }} />
        </label>
        <button type="submit" style={{ marginTop: "0.5rem" }}>
          Search
        </button>
        {q && (
          <Link href="/studio/catalogue/programmes" style={{ marginLeft: "1rem" }}>
            Clear
          </Link>
        )}
      </form>

      {canWrite && (
        <p>
          <Link href="/studio/catalogue/programmes/new">+ New Programme</Link>
        </p>
      )}

      {programmes.length === 0 ? (
        <p>{q ? `No programmes match "${q}".` : "No programmes have been added to the Music Madras archive yet."}</p>
      ) : (
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>Title</th>
              <th style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>Status</th>
              <th style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>Works</th>
              <th style={{ borderBottom: "1px solid #ccc" }}></th>
            </tr>
          </thead>
          <tbody>
            {programmes.map((programme) => (
              <tr key={programme.id}>
                <td style={{ padding: "0.4rem 0" }}>{programme.title}</td>
                <td>{programme.archivedAt ? "Archived" : "Active"}</td>
                <td>{programme._count.items}</td>
                <td>
                  <Link href={`/studio/catalogue/programmes/${programme.id}`}>Open</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
