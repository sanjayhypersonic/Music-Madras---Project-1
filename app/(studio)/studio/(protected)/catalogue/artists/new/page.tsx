import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../../modules/auth/authService";
import { can } from "../../../../../../../modules/auth/policy";
import { createArtistAction } from "./actions";
import { decodeMessage } from "../../../../../../../modules/studio/decodeMessage";

export default async function NewArtistPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const session = await getCurrentStudioSession();
  if (!session) redirect("/studio/signin");
  if (!can(session.user.role, "CATALOGUE_WRITE")) {
    redirect("/studio/catalogue/artists?error=You+do+not+have+permission+to+add+artists.");
  }
  const { error } = await searchParams;

  return (
    <div>
      <p>
        <Link href="/studio/catalogue/artists">← Artists</Link>
      </p>
      <h1>New Artist</h1>
      {error && <p role="alert" className="studio-alert studio-alert--error">{decodeMessage(error)}</p>}

      <form action={createArtistAction} style={{ display: "flex", flexDirection: "column", gap: "0.5rem", maxWidth: "24rem" }}>
        <label>
          Name
          <input name="name" required style={{ display: "block", width: "100%" }} />
        </label>
        <label>
          Instrument
          <input name="instrument" style={{ display: "block", width: "100%" }} />
        </label>
        <label>
          Biography
          <textarea name="biography" style={{ display: "block", width: "100%" }} />
        </label>
        <button type="submit" className="studio-button--primary">Create Artist</button>
      </form>
    </div>
  );
}
