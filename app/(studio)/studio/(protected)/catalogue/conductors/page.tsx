import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../modules/auth/authService";
import { can } from "../../../../../../modules/auth/policy";
import {
  createConductor,
  listActiveConductors,
} from "../../../../../../modules/db/repositories/conductorRepository";
import { DuplicateEntityError } from "../../../../../../modules/mmke/duplicate-detection/detectDuplicateName";

export default async function ConductorsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const session = await getCurrentStudioSession();
  if (!session) redirect("/studio/signin");
  const { error } = await searchParams;

  const conductors = await listActiveConductors();
  const canWrite = can(session.user.role, "CATALOGUE_WRITE");

  async function createConductorAction(formData: FormData) {
    "use server";
    const session = await getCurrentStudioSession();
    if (!session || !can(session.user.role, "CATALOGUE_WRITE")) {
      redirect("/studio/catalogue/conductors?error=You+do+not+have+permission+to+add+conductors.");
    }

    const name = String(formData.get("name") ?? "").trim();
    if (!name) redirect("/studio/catalogue/conductors?error=Name+is+required.");

    try {
      await createConductor({
        name,
        biography: String(formData.get("biography") ?? "") || undefined,
        actorId: session.user.id,
      });
    } catch (err) {
      if (err instanceof DuplicateEntityError) {
        redirect(`/studio/catalogue/conductors?error=${encodeURIComponent(err.message)}`);
      }
      throw err;
    }

    redirect("/studio/catalogue/conductors");
  }

  return (
    <div>
      <h1>Conductors</h1>
      {error && <p style={{ color: "#b00020" }}>{decodeURIComponent(error)}</p>}
      <ul>
        {conductors.map((conductor) => (
          <li key={conductor.id}>{conductor.name}</li>
        ))}
      </ul>
      {conductors.length === 0 && <p>No conductors yet.</p>}

      {canWrite && (
        <>
          <h2>Add a conductor</h2>
          <form action={createConductorAction} style={{ display: "flex", flexDirection: "column", gap: "0.5rem", maxWidth: "24rem" }}>
            <label>
              Name
              <input name="name" required style={{ display: "block", width: "100%" }} />
            </label>
            <label>
              Biography
              <textarea name="biography" style={{ display: "block", width: "100%" }} />
            </label>
            <button type="submit">Add conductor</button>
          </form>
        </>
      )}
    </div>
  );
}
