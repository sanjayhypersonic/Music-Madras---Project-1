"use server";

import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../../modules/auth/authService";
import { can } from "../../../../../../../modules/auth/policy";
import { createRightsInformation } from "../../../../../../../modules/db/repositories/rightsInformationRepository";

function errorRedirect(message: string): never {
  redirect(`/studio/catalogue/rights/new?error=${encodeURIComponent(message)}`);
}

export async function createRightsInformationAction(formData: FormData) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "CATALOGUE_WRITE")) {
    errorRedirect("You do not have permission to add rights information.");
  }

  const holder = String(formData.get("holder") ?? "").trim() || undefined;
  const licenseType = String(formData.get("licenseType") ?? "").trim() || undefined;
  const notes = String(formData.get("notes") ?? "").trim() || undefined;
  if (!holder && !licenseType && !notes) {
    errorRedirect("Provide at least a holder, licence type, or notes.");
  }

  const rights = await createRightsInformation({ holder, licenseType, notes, actorId: session!.user.id });
  redirect(`/studio/catalogue/rights/${rights.id}`);
}
