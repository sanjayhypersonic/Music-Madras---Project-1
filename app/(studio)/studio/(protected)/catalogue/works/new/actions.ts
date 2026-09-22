"use server";

import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../../modules/auth/authService";
import { can } from "../../../../../../../modules/auth/policy";
import { createMusicalWork } from "../../../../../../../modules/db/repositories/musicalWorkRepository";
import { DuplicateEntityError } from "../../../../../../../modules/mmke/duplicate-detection/detectDuplicateName";
import { SlugConflictError } from "../../../../../../../modules/mmke/slug/SlugConflictError";
import { slugify } from "../../../../../../../modules/mmke/slug/slugify";

function errorRedirect(message: string): never {
  redirect(`/studio/catalogue/works/new?error=${encodeURIComponent(message)}`);
}

export async function createWorkAction(formData: FormData) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "CATALOGUE_WRITE")) {
    errorRedirect("You do not have permission to add musical works.");
  }

  const title = String(formData.get("title") ?? "").trim();
  const composerId = String(formData.get("composerId") ?? "");
  if (!title || !composerId) {
    errorRedirect("Title and composer are required.");
  }

  let work;
  try {
    work = await createMusicalWork({
      slug: slugify(title),
      title,
      composerId,
      catalogueNumber: String(formData.get("catalogueNumber") ?? "") || undefined,
      keySignature: String(formData.get("keySignature") ?? "") || undefined,
      language: String(formData.get("language") ?? "") || undefined,
      notes: String(formData.get("notes") ?? "") || undefined,
      actorId: session!.user.id,
    });
  } catch (err) {
    if (err instanceof DuplicateEntityError || err instanceof SlugConflictError) {
      errorRedirect(err.message);
    }
    throw err;
  }

  redirect(`/studio/catalogue/works/${work.id}`);
}
