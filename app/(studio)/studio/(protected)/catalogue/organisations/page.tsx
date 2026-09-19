import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../modules/auth/authService";
import { can } from "../../../../../../modules/auth/policy";
import {
  createOrganisation,
  listActiveOrganisations,
} from "../../../../../../modules/db/repositories/organisationRepository";

export default async function OrganisationsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const session = await getCurrentStudioSession();
  if (!session) redirect("/studio/signin");
  const { error } = await searchParams;

  const organisations = await listActiveOrganisations();
  const canWrite = can(session.user.role, "CATALOGUE_WRITE");

  async function createOrganisationAction(formData: FormData) {
    "use server";
    const session = await getCurrentStudioSession();
    if (!session || !can(session.user.role, "CATALOGUE_WRITE")) {
      redirect("/studio/catalogue/organisations?error=You+do+not+have+permission+to+add+organisations.");
    }

    const name = String(formData.get("name") ?? "").trim();
    if (!name) redirect("/studio/catalogue/organisations?error=Name+is+required.");

    await createOrganisation({
      name,
      description: String(formData.get("description") ?? "") || undefined,
      actorId: session.user.id,
    });

    redirect("/studio/catalogue/organisations");
  }

  return (
    <div>
      <h1>Organisations</h1>
      {error && <p style={{ color: "#b00020" }}>{decodeURIComponent(error)}</p>}
      <ul>
        {organisations.map((organisation) => (
          <li key={organisation.id}>{organisation.name}</li>
        ))}
      </ul>
      {organisations.length === 0 && <p>No organisations yet.</p>}

      {canWrite && (
        <>
          <h2>Add an organisation</h2>
          <form
            action={createOrganisationAction}
            style={{ display: "flex", flexDirection: "column", gap: "0.5rem", maxWidth: "24rem" }}
          >
            <label>
              Name
              <input name="name" required style={{ display: "block", width: "100%" }} />
            </label>
            <label>
              Description
              <textarea name="description" style={{ display: "block", width: "100%" }} />
            </label>
            <button type="submit">Add organisation</button>
          </form>
        </>
      )}
    </div>
  );
}
