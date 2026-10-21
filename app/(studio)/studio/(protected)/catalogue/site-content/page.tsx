import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../modules/auth/authService";
import { listEditorialBlocksForStudio, type EditorialBlockState } from "../../../../../../modules/db/repositories/editorialContentRepository";

// Phase 6K-1 — the site-level editorial content blocks (homepage introduction and story, footer tagline, section introductions,
// site SEO). The list of blocks comes from the code registry (where each block can appear); the words are stored content with a
// draft/publish lifecycle. A block that is not published renders nothing on the public site.

const STATE_LABEL: Record<EditorialBlockState, string> = {
  NOT_CREATED: "Not created",
  DRAFT: "Draft (never published)",
  PUBLISHED: "Published",
  PUBLISHED_WITH_CHANGES: "Published — newer draft not yet published",
  UNPUBLISHED: "Unpublished (taken down)",
};

export default async function SiteContentPage() {
  const session = await getCurrentStudioSession();
  if (!session || session.user.status !== "ACTIVE") redirect("/studio/signin");
  const blocks = await listEditorialBlocksForStudio();

  return (
    <div>
      <p>
        <Link href="/studio/catalogue">← Catalogue</Link>
      </p>
      <h1>Site content</h1>
      <p>
        Editable copy for the public Museum. Editing a draft never changes the live site: only publishing does, and publishing needs the right to publish. A block that has not been
        published is simply not shown.
      </p>
      <div className="studio-table-scroll">
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid var(--mm-border)" }}>
              <th>Block</th>
              <th>Where it appears</th>
              <th>State</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {blocks.map(({ definition, state }) => (
              <tr key={definition.slug} style={{ borderBottom: "1px solid var(--mm-border)" }}>
                <td>
                  <strong>{definition.label}</strong>
                  <br />
                  <span>{definition.purpose}</span>
                </td>
                <td>{definition.usedOn}</td>
                <td>{STATE_LABEL[state]}</td>
                <td>
                  <Link href={`/studio/catalogue/site-content/${definition.slug}`}>{state === "NOT_CREATED" ? "Start" : "Open"}</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
