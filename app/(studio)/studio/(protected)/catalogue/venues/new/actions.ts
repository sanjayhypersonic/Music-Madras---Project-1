"use server";

import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../../modules/auth/authService";
import { can } from "../../../../../../../modules/auth/policy";
import { createVenue } from "../../../../../../../modules/db/repositories/venueRepository";
import { DuplicateEntityError } from "../../../../../../../modules/mmke/duplicate-detection/detectDuplicateName";
import { SlugConflictError } from "../../../../../../../modules/mmke/slug/SlugConflictError";
import { slugify } from "../../../../../../../modules/mmke/slug/slugify";
import type { VenueType } from "@prisma/client";

const VENUE_TYPES: VenueType[] = ["CHURCH", "CATHEDRAL", "CONCERT_HALL", "STUDIO", "OUTDOOR"];

function errorRedirect(message: string): never {
  redirect(`/studio/catalogue/venues/new?error=${encodeURIComponent(message)}`);
}

export async function createVenueAction(formData: FormData) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "CATALOGUE_WRITE")) {
    errorRedirect("You do not have permission to add venues.");
  }

  const name = String(formData.get("name") ?? "").trim();
  const type = String(formData.get("type") ?? "") as VenueType;
  if (!name || !VENUE_TYPES.includes(type)) {
    errorRedirect("Name and a valid type are required.");
  }
  const organisationId = String(formData.get("organisationId") ?? "") || undefined;

  let venue;
  try {
    venue = await createVenue({
      slug: slugify(name),
      name,
      type,
      address: String(formData.get("address") ?? "") || undefined,
      city: String(formData.get("city") ?? "") || undefined,
      country: String(formData.get("country") ?? "") || undefined,
      organisationId,
      actorId: session!.user.id,
    });
  } catch (err) {
    if (err instanceof DuplicateEntityError || err instanceof SlugConflictError) {
      errorRedirect(err.message);
    }
    throw err;
  }

  redirect(`/studio/catalogue/venues/${venue.id}`);
}
