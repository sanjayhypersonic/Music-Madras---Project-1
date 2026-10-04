import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../../modules/auth/authService";
import { can } from "../../../../../../../modules/auth/policy";
import { listActiveOrganisations } from "../../../../../../../modules/db/repositories/organisationRepository";
import { createVenueAction } from "./actions";
import type { VenueType } from "@prisma/client";

const VENUE_TYPES: VenueType[] = ["CHURCH", "CATHEDRAL", "CONCERT_HALL", "STUDIO", "OUTDOOR"];

export default async function NewVenuePage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const session = await getCurrentStudioSession();
  if (!session) redirect("/studio/signin");
  if (!can(session.user.role, "CATALOGUE_WRITE")) {
    redirect("/studio/catalogue/venues?error=You+do+not+have+permission+to+add+venues.");
  }
  const { error } = await searchParams;

  const organisations = await listActiveOrganisations();

  return (
    <div>
      <p>
        <Link href="/studio/catalogue/venues">← Venues</Link>
      </p>
      <h1>New Venue</h1>
      {error && <p role="alert" className="studio-alert studio-alert--error">{decodeURIComponent(error)}</p>}

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
        <button type="submit" className="studio-button--primary">Create Venue</button>
      </form>
    </div>
  );
}
