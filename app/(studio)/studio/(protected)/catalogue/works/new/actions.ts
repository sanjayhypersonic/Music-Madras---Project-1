"use server";

import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../../modules/auth/authService";
import { can } from "../../../../../../../modules/auth/policy";
import { createMusicalWork } from "../../../../../../../modules/db/repositories/musicalWorkRepository";
import { DuplicateEntityError } from "../../../../../../../modules/mmke/duplicate-detection/detectDuplicateName";
import { SlugConflictError } from "../../../../../../../modules/mmke/slug/SlugConflictError";
import { slugify } from "../../../../../../../modules/mmke/slug/slugify";
import { alternateTitlesProblem, parseAlternateTitles } from "../../../../../../../modules/mmke/workPage/alternateTitles";

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

  // R-37: one title per line; trimmed, blanks dropped, case-insensitive repeats dropped, original script and transliterations kept as typed.
  const alternateTitles = parseAlternateTitles(String(formData.get("alternateTitles") ?? ""));
  const alternateProblem = alternateTitlesProblem(alternateTitles);
  if (alternateProblem) errorRedirect(alternateProblem);

  let work;
  try {
    work = await createMusicalWork({
      slug: slugify(title),
      title,
      alternateTitles,
      composerId,
      // R-36: optional co-composers, in the order of the form's fields (empty ones and repeats of the primary are ignored).
      coComposerIds: formData.getAll("coComposerId").map(String).filter((id) => id && id !== composerId),
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
