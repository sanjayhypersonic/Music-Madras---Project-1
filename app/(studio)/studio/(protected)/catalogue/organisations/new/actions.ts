"use server";

import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../../modules/auth/authService";
import { can } from "../../../../../../../modules/auth/policy";
import { createOrganisation } from "../../../../../../../modules/db/repositories/organisationRepository";
import { DuplicateEntityError } from "../../../../../../../modules/mmke/duplicate-detection/detectDuplicateName";
import { SlugConflictError } from "../../../../../../../modules/mmke/slug/SlugConflictError";
import { slugify } from "../../../../../../../modules/mmke/slug/slugify";

function errorRedirect(message: string): never {
  redirect(`/studio/catalogue/organisations/new?error=${encodeURIComponent(message)}`);
}

export async function createOrganisationAction(formData: FormData) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "CATALOGUE_WRITE")) {
    errorRedirect("You do not have permission to add organisations.");
  }

  const name = String(formData.get("name") ?? "").trim();
  if (!name) {
    errorRedirect("Name is required.");
  }

  let organisation;
  try {
    organisation = await createOrganisation({
      slug: slugify(name),
      name,
      description: String(formData.get("description") ?? "") || undefined,
      actorId: session!.user.id,
    });
  } catch (err) {
    if (err instanceof DuplicateEntityError || err instanceof SlugConflictError) {
      errorRedirect(err.message);
    }
    throw err;
  }

  redirect(`/studio/catalogue/organisations/${organisation.id}`);
}
