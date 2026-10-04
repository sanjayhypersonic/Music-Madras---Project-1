import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../modules/auth/authService";
import { can } from "../../../../../../modules/auth/policy";
import { listCollectionsForStudio } from "../../../../../../modules/db/repositories/collectionRepository";
import { StatusBadge } from "../../../../../../components/studio/StatusBadge";

// Phase 6G-4I — the Collection catalogue list, mirroring the Programme/
// Performance list's shape exactly (search, active/archived, cheap
// direct-relation counts, linked detail rows, a separate /new route for
// creation). Replaces the Phase-4-era stub that only rendered plain,
// unlinked "title — status" text with no way to reach a specific
// Collection at all.

export default async function CollectionsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const session = await getCurrentStudioSession();
  if (!session) redirect("/studio/signin");
  const { q } = await searchParams;

  const collections = await listCollectionsForStudio(q);
  const canWrite = can(session.user.role, "CATALOGUE_WRITE");

  return (
    <div>
      <h1>Collections</h1>

      <form method="get" style={{ margin: "1rem 0" }}>
        <label>
          Search by title
          <input type="search" name="q" defaultValue={q ?? ""} style={{ display: "block", width: "100%", maxWidth: "24rem" }} />
        </label>
        <button type="submit" style={{ marginTop: "0.5rem" }}>
          Search
        </button>
        {q && (
          <Link href="/studio/catalogue/collections" style={{ marginLeft: "1rem" }}>
            Clear
          </Link>
        )}
      </form>

      {canWrite && (
        <p>
          <Link href="/studio/catalogue/collections/new">+ New Collection</Link>
        </p>
      )}

      {collections.length === 0 ? (
        <p>{q ? `No collections match "${q}".` : "No collections have been added to the Music Madras archive yet."}</p>
      ) : (
        <div className="studio-table-scroll">
<table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left" }}>Title</th>
              <th style={{ textAlign: "left" }}>Publication</th>
              <th style={{ textAlign: "left" }}>Status</th>
              <th style={{ textAlign: "left" }}>Recordings</th>
              <th style={{ textAlign: "left" }}>Works</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {collections.map((collection) => (
              <tr key={collection.id}>
                <td style={{ padding: "0.4rem 0" }}>{collection.title}</td>
                <td><StatusBadge status={collection.status} /></td>
                <td><StatusBadge status={collection.archivedAt ? "Archived" : "Active"} /></td>
                <td>{collection._count.recordingLinks}</td>
                <td>{collection._count.workLinks}</td>
                <td>
                  <Link href={`/studio/catalogue/collections/${collection.id}`}>Open</Link>
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
