import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../modules/auth/authService";
import { can } from "../../../../../../modules/auth/policy";
import { createChoir, listActiveChoirs } from "../../../../../../modules/db/repositories/choirRepository";
import { DuplicateEntityError } from "../../../../../../modules/mmke/duplicate-detection/detectDuplicateName";

export default async function ChoirsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const session = await getCurrentStudioSession();
  if (!session) redirect("/studio/signin");
  const { error } = await searchParams;

  const choirs = await listActiveChoirs();
  const canWrite = can(session.user.role, "CATALOGUE_WRITE");

  async function createChoirAction(formData: FormData) {
    "use server";
    const session = await getCurrentStudioSession();
    if (!session || !can(session.user.role, "CATALOGUE_WRITE")) {
      redirect("/studio/catalogue/choirs?error=You+do+not+have+permission+to+add+choirs.");
    }

    const name = String(formData.get("name") ?? "").trim();
    if (!name) redirect("/studio/catalogue/choirs?error=Name+is+required.");

    try {
      await createChoir({
        name,
        directorName: String(formData.get("directorName") ?? "") || undefined,
        description: String(formData.get("description") ?? "") || undefined,
        actorId: session.user.id,
      });
    } catch (err) {
      if (err instanceof DuplicateEntityError) {
        redirect(`/studio/catalogue/choirs?error=${encodeURIComponent(err.message)}`);
      }
      throw err;
    }

    redirect("/studio/catalogue/choirs");
  }

  return (
    <div>
      <h1>Choirs</h1>
      {error && <p style={{ color: "#b00020" }}>{decodeURIComponent(error)}</p>}
      <ul>
        {choirs.map((choir) => (
          <li key={choir.id}>
            {choir.name}
            {choir.directorName ? ` — director: ${choir.directorName}` : ""}
          </li>
        ))}
      </ul>
      {choirs.length === 0 && <p>No choirs yet.</p>}

      {canWrite && (
        <>
          <h2>Add a choir</h2>
          <form action={createChoirAction} style={{ display: "flex", flexDirection: "column", gap: "0.5rem", maxWidth: "24rem" }}>
            <label>
              Name
              <input name="name" required style={{ display: "block", width: "100%" }} />
            </label>
            <label>
              Director
              <input name="directorName" style={{ display: "block", width: "100%" }} />
            </label>
            <label>
              Description
              <textarea name="description" style={{ display: "block", width: "100%" }} />
            </label>
            <button type="submit">Add choir</button>
          </form>
        </>
      )}
    </div>
  );
}
