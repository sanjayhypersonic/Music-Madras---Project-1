import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../modules/auth/authService";
import { can } from "../../../../../../modules/auth/policy";
import { listActiveComposers } from "../../../../../../modules/db/repositories/composerRepository";
import {
  createMusicalWork,
  listMusicalWorksByComposer,
} from "../../../../../../modules/db/repositories/musicalWorkRepository";
import { DuplicateEntityError } from "../../../../../../modules/mmke/duplicate-detection/detectDuplicateName";
import { slugify } from "../../../../../../modules/mmke/slug/slugify";

export default async function MusicalWorksPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await getCurrentStudioSession();
  if (!session) redirect("/studio/signin");
  const { error } = await searchParams;

  const composers = await listActiveComposers();
  const worksByComposer = await Promise.all(
    composers.map(async (composer) => ({ composer, works: await listMusicalWorksByComposer(composer.id) }))
  );
  const canWrite = can(session.user.role, "CATALOGUE_WRITE");

  async function createWorkAction(formData: FormData) {
    "use server";
    const session = await getCurrentStudioSession();
    if (!session || !can(session.user.role, "CATALOGUE_WRITE")) {
      redirect("/studio/catalogue/works?error=You+do+not+have+permission+to+add+works.");
    }

    const title = String(formData.get("title") ?? "").trim();
    const composerId = String(formData.get("composerId") ?? "");
    if (!title || !composerId) {
      redirect("/studio/catalogue/works?error=Title+and+composer+are+required.");
    }

    try {
      await createMusicalWork({
        slug: slugify(title),
        title,
        composerId,
        catalogueNumber: String(formData.get("catalogueNumber") ?? "") || undefined,
        keySignature: String(formData.get("keySignature") ?? "") || undefined,
        language: String(formData.get("language") ?? "") || undefined,
        notes: String(formData.get("notes") ?? "") || undefined,
        actorId: session.user.id,
      });
    } catch (err) {
      if (err instanceof DuplicateEntityError) {
        redirect(`/studio/catalogue/works?error=${encodeURIComponent(err.message)}`);
      }
      throw err;
    }

    redirect("/studio/catalogue/works");
  }

  return (
    <div>
      <h1>Musical Works</h1>
      {error && <p style={{ color: "#b00020" }}>{decodeURIComponent(error)}</p>}

      {composers.length === 0 && <p>Add a composer first.</p>}
      {worksByComposer.map(({ composer, works }) => (
        <div key={composer.id}>
          <h3>{composer.name}</h3>
          {works.length === 0 ? (
            <p>No works yet.</p>
          ) : (
            <ul>
              {works.map((work) => (
                <li key={work.id}>
                  {work.title}
                  {work.catalogueNumber ? ` (${work.catalogueNumber})` : ""}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}

      {canWrite && composers.length > 0 && (
        <>
          <h2>Add a musical work</h2>
          <form action={createWorkAction} style={{ display: "flex", flexDirection: "column", gap: "0.5rem", maxWidth: "24rem" }}>
            <label>
              Composer
              <select name="composerId" required style={{ display: "block", width: "100%" }}>
                {composers.map((composer) => (
                  <option key={composer.id} value={composer.id}>
                    {composer.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Title
              <input name="title" required style={{ display: "block", width: "100%" }} />
            </label>
            <label>
              Catalogue number (e.g. &quot;BWV 232&quot;)
              <input name="catalogueNumber" style={{ display: "block", width: "100%" }} />
            </label>
            <label>
              Key signature
              <input name="keySignature" style={{ display: "block", width: "100%" }} />
            </label>
            <label>
              Language
              <input name="language" style={{ display: "block", width: "100%" }} />
            </label>
            <label>
              Notes
              <textarea name="notes" style={{ display: "block", width: "100%" }} />
            </label>
            <button type="submit">Add work</button>
          </form>
        </>
      )}
    </div>
  );
}
