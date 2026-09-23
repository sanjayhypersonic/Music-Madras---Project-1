"use server";

import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../../modules/auth/authService";
import { can } from "../../../../../../../modules/auth/policy";
import { archiveChoir, restoreChoir, updateChoir } from "../../../../../../../modules/db/repositories/choirRepository";

function errorRedirect(choirId: string, message: string): never {
  redirect(`/studio/catalogue/choirs/${choirId}?error=${encodeURIComponent(message)}`);
}

export async function updateChoirAction(choirId: string, formData: FormData) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "CATALOGUE_WRITE")) {
    errorRedirect(choirId, "You do not have permission to edit this choir.");
  }

  const name = String(formData.get("name") ?? "").trim();
  if (!name) {
    errorRedirect(choirId, "Name is required.");
  }

  await updateChoir(choirId, {
    name,
    directorName: String(formData.get("directorName") ?? "") || null,
    description: String(formData.get("description") ?? "") || null,
    actorId: session!.user.id,
  });

  redirect(`/studio/catalogue/choirs/${choirId}`);
}

export async function archiveChoirAction(choirId: string) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "CATALOGUE_WRITE")) {
    errorRedirect(choirId, "You do not have permission to archive this choir.");
  }

  await archiveChoir(choirId, session!.user.id);
  redirect(`/studio/catalogue/choirs/${choirId}`);
}

export async function restoreChoirAction(choirId: string) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "CATALOGUE_WRITE")) {
    errorRedirect(choirId, "You do not have permission to restore this choir.");
  }

  await restoreChoir(choirId, session!.user.id);
  redirect(`/studio/catalogue/choirs/${choirId}`);
}
