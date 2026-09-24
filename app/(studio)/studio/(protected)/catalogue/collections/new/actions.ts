"use server";

import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../../modules/auth/authService";
import { can } from "../../../../../../../modules/auth/policy";
import { createCollection } from "../../../../../../../modules/db/repositories/collectionRepository";
import { SlugConflictError } from "../../../../../../../modules/mmke/slug/SlugConflictError";
import { slugify } from "../../../../../../../modules/mmke/slug/slugify";

function errorRedirect(message: string): never {
  redirect(`/studio/catalogue/collections/new?error=${encodeURIComponent(message)}`);
}

export async function createCollectionAction(formData: FormData) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "CATALOGUE_WRITE")) {
    errorRedirect("You do not have permission to add collections.");
  }

  const title = String(formData.get("title") ?? "").trim();
  if (!title) {
    errorRedirect("Title is required.");
  }

  let collection;
  try {
    collection = await createCollection({
      slug: slugify(title),
      title,
      description: String(formData.get("description") ?? "") || undefined,
      actorId: session!.user.id,
    });
  } catch (err) {
    if (err instanceof SlugConflictError) {
      errorRedirect(err.message);
    }
    throw err;
  }

  redirect(`/studio/catalogue/collections/${collection.id}`);
}
