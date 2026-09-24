import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../../modules/auth/authService";
import { can } from "../../../../../../../modules/auth/policy";
import { createCollectionAction } from "./actions";

export default async function NewCollectionPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const session = await getCurrentStudioSession();
  if (!session) redirect("/studio/signin");
  if (!can(session.user.role, "CATALOGUE_WRITE")) {
    redirect("/studio/catalogue/collections?error=You+do+not+have+permission+to+add+collections.");
  }
  const { error } = await searchParams;

  return (
    <div>
      <p>
        <Link href="/studio/catalogue/collections">← Collections</Link>
      </p>
      <h1>New Collection</h1>
      {error && <p style={{ color: "#b00020" }}>{decodeURIComponent(error)}</p>}

      <form action={createCollectionAction} style={{ display: "flex", flexDirection: "column", gap: "0.5rem", maxWidth: "24rem" }}>
        <label>
          Title
          <input name="title" required style={{ display: "block", width: "100%" }} />
        </label>
        <label>
          Description
          <textarea name="description" style={{ display: "block", width: "100%" }} />
        </label>
        <button type="submit">Create Collection</button>
      </form>
      <p>New collections start as DRAFT — publish them from the collection once it has recordings.</p>
    </div>
  );
}
