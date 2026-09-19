import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../modules/auth/authService";
import { can } from "../../../../../../modules/auth/policy";
import { createArtist, listActiveArtists } from "../../../../../../modules/db/repositories/artistRepository";
import { DuplicateEntityError } from "../../../../../../modules/mmke/duplicate-detection/detectDuplicateName";

export default async function ArtistsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const session = await getCurrentStudioSession();
  if (!session) redirect("/studio/signin");
  const { error } = await searchParams;

  const artists = await listActiveArtists();
  const canWrite = can(session.user.role, "CATALOGUE_WRITE");

  async function createArtistAction(formData: FormData) {
    "use server";
    const session = await getCurrentStudioSession();
    if (!session || !can(session.user.role, "CATALOGUE_WRITE")) {
      redirect("/studio/catalogue/artists?error=You+do+not+have+permission+to+add+artists.");
    }

    const name = String(formData.get("name") ?? "").trim();
    if (!name) redirect("/studio/catalogue/artists?error=Name+is+required.");

    try {
      await createArtist({
        name,
        instrument: String(formData.get("instrument") ?? "") || undefined,
        biography: String(formData.get("biography") ?? "") || undefined,
        actorId: session.user.id,
      });
    } catch (err) {
      if (err instanceof DuplicateEntityError) {
        redirect(`/studio/catalogue/artists?error=${encodeURIComponent(err.message)}`);
      }
      throw err;
    }

    redirect("/studio/catalogue/artists");
  }

  return (
    <div>
      <h1>Artists</h1>
      {error && <p style={{ color: "#b00020" }}>{decodeURIComponent(error)}</p>}
      <ul>
        {artists.map((artist) => (
          <li key={artist.id}>
            {artist.name}
            {artist.instrument ? ` — ${artist.instrument}` : ""}
          </li>
        ))}
      </ul>
      {artists.length === 0 && <p>No artists yet.</p>}

      {canWrite && (
        <>
          <h2>Add an artist</h2>
          <form action={createArtistAction} style={{ display: "flex", flexDirection: "column", gap: "0.5rem", maxWidth: "24rem" }}>
            <label>
              Name
              <input name="name" required style={{ display: "block", width: "100%" }} />
            </label>
            <label>
              Instrument / voice
              <input name="instrument" style={{ display: "block", width: "100%" }} />
            </label>
            <label>
              Biography
              <textarea name="biography" style={{ display: "block", width: "100%" }} />
            </label>
            <button type="submit">Add artist</button>
          </form>
        </>
      )}
    </div>
  );
}
