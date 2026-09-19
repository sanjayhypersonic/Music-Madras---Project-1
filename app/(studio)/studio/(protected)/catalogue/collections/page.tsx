import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../modules/auth/authService";
import { can } from "../../../../../../modules/auth/policy";
import { createCollection, listCollections } from "../../../../../../modules/db/repositories/collectionRepository";
import { slugify } from "../../../../../../modules/mmke/slug/slugify";

export default async function CollectionsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const session = await getCurrentStudioSession();
  if (!session) redirect("/studio/signin");
  const { error } = await searchParams;

  const collections = await listCollections();
  const canWrite = can(session.user.role, "CATALOGUE_WRITE");

  async function createCollectionAction(formData: FormData) {
    "use server";
    const session = await getCurrentStudioSession();
    if (!session || !can(session.user.role, "CATALOGUE_WRITE")) {
      redirect("/studio/catalogue/collections?error=You+do+not+have+permission+to+add+collections.");
    }

    const title = String(formData.get("title") ?? "").trim();
    if (!title) redirect("/studio/catalogue/collections?error=Title+is+required.");

    await createCollection({
      slug: slugify(title),
      title,
      description: String(formData.get("description") ?? "") || undefined,
      actorId: session.user.id,
    });

    redirect("/studio/catalogue/collections");
  }

  return (
    <div>
      <h1>Collections</h1>
      {error && <p style={{ color: "#b00020" }}>{decodeURIComponent(error)}</p>}
      <ul>
        {collections.map((collection) => (
          <li key={collection.id}>
            {collection.title} — {collection.status}
          </li>
        ))}
      </ul>
      {collections.length === 0 && <p>No collections yet.</p>}

      {canWrite && (
        <>
          <h2>Add a collection</h2>
          <form
            action={createCollectionAction}
            style={{ display: "flex", flexDirection: "column", gap: "0.5rem", maxWidth: "24rem" }}
          >
            <label>
              Title
              <input name="title" required style={{ display: "block", width: "100%" }} />
            </label>
            <label>
              Description
              <textarea name="description" style={{ display: "block", width: "100%" }} />
            </label>
            <button type="submit">Add collection</button>
          </form>
          <p>New collections start as DRAFT — publish them from the collection once it has recordings.</p>
        </>
      )}
    </div>
  );
}
