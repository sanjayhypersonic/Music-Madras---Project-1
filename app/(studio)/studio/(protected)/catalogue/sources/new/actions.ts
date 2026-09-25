"use server";

import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../../modules/auth/authService";
import { can } from "../../../../../../../modules/auth/policy";
import { createSource } from "../../../../../../../modules/db/repositories/sourceRepository";

function errorRedirect(message: string): never {
  redirect(`/studio/catalogue/sources/new?error=${encodeURIComponent(message)}`);
}

export async function createSourceAction(formData: FormData) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "CATALOGUE_WRITE")) {
    errorRedirect("You do not have permission to add sources.");
  }

  const title = String(formData.get("title") ?? "").trim() || undefined;
  const url = String(formData.get("url") ?? "").trim() || undefined;
  const publisher = String(formData.get("publisher") ?? "").trim() || undefined;
  if (!title && !url && !publisher) {
    errorRedirect("Provide at least a title, URL, or publisher.");
  }

  let source;
  try {
    source = await createSource({ title, url, publisher, actorId: session!.user.id });
  } catch (err) {
    errorRedirect(err instanceof Error ? err.message : "Could not create the source.");
  }

  redirect(`/studio/catalogue/sources/${source!.id}`);
}
