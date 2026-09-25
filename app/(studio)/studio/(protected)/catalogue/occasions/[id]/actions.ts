"use server";

import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../../modules/auth/authService";
import { can } from "../../../../../../../modules/auth/policy";
import { archiveOccasion, restoreOccasion, updateOccasion } from "../../../../../../../modules/db/repositories/occasionRepository";

function errorRedirect(occasionId: string, message: string): never {
  redirect(`/studio/catalogue/occasions/${occasionId}?error=${encodeURIComponent(message)}`);
}

export async function updateOccasionAction(occasionId: string, formData: FormData) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "CATALOGUE_WRITE")) {
    errorRedirect(occasionId, "You do not have permission to edit this occasion.");
  }

  const name = String(formData.get("name") ?? "").trim();
  if (!name) {
    errorRedirect(occasionId, "Name is required.");
  }

  await updateOccasion(occasionId, {
    name,
    description: String(formData.get("description") ?? "") || null,
    actorId: session!.user.id,
  });

  redirect(`/studio/catalogue/occasions/${occasionId}`);
}

export async function archiveOccasionAction(occasionId: string) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "CATALOGUE_WRITE")) {
    errorRedirect(occasionId, "You do not have permission to archive this occasion.");
  }

  await archiveOccasion(occasionId, session!.user.id);
  redirect(`/studio/catalogue/occasions/${occasionId}`);
}

export async function restoreOccasionAction(occasionId: string) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "CATALOGUE_WRITE")) {
    errorRedirect(occasionId, "You do not have permission to restore this occasion.");
  }

  await restoreOccasion(occasionId, session!.user.id);
  redirect(`/studio/catalogue/occasions/${occasionId}`);
}
