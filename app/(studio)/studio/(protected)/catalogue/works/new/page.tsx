import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../../modules/auth/authService";
import { can } from "../../../../../../../modules/auth/policy";
import { listActiveComposers } from "../../../../../../../modules/db/repositories/composerRepository";
import { createWorkAction } from "./actions";

export default async function NewMusicalWorkPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const session = await getCurrentStudioSession();
  if (!session) redirect("/studio/signin");
  if (!can(session.user.role, "CATALOGUE_WRITE")) {
    redirect("/studio/catalogue/works?error=You+do+not+have+permission+to+add+works.");
  }
  const { error } = await searchParams;

  const composers = await listActiveComposers();

  return (
    <div>
      <p>
        <Link href="/studio/catalogue/works">← Musical Works</Link>
      </p>
      <h1>New Musical Work</h1>
      {error && <p role="alert" className="studio-alert studio-alert--error">{decodeURIComponent(error)}</p>}

      {composers.length === 0 ? (
        <p>
          No composers exist yet. <Link href="/studio/catalogue/composers/new">Create a composer</Link> first — a Musical
          Work must be linked to a canonical Composer.
        </p>
      ) : (
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
          <button type="submit" className="studio-button--primary">Create Musical Work</button>
        </form>
      )}
    </div>
  );
}
