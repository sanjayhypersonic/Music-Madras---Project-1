"use server";

import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../../modules/auth/authService";
import { can } from "../../../../../../../modules/auth/policy";
import { archiveConductor, restoreConductor, updateConductor } from "../../../../../../../modules/db/repositories/conductorRepository";

function errorRedirect(conductorId: string, message: string): never {
  redirect(`/studio/catalogue/conductors/${conductorId}?error=${encodeURIComponent(message)}`);
}

export async function updateConductorAction(conductorId: string, formData: FormData) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "CATALOGUE_WRITE")) {
    errorRedirect(conductorId, "You do not have permission to edit this conductor.");
  }

  const name = String(formData.get("name") ?? "").trim();
  if (!name) {
    errorRedirect(conductorId, "Name is required.");
  }

  await updateConductor(conductorId, {
    name,
    biography: String(formData.get("biography") ?? "") || null,
    actorId: session!.user.id,
  });

  redirect(`/studio/catalogue/conductors/${conductorId}`);
}

export async function archiveConductorAction(conductorId: string) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "CATALOGUE_WRITE")) {
    errorRedirect(conductorId, "You do not have permission to archive this conductor.");
  }

  await archiveConductor(conductorId, session!.user.id);
  redirect(`/studio/catalogue/conductors/${conductorId}`);
}

export async function restoreConductorAction(conductorId: string) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "CATALOGUE_WRITE")) {
    errorRedirect(conductorId, "You do not have permission to restore this conductor.");
  }

  await restoreConductor(conductorId, session!.user.id);
  redirect(`/studio/catalogue/conductors/${conductorId}`);
}
