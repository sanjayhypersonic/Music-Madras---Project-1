import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../../modules/auth/authService";
import { can } from "../../../../../../../modules/auth/policy";
import { findOrganisationById } from "../../../../../../../modules/db/repositories/organisationRepository";
import { listVenuesByOrganisation } from "../../../../../../../modules/db/repositories/venueRepository";
import { archiveOrganisationAction, restoreOrganisationAction, updateOrganisationAction } from "./actions";

// Phase 6G-4E — the Organisation editorial management view.
// Phase 6G-14: Organisation now has a slug and a public
// /organisations/[slug] route — "View public page" mirrors Composer's
// detail page exactly.

export default async function OrganisationDetailPage({
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

  const organisation = await findOrganisationById(id);
  if (!organisation) {
    notFound();
  }

  const canWrite = can(session.user.role, "CATALOGUE_WRITE");
  const venues = await listVenuesByOrganisation(organisation.id);

  return (
    <div>
      <p>
        <Link href="/studio/catalogue/organisations">← Organisations</Link>
      </p>
      <h1>{organisation.name}</h1>
      {error && <p style={{ color: "#b00020" }}>{decodeURIComponent(error)}</p>}

      <p>
        Status: <strong>{organisation.archivedAt ? "Archived" : "Active"}</strong>
        <br />
        Slug: <code>{organisation.slug}</code>
        {!organisation.archivedAt && (
          <>
            {" — "}
            <Link href={`/organisations/${organisation.slug}`} target="_blank" rel="noopener noreferrer">
              View public page
            </Link>
          </>
        )}
      </p>

      <h2>Edit</h2>
      {canWrite ? (
        <form
          action={updateOrganisationAction.bind(null, organisation.id)}
          style={{ display: "flex", flexDirection: "column", gap: "0.5rem", maxWidth: "24rem" }}
        >
          <label>
            Name
            <input name="name" required defaultValue={organisation.name} style={{ display: "block", width: "100%" }} />
          </label>
          <label>
            Description
            <textarea name="description" defaultValue={organisation.description ?? ""} style={{ display: "block", width: "100%" }} />
          </label>
          <button type="submit">Save</button>
        </form>
      ) : (
        <p>You do not have permission to edit this organisation.</p>
      )}

      {canWrite && (
        <div style={{ marginTop: "1rem" }}>
          {!organisation.archivedAt ? (
            <form action={archiveOrganisationAction.bind(null, organisation.id)}>
              <button type="submit">Archive</button>
            </form>
          ) : (
            <form action={restoreOrganisationAction.bind(null, organisation.id)}>
              <button type="submit">Restore</button>
            </form>
          )}
        </div>
      )}

      <h2>Venues ({venues.length})</h2>
      {venues.length > 0 ? (
        <ul>
          {venues.map((venue) => (
            <li key={venue.id}>
              <Link href={`/studio/catalogue/venues/${venue.id}`}>{venue.name}</Link>
              {venue.archivedAt ? " (archived)" : ""}
            </li>
          ))}
        </ul>
      ) : (
        <p>No venues linked to this organisation yet.</p>
      )}
    </div>
  );
}
