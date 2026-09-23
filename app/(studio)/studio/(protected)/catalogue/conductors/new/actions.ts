"use server";

import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../../modules/auth/authService";
import { can } from "../../../../../../../modules/auth/policy";
import { createConductor } from "../../../../../../../modules/db/repositories/conductorRepository";
import { DuplicateEntityError } from "../../../../../../../modules/mmke/duplicate-detection/detectDuplicateName";

function errorRedirect(message: string): never {
  redirect(`/studio/catalogue/conductors/new?error=${encodeURIComponent(message)}`);
}

export async function createConductorAction(formData: FormData) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "CATALOGUE_WRITE")) {
    errorRedirect("You do not have permission to add conductors.");
  }

  const name = String(formData.get("name") ?? "").trim();
  if (!name) {
    errorRedirect("Name is required.");
  }

  let conductor;
  try {
    conductor = await createConductor({
      name,
      biography: String(formData.get("biography") ?? "") || undefined,
      actorId: session!.user.id,
    });
  } catch (err) {
    if (err instanceof DuplicateEntityError) {
      errorRedirect(err.message);
    }
    throw err;
  }

  redirect(`/studio/catalogue/conductors/${conductor.id}`);
}
