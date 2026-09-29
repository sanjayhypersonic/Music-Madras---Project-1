import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../../modules/auth/authService";
import { can } from "../../../../../../../modules/auth/policy";
import { findOccasionById } from "../../../../../../../modules/db/repositories/occasionRepository";
import EntityActivity from "../../../../../../../components/studio/EntityActivity";
import { archiveOccasionAction, restoreOccasionAction, updateOccasionAction } from "./actions";

// Phase 6G-12 — the Occasion editorial management view, mirroring the
// established Composer detail-page pattern exactly.

export default async function OccasionDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await getCurrentStudioSession();
  if (!session) redirect("/studio/signin");

  const { id } = await params;
  const { error } = await searchParams;

  const occasion = await findOccasionById(id);
  if (!occasion) {
    notFound();
  }

  const canWrite = can(session.user.role, "CATALOGUE_WRITE");

  return (
    <div>
      <p>
        <Link href="/studio/catalogue/occasions">← Occasions</Link>
      </p>
      <h1>{occasion.name}</h1>
      {error && <p style={{ color: "#b00020" }}>{decodeURIComponent(error)}</p>}

      <p>
        Status: <strong>{occasion.archivedAt ? "Archived" : "Active"}</strong>
        <br />
        Slug: <code>{occasion.slug}</code>
      </p>

      <h2>Edit</h2>
      {canWrite ? (
        <form
          action={updateOccasionAction.bind(null, occasion.id)}
          style={{ display: "flex", flexDirection: "column", gap: "0.5rem", maxWidth: "24rem" }}
        >
          <label>
            Name
            <input name="name" required defaultValue={occasion.name} style={{ display: "block", width: "100%" }} />
          </label>
          <label>
            Description
            <textarea name="description" defaultValue={occasion.description ?? ""} style={{ display: "block", width: "100%" }} />
          </label>
          <button type="submit">Save</button>
        </form>
      ) : (
        <p>You do not have permission to edit this occasion.</p>
      )}

      {canWrite && (
        <div style={{ marginTop: "1rem" }}>
          {!occasion.archivedAt ? (
            <form action={archiveOccasionAction.bind(null, occasion.id)}>
              <button type="submit">Archive</button>
            </form>
          ) : (
            <form action={restoreOccasionAction.bind(null, occasion.id)}>
              <button type="submit">Restore</button>
            </form>
          )}
        </div>
      )}

      <EntityActivity entityType="Occasion" entityId={occasion.id} role={session.user.role} />
    </div>
  );
}
