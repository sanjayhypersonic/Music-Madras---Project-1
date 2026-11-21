"use server";

import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../../modules/auth/authService";
import { can } from "../../../../../../../modules/auth/policy";
import { createVenue } from "../../../../../../../modules/db/repositories/venueRepository";
import { slugify } from "../../../../../../../modules/mmke/slug/slugify";
import type { VenueType } from "@prisma/client";
import { isCatalogueVenueType } from "../../../../../../../modules/mmke/catalogue/venueTypes";

export async function createVenueForRecordingAction(recordingId: string, formData: FormData) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "CATALOGUE_WRITE")) {
    redirect(`/studio/recordings/${recordingId}/venue?error=You+do+not+have+permission+to+add+venues.`);
  }

  const name = String(formData.get("name") ?? "").trim();
  const type = String(formData.get("type") ?? "") as VenueType;
  if (!name || !isCatalogueVenueType(type)) {
    redirect(`/studio/recordings/${recordingId}/venue?error=Name+and+a+valid+type+are+required.`);
  }

  await createVenue({
    slug: slugify(name),
    name,
    type,
    city: String(formData.get("city") ?? "") || undefined,
    country: String(formData.get("country") ?? "") || undefined,
    actorId: session!.user.id,
  });

  redirect(`/studio/recordings/${recordingId}/venue`);
}
