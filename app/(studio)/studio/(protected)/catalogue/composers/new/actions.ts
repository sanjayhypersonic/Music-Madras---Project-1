"use server";

import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../../modules/auth/authService";
import { can } from "../../../../../../../modules/auth/policy";
import { createComposer } from "../../../../../../../modules/db/repositories/composerRepository";
import { DuplicateEntityError } from "../../../../../../../modules/mmke/duplicate-detection/detectDuplicateName";
import { SlugConflictError } from "../../../../../../../modules/mmke/slug/SlugConflictError";
import { slugify } from "../../../../../../../modules/mmke/slug/slugify";

function errorRedirect(message: string): never {
  redirect(`/studio/catalogue/composers/new?error=${encodeURIComponent(message)}`);
}

export async function createComposerAction(formData: FormData) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "CATALOGUE_WRITE")) {
    errorRedirect("You do not have permission to add composers.");
  }

  const name = String(formData.get("name") ?? "").trim();
  if (!name) {
    errorRedirect("Name is required.");
  }

  let composer;
  try {
    composer = await createComposer({
      slug: slugify(name),
      name,
      bornDate: String(formData.get("bornDate") ?? "") || undefined,
      diedDate: String(formData.get("diedDate") ?? "") || undefined,
      era: String(formData.get("era") ?? "") || undefined,
      biography: String(formData.get("biography") ?? "") || undefined,
      actorId: session!.user.id,
    });
  } catch (err) {
    if (err instanceof DuplicateEntityError || err instanceof SlugConflictError) {
      errorRedirect(err.message);
    }
    throw err;
  }

  redirect(`/studio/catalogue/composers/${composer.id}`);
}
