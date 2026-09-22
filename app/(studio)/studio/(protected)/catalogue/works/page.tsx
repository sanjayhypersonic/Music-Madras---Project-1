import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../modules/auth/authService";
import { can } from "../../../../../../modules/auth/policy";
import { listMusicalWorksForStudio } from "../../../../../../modules/db/repositories/musicalWorkRepository";

// Phase 6G-4C — the Musical Work catalogue list, mirroring the Composer
// list's shape exactly (search, active/archived, cheap direct-relation
// counts, a separate /new route for creation).

export default async function MusicalWorksPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const session = await getCurrentStudioSession();
  if (!session) redirect("/studio/signin");
  const { q } = await searchParams;

  const works = await listMusicalWorksForStudio(q);
  const canWrite = can(session.user.role, "CATALOGUE_WRITE");

  return (
    <div>
      <h1>Musical Works</h1>

      <form method="get" style={{ margin: "1rem 0" }}>
        <label>
          Search by title
          <input type="search" name="q" defaultValue={q ?? ""} style={{ display: "block", width: "100%", maxWidth: "24rem" }} />
        </label>
        <button type="submit" style={{ marginTop: "0.5rem" }}>
          Search
        </button>
        {q && (
          <Link href="/studio/catalogue/works" style={{ marginLeft: "1rem" }}>
            Clear
          </Link>
        )}
      </form>

      {canWrite && (
        <p>
          <Link href="/studio/catalogue/works/new">+ New Musical Work</Link>
        </p>
      )}

      {works.length === 0 ? (
        <p>{q ? `No musical works match "${q}".` : "No musical works have been added to the MusicMadras archive yet."}</p>
      ) : (
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>Title</th>
              <th style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>Composer</th>
              <th style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>Status</th>
              <th style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>Programme items</th>
              <th style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>Recordings</th>
              <th style={{ borderBottom: "1px solid #ccc" }}></th>
            </tr>
          </thead>
          <tbody>
            {works.map((work) => (
              <tr key={work.id}>
                <td style={{ padding: "0.4rem 0" }}>{work.title}</td>
                <td>{work.composer.name}</td>
                <td>{work.archivedAt ? "Archived" : "Active"}</td>
                <td>{work._count.programmeItems}</td>
                <td>{work._count.recordingRevisionLinks}</td>
                <td>
                  <Link href={`/studio/catalogue/works/${work.id}`}>Open</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
