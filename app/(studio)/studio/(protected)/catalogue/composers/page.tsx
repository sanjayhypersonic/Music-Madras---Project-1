import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../modules/auth/authService";
import { can } from "../../../../../../modules/auth/policy";
import {
  createComposer,
  listActiveComposers,
} from "../../../../../../modules/db/repositories/composerRepository";
import { DuplicateEntityError } from "../../../../../../modules/mmke/duplicate-detection/detectDuplicateName";
import { slugify } from "../../../../../../modules/mmke/slug/slugify";

export default async function ComposersPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await getCurrentStudioSession();
  if (!session) redirect("/studio/signin");
  const { error } = await searchParams;

  const composers = await listActiveComposers();
  const canWrite = can(session.user.role, "CATALOGUE_WRITE");

  async function createComposerAction(formData: FormData) {
    "use server";
    const session = await getCurrentStudioSession();
    if (!session || !can(session.user.role, "CATALOGUE_WRITE")) {
      redirect("/studio/catalogue/composers?error=You+do+not+have+permission+to+add+composers.");
    }

    const name = String(formData.get("name") ?? "").trim();
    if (!name) {
      redirect("/studio/catalogue/composers?error=Name+is+required.");
    }

    try {
      await createComposer({
        slug: slugify(name),
        name,
        bornDate: String(formData.get("bornDate") ?? "") || undefined,
        diedDate: String(formData.get("diedDate") ?? "") || undefined,
        era: String(formData.get("era") ?? "") || undefined,
        biography: String(formData.get("biography") ?? "") || undefined,
        actorId: session.user.id,
      });
    } catch (err) {
      if (err instanceof DuplicateEntityError) {
        redirect(`/studio/catalogue/composers?error=${encodeURIComponent(err.message)}`);
      }
      throw err;
    }

    redirect("/studio/catalogue/composers");
  }

  return (
    <div>
      <h1>Composers</h1>
      {error && <p style={{ color: "#b00020" }}>{decodeURIComponent(error)}</p>}

      <ul>
        {composers.map((composer) => (
          <li key={composer.id}>
            {composer.name}
            {composer.era ? ` — ${composer.era}` : ""}
          </li>
        ))}
      </ul>
      {composers.length === 0 && <p>No composers yet.</p>}

      {canWrite && (
        <>
          <h2>Add a composer</h2>
          <form action={createComposerAction} style={{ display: "flex", flexDirection: "column", gap: "0.5rem", maxWidth: "24rem" }}>
            <label>
              Name
              <input name="name" required style={{ display: "block", width: "100%" }} />
            </label>
            <label>
              Born (free text, e.g. &quot;1685&quot;)
              <input name="bornDate" style={{ display: "block", width: "100%" }} />
            </label>
            <label>
              Died (free text)
              <input name="diedDate" style={{ display: "block", width: "100%" }} />
            </label>
            <label>
              Era
              <input name="era" style={{ display: "block", width: "100%" }} />
            </label>
            <label>
              Biography
              <textarea name="biography" style={{ display: "block", width: "100%" }} />
            </label>
            <button type="submit">Add composer</button>
          </form>
        </>
      )}
    </div>
  );
}
