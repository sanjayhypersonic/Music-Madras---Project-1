"use server";

import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../../modules/auth/authService";
import { can } from "../../../../../../../modules/auth/policy";
import {
  addProgrammeItem,
  archiveProgramme,
  removeProgrammeItem,
  reorderProgrammeItem,
  restoreProgramme,
  updateProgramme,
} from "../../../../../../../modules/db/repositories/programmeRepository";

function errorRedirect(programmeId: string, message: string): never {
  redirect(`/studio/catalogue/programmes/${programmeId}?error=${encodeURIComponent(message)}`);
}

export async function updateProgrammeAction(programmeId: string, formData: FormData) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "CATALOGUE_WRITE")) {
    errorRedirect(programmeId, "You do not have permission to edit this programme.");
  }

  const title = String(formData.get("title") ?? "").trim();
  if (!title) {
    errorRedirect(programmeId, "Title is required.");
  }

  await updateProgramme(programmeId, {
    title,
    notes: String(formData.get("notes") ?? "") || null,
    actorId: session!.user.id,
  });

  redirect(`/studio/catalogue/programmes/${programmeId}`);
}

export async function archiveProgrammeAction(programmeId: string) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "CATALOGUE_WRITE")) {
    errorRedirect(programmeId, "You do not have permission to archive this programme.");
  }

  await archiveProgramme(programmeId, session!.user.id);
  redirect(`/studio/catalogue/programmes/${programmeId}`);
}

export async function restoreProgrammeAction(programmeId: string) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "CATALOGUE_WRITE")) {
    errorRedirect(programmeId, "You do not have permission to restore this programme.");
  }

  await restoreProgramme(programmeId, session!.user.id);
  redirect(`/studio/catalogue/programmes/${programmeId}`);
}

export async function addProgrammeItemAction(programmeId: string, formData: FormData) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "CATALOGUE_WRITE")) {
    errorRedirect(programmeId, "You do not have permission to edit this programme.");
  }

  const musicalWorkId = String(formData.get("musicalWorkId") ?? "");
  if (!musicalWorkId) {
    errorRedirect(programmeId, "A work is required.");
  }

  await addProgrammeItem({
    programmeId,
    musicalWorkId,
    movement: String(formData.get("movement") ?? "") || undefined,
    isEncore: formData.get("isEncore") === "on",
    actorId: session!.user.id,
  });

  redirect(`/studio/catalogue/programmes/${programmeId}`);
}

export async function removeProgrammeItemAction(programmeId: string, itemId: string) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "CATALOGUE_WRITE")) {
    errorRedirect(programmeId, "You do not have permission to edit this programme.");
  }

  await removeProgrammeItem(itemId, session!.user.id);
  redirect(`/studio/catalogue/programmes/${programmeId}`);
}

export async function moveProgrammeItemAction(programmeId: string, itemId: string, targetIndex: number) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "CATALOGUE_WRITE")) {
    errorRedirect(programmeId, "You do not have permission to edit this programme.");
  }

  await reorderProgrammeItem(programmeId, itemId, targetIndex, session!.user.id);
  redirect(`/studio/catalogue/programmes/${programmeId}`);
}
