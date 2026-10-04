import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../modules/auth/authService";
import { can } from "../../../../../../modules/auth/policy";
import { listLearningGuidesForStudio } from "../../../../../../modules/db/repositories/learningGuideRepository";
import { StatusBadge } from "../../../../../../components/studio/StatusBadge";

// Phase 6G-16 — the Learning Guide catalogue list, mirroring the
// established Occasion list page exactly: every Learning Guide regardless
// of archived state (clearly labelled), a case-insensitive title search,
// and a role-gated "+ New Learning Guide" entry point.

export default async function LearningGuidesPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const session = await getCurrentStudioSession();
  if (!session) redirect("/studio/signin");
  const { q } = await searchParams;

  const guides = await listLearningGuidesForStudio(q);
  const canWrite = can(session.user.role, "CATALOGUE_WRITE");

  return (
    <div>
      <h1>Learning Guides</h1>
      <p>
        A structured educational resource that can be connected to canonical Musical Works and Recordings. Publish a
        guide to make it visible at <Link href="/learning">/learning</Link>.
      </p>

      <form method="get" style={{ margin: "1rem 0" }}>
        <label>
          Search by title
          <input type="search" name="q" defaultValue={q ?? ""} style={{ display: "block", width: "100%", maxWidth: "24rem" }} />
        </label>
        <button type="submit" style={{ marginTop: "0.5rem" }}>
          Search
        </button>
        {q && (
          <Link href="/studio/catalogue/learning-guides" style={{ marginLeft: "1rem" }}>
            Clear
          </Link>
        )}
      </form>

      {canWrite && (
        <p>
          <Link href="/studio/catalogue/learning-guides/new">+ New Learning Guide</Link>
        </p>
      )}

      {guides.length === 0 ? (
        <p>{q ? `No learning guides match "${q}".` : "No learning guides have been added yet."}</p>
      ) : (
        <div className="studio-table-scroll">
<table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left" }}>Title</th>
              <th style={{ textAlign: "left" }}>Lifecycle</th>
              <th style={{ textAlign: "left" }}>Publication</th>
              <th style={{ textAlign: "left" }}>Difficulty</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {guides.map((guide) => (
              <tr key={guide.id}>
                <td style={{ padding: "0.25rem 0" }}>{guide.title}</td>
                <td><StatusBadge status={guide.archivedAt ? "Archived" : "Active"} /></td>
                <td>{guide.status === "PUBLISHED" ? "Published" : "Draft"}</td>
                <td>{guide.difficultyLevel ?? "—"}</td>
                <td>
                  <Link href={`/studio/catalogue/learning-guides/${guide.id}`}>Manage</Link>
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
