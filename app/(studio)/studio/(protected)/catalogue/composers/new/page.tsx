import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../../modules/auth/authService";
import { can } from "../../../../../../../modules/auth/policy";
import { createComposerAction } from "./actions";

export default async function NewComposerPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const session = await getCurrentStudioSession();
  if (!session) redirect("/studio/signin");
  if (!can(session.user.role, "CATALOGUE_WRITE")) {
    redirect("/studio/catalogue/composers?error=You+do+not+have+permission+to+add+composers.");
  }
  const { error } = await searchParams;

  return (
    <div>
      <p>
        <Link href="/studio/catalogue/composers">← Composers</Link>
      </p>
      <h1>New Composer</h1>
      {error && <p style={{ color: "#b00020" }}>{decodeURIComponent(error)}</p>}

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
        <button type="submit">Create Composer</button>
      </form>
    </div>
  );
}
