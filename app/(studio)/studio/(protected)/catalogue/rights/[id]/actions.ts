"use server";

import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../../modules/auth/authService";
import { can } from "../../../../../../../modules/auth/policy";
import { updateRightsInformation } from "../../../../../../../modules/db/repositories/rightsInformationRepository";

function errorRedirect(rightsId: string, message: string): never {
  redirect(`/studio/catalogue/rights/${rightsId}?error=${encodeURIComponent(message)}`);
}

export async function updateRightsInformationAction(rightsId: string, formData: FormData) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "CATALOGUE_WRITE")) {
    errorRedirect(rightsId, "You do not have permission to edit this rights information.");
  }

  await updateRightsInformation(rightsId, {
    holder: String(formData.get("holder") ?? "").trim() || null,
    licenseType: String(formData.get("licenseType") ?? "").trim() || null,
    notes: String(formData.get("notes") ?? "").trim() || null,
    actorId: session!.user.id,
  });

  redirect(`/studio/catalogue/rights/${rightsId}`);
}
