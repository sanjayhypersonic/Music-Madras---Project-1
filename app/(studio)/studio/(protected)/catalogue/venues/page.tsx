import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../modules/auth/authService";
import { can } from "../../../../../../modules/auth/policy";
import { createVenue, listActiveVenues } from "../../../../../../modules/db/repositories/venueRepository";
import { listActiveOrganisations } from "../../../../../../modules/db/repositories/organisationRepository";
import { slugify } from "../../../../../../modules/mmke/slug/slugify";
import type { VenueType } from "@prisma/client";

const VENUE_TYPES: VenueType[] = ["CHURCH", "CATHEDRAL", "CONCERT_HALL", "STUDIO", "OUTDOOR"];

export default async function VenuesPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const session = await getCurrentStudioSession();
  if (!session) redirect("/studio/signin");
  const { error } = await searchParams;

  const [venues, organisations] = await Promise.all([listActiveVenues(), listActiveOrganisations()]);
  const canWrite = can(session.user.role, "CATALOGUE_WRITE");

  async function createVenueAction(formData: FormData) {
    "use server";
    const session = await getCurrentStudioSession();
    if (!session || !can(session.user.role, "CATALOGUE_WRITE")) {
      redirect("/studio/catalogue/venues?error=You+do+not+have+permission+to+add+venues.");
    }

    const name = String(formData.get("name") ?? "").trim();
    const type = String(formData.get("type") ?? "") as VenueType;
    if (!name || !VENUE_TYPES.includes(type)) {
      redirect("/studio/catalogue/venues?error=Name+and+a+valid+type+are+required.");
    }
    const organisationId = String(formData.get("organisationId") ?? "") || undefined;

    await createVenue({
      slug: slugify(name),
      name,
      type,
      address: String(formData.get("address") ?? "") || undefined,
      city: String(formData.get("city") ?? "") || undefined,
      country: String(formData.get("country") ?? "") || undefined,
      organisationId,
      actorId: session.user.id,
    });

    redirect("/studio/catalogue/venues");
  }

  return (
    <div>
      <h1>Venues / Churches</h1>
      {error && <p style={{ color: "#b00020" }}>{decodeURIComponent(error)}</p>}
      <ul>
        {venues.map((venue) => (
          <li key={venue.id}>
            {venue.name} — {venue.type}
            {venue.city ? `, ${venue.city}` : ""}
          </li>
        ))}
      </ul>
      {venues.length === 0 && <p>No venues yet.</p>}

      {canWrite && (
        <>
          <h2>Add a venue</h2>
          <form action={createVenueAction} style={{ display: "flex", flexDirection: "column", gap: "0.5rem", maxWidth: "24rem" }}>
            <label>
              Name
              <input name="name" required style={{ display: "block", width: "100%" }} />
            </label>
            <label>
              Type
              <select name="type" required style={{ display: "block", width: "100%" }}>
                {VENUE_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Address
              <input name="address" style={{ display: "block", width: "100%" }} />
            </label>
            <label>
              City
              <input name="city" style={{ display: "block", width: "100%" }} />
            </label>
            <label>
              Country
              <input name="country" style={{ display: "block", width: "100%" }} />
            </label>
            <label>
              Operated by (optional)
              <select name="organisationId" style={{ display: "block", width: "100%" }}>
                <option value="">— none —</option>
                {organisations.map((organisation) => (
                  <option key={organisation.id} value={organisation.id}>
                    {organisation.name}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit">Add venue</button>
          </form>
        </>
      )}
    </div>
  );
}
