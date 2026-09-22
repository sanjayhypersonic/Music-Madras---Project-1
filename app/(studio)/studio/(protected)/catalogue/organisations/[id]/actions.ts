"use server";

import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../../modules/auth/authService";
import { can } from "../../../../../../../modules/auth/policy";
import {
  archiveOrganisation,
  restoreOrganisation,
  updateOrganisation,
} from "../../../../../../../modules/db/repositories/organisationRepository";

function errorRedirect(organisationId: string, message: string): never {
  redirect(`/studio/catalogue/organisations/${organisationId}?error=${encodeURIComponent(message)}`);
}

export async function updateOrganisationAction(organisationId: string, formData: FormData) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "CATALOGUE_WRITE")) {
    errorRedirect(organisationId, "You do not have permission to edit this organisation.");
  }

  const name = String(formData.get("name") ?? "").trim();
  if (!name) {
    errorRedirect(organisationId, "Name is required.");
  }

  await updateOrganisation(organisationId, {
    name,
    description: String(formData.get("description") ?? "") || null,
    actorId: session!.user.id,
  });

  redirect(`/studio/catalogue/organisations/${organisationId}`);
}

export async function archiveOrganisationAction(organisationId: string) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "CATALOGUE_WRITE")) {
    errorRedirect(organisationId, "You do not have permission to archive this organisation.");
  }

  await archiveOrganisation(organisationId, session!.user.id);
  redirect(`/studio/catalogue/organisations/${organisationId}`);
}

export async function restoreOrganisationAction(organisationId: string) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "CATALOGUE_WRITE")) {
    errorRedirect(organisationId, "You do not have permission to restore this organisation.");
  }

  await restoreOrganisation(organisationId, session!.user.id);
  redirect(`/studio/catalogue/organisations/${organisationId}`);
}
