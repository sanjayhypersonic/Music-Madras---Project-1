import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../modules/auth/authService";
import { can } from "../../../../../../modules/auth/policy";
import { listArtistsForStudio } from "../../../../../../modules/db/repositories/artistRepository";
import { StatusBadge } from "../../../../../../components/studio/StatusBadge";

// Phase 6G-4F — the Artist catalogue list, mirroring the Organisation
// list's shape exactly (search, active/archived, a separate /new route
// for creation).

export default async function ArtistsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const session = await getCurrentStudioSession();
  if (!session) redirect("/studio/signin");
  const { q } = await searchParams;

  const artists = await listArtistsForStudio(q);
  const canWrite = can(session.user.role, "CATALOGUE_WRITE");

  return (
    <div>
      <h1>Artists</h1>

      <form method="get" style={{ margin: "1rem 0" }}>
        <label>
          Search by name
          <input type="search" name="q" defaultValue={q ?? ""} style={{ display: "block", width: "100%", maxWidth: "24rem" }} />
        </label>
        <button type="submit" style={{ marginTop: "0.5rem" }}>
          Search
        </button>
        {q && (
          <Link href="/studio/catalogue/artists" style={{ marginLeft: "1rem" }}>
            Clear
          </Link>
        )}
      </form>

      {canWrite && (
        <p>
          <Link href="/studio/catalogue/artists/new">+ New Artist</Link>
        </p>
      )}

      {artists.length === 0 ? (
        <p>{q ? `No artists match "${q}".` : "No artists have been added to the Music Madras archive yet."}</p>
      ) : (
        <div className="studio-table-scroll">
<table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left" }}>Name</th>
              <th style={{ textAlign: "left" }}>Instrument</th>
              <th style={{ textAlign: "left" }}>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {artists.map((artist) => (
              <tr key={artist.id}>
                <td style={{ padding: "0.4rem 0" }}>{artist.name}</td>
                <td>{artist.instrument ?? "—"}</td>
                <td><StatusBadge status={artist.archivedAt ? "Archived" : "Active"} /></td>
                <td>
                  <Link href={`/studio/catalogue/artists/${artist.id}`}>Open</Link>
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
