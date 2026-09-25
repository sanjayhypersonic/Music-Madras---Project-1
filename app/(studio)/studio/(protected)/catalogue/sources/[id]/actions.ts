"use server";

import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../../modules/auth/authService";
import { can } from "../../../../../../../modules/auth/policy";
import { updateSource } from "../../../../../../../modules/db/repositories/sourceRepository";
import { createCitation, updateCitation } from "../../../../../../../modules/db/repositories/citationRepository";

function errorRedirect(sourceId: string, message: string): never {
  redirect(`/studio/catalogue/sources/${sourceId}?error=${encodeURIComponent(message)}`);
}

export async function updateSourceAction(sourceId: string, formData: FormData) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "CATALOGUE_WRITE")) {
    errorRedirect(sourceId, "You do not have permission to edit this source.");
  }

  await updateSource(sourceId, {
    title: String(formData.get("title") ?? "").trim() || null,
    url: String(formData.get("url") ?? "").trim() || null,
    publisher: String(formData.get("publisher") ?? "").trim() || null,
    actorId: session!.user.id,
  });

  redirect(`/studio/catalogue/sources/${sourceId}`);
}

export async function addCitationAction(sourceId: string, formData: FormData) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "CATALOGUE_WRITE")) {
    errorRedirect(sourceId, "You do not have permission to edit this source.");
  }

  const text = String(formData.get("text") ?? "").trim();
  if (!text) {
    errorRedirect(sourceId, "Citation text is required.");
  }

  await createCitation({ text, sourceId, actorId: session!.user.id });
  redirect(`/studio/catalogue/sources/${sourceId}`);
}

export async function updateCitationAction(sourceId: string, citationId: string, formData: FormData) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "CATALOGUE_WRITE")) {
    errorRedirect(sourceId, "You do not have permission to edit this source.");
  }

  await updateCitation(citationId, {
    text: String(formData.get("text") ?? "").trim() || null,
    actorId: session!.user.id,
  });

  redirect(`/studio/catalogue/sources/${sourceId}`);
}
