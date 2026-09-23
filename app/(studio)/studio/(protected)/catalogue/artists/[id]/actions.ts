"use server";

import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../../modules/auth/authService";
import { can } from "../../../../../../../modules/auth/policy";
import { archiveArtist, restoreArtist, updateArtist } from "../../../../../../../modules/db/repositories/artistRepository";

function errorRedirect(artistId: string, message: string): never {
  redirect(`/studio/catalogue/artists/${artistId}?error=${encodeURIComponent(message)}`);
}

export async function updateArtistAction(artistId: string, formData: FormData) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "CATALOGUE_WRITE")) {
    errorRedirect(artistId, "You do not have permission to edit this artist.");
  }

  const name = String(formData.get("name") ?? "").trim();
  if (!name) {
    errorRedirect(artistId, "Name is required.");
  }

  await updateArtist(artistId, {
    name,
    instrument: String(formData.get("instrument") ?? "") || null,
    biography: String(formData.get("biography") ?? "") || null,
    actorId: session!.user.id,
  });

  redirect(`/studio/catalogue/artists/${artistId}`);
}

export async function archiveArtistAction(artistId: string) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "CATALOGUE_WRITE")) {
    errorRedirect(artistId, "You do not have permission to archive this artist.");
  }

  await archiveArtist(artistId, session!.user.id);
  redirect(`/studio/catalogue/artists/${artistId}`);
}

export async function restoreArtistAction(artistId: string) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "CATALOGUE_WRITE")) {
    errorRedirect(artistId, "You do not have permission to restore this artist.");
  }

  await restoreArtist(artistId, session!.user.id);
  redirect(`/studio/catalogue/artists/${artistId}`);
}
