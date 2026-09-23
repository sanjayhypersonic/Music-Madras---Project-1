"use server";

import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../../modules/auth/authService";
import { can } from "../../../../../../../modules/auth/policy";
import { createChoir } from "../../../../../../../modules/db/repositories/choirRepository";
import { DuplicateEntityError } from "../../../../../../../modules/mmke/duplicate-detection/detectDuplicateName";

function errorRedirect(message: string): never {
  redirect(`/studio/catalogue/choirs/new?error=${encodeURIComponent(message)}`);
}

export async function createChoirAction(formData: FormData) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "CATALOGUE_WRITE")) {
    errorRedirect("You do not have permission to add choirs.");
  }

  const name = String(formData.get("name") ?? "").trim();
  if (!name) {
    errorRedirect("Name is required.");
  }

  let choir;
  try {
    choir = await createChoir({
      name,
      directorName: String(formData.get("directorName") ?? "") || undefined,
      description: String(formData.get("description") ?? "") || undefined,
      actorId: session!.user.id,
    });
  } catch (err) {
    if (err instanceof DuplicateEntityError) {
      errorRedirect(err.message);
    }
    throw err;
  }

  redirect(`/studio/catalogue/choirs/${choir.id}`);
}
