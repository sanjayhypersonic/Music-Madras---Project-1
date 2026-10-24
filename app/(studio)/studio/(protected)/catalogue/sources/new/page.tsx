import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../../modules/auth/authService";
import { can } from "../../../../../../../modules/auth/policy";
import { createSourceAction } from "./actions";
import { decodeMessage } from "../../../../../../../modules/studio/decodeMessage";

export default async function NewSourcePage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const session = await getCurrentStudioSession();
  if (!session) redirect("/studio/signin");
  if (!can(session.user.role, "CATALOGUE_WRITE")) {
    redirect("/studio/catalogue/sources?error=You+do+not+have+permission+to+add+sources.");
  }
  const { error } = await searchParams;

  return (
    <div>
      <p>
        <Link href="/studio/catalogue/sources">← Sources</Link>
      </p>
      <h1>New Source</h1>
      {error && <p role="alert" className="studio-alert studio-alert--error">{decodeMessage(error)}</p>}

      <form action={createSourceAction} style={{ display: "flex", flexDirection: "column", gap: "0.5rem", maxWidth: "24rem" }}>
        <label>
          Title (optional)
          <input name="title" style={{ display: "block", width: "100%" }} />
        </label>
        <label>
          URL (optional)
          <input name="url" type="url" style={{ display: "block", width: "100%" }} />
        </label>
        <label>
          Publisher (optional)
          <input name="publisher" style={{ display: "block", width: "100%" }} />
        </label>
        <button type="submit" className="studio-button--primary">Create Source</button>
      </form>
    </div>
  );
}
