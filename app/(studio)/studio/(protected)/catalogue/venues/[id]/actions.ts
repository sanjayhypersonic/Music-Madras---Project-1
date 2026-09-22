"use server";

import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../../modules/auth/authService";
import { can } from "../../../../../../../modules/auth/policy";
import {
  archiveVenue,
  findVenueById,
  linkVenueToOrganisation,
  restoreVenue,
  updateVenue,
} from "../../../../../../../modules/db/repositories/venueRepository";
import type { VenueType } from "@prisma/client";

const VENUE_TYPES: VenueType[] = ["CHURCH", "CATHEDRAL", "CONCERT_HALL", "STUDIO", "OUTDOOR"];

function errorRedirect(venueId: string, message: string): never {
  redirect(`/studio/catalogue/venues/${venueId}?error=${encodeURIComponent(message)}`);
}

export async function updateVenueAction(venueId: string, formData: FormData) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "CATALOGUE_WRITE")) {
    errorRedirect(venueId, "You do not have permission to edit this venue.");
  }

  const name = String(formData.get("name") ?? "").trim();
  const type = String(formData.get("type") ?? "") as VenueType;
  if (!name || !VENUE_TYPES.includes(type)) {
    errorRedirect(venueId, "Name and a valid type are required.");
  }

  const venue = await findVenueById(venueId);
  if (!venue) {
    errorRedirect(venueId, "This venue no longer exists.");
  }

  await updateVenue(venueId, {
    name,
    type,
    address: String(formData.get("address") ?? "") || null,
    city: String(formData.get("city") ?? "") || null,
    country: String(formData.get("country") ?? "") || null,
    actorId: session!.user.id,
  });

  // Reassigning (or clearing) the Organisation is its own distinct,
  // separately audited operation (VENUE_LINKED_TO_ORGANISATION /
  // VENUE_UNLINKED_FROM_ORGANISATION) — only invoked when the picker's
  // value actually changed, never when the same value was resubmitted.
  const newOrganisationId = String(formData.get("organisationId") ?? "") || null;
  if (newOrganisationId !== venue!.organisationId) {
    await linkVenueToOrganisation(venueId, newOrganisationId, session!.user.id);
  }

  redirect(`/studio/catalogue/venues/${venueId}`);
}

export async function archiveVenueAction(venueId: string) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "CATALOGUE_WRITE")) {
    errorRedirect(venueId, "You do not have permission to archive this venue.");
  }

  await archiveVenue(venueId, session!.user.id);
  redirect(`/studio/catalogue/venues/${venueId}`);
}

export async function restoreVenueAction(venueId: string) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "CATALOGUE_WRITE")) {
    errorRedirect(venueId, "You do not have permission to restore this venue.");
  }

  await restoreVenue(venueId, session!.user.id);
  redirect(`/studio/catalogue/venues/${venueId}`);
}
