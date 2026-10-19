"use server";

import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../../modules/auth/authService";
import { can } from "../../../../../../../modules/auth/policy";
import type { StudioRoleName } from "../../../../../../../modules/auth/types";
import { ProgrammeBusyError, ProgrammeInPublishedContentError, createProgramme, addProgrammeItem, removeProgrammeItem } from "../../../../../../../modules/db/repositories/programmeRepository";
import { slugify } from "../../../../../../../modules/mmke/slug/slugify";

function requireCatalogueWrite(role: StudioRoleName | undefined, recordingId: string) {
  if (!role || !can(role, "CATALOGUE_WRITE")) {
    redirect(`/studio/recordings/${recordingId}/programme?error=You+do+not+have+permission+to+edit+programmes.`);
  }
}

export async function createProgrammeAction(recordingId: string, formData: FormData) {
  const session = await getCurrentStudioSession();
  requireCatalogueWrite(session?.user.role, recordingId);

  const title = String(formData.get("title") ?? "").trim();
  if (!title) {
    redirect(`/studio/recordings/${recordingId}/programme?error=Title+is+required.`);
  }

  const programme = await createProgramme({
    slug: slugify(`${title}-${Date.now().toString(36)}`),
    title,
    notes: String(formData.get("notes") ?? "") || undefined,
    actorId: session!.user.id,
  });

  redirect(`/studio/recordings/${recordingId}/programme?programmeId=${programme.id}`);
}

export async function addProgrammeItemAction(recordingId: string, programmeId: string, formData: FormData) {
  const session = await getCurrentStudioSession();
  requireCatalogueWrite(session?.user.role, recordingId);

  const musicalWorkId = String(formData.get("musicalWorkId") ?? "");
  if (!musicalWorkId) {
    redirect(`/studio/recordings/${recordingId}/programme?programmeId=${programmeId}&error=Select+a+work.`);
  }

  // 6J-10F: the Recording workflow must not change a Programme that published content already shows.
  try {
    await addProgrammeItem({
      programmeId,
      musicalWorkId,
      movement: String(formData.get("movement") ?? "") || undefined,
      isEncore: formData.get("isEncore") === "on",
      actorId: session!.user.id,
      refuseIfInPublishedContent: true,
    });
  } catch (error) {
    if (error instanceof ProgrammeInPublishedContentError || error instanceof ProgrammeBusyError) {
      redirect(`/studio/recordings/${recordingId}/programme?programmeId=${programmeId}&error=${encodeURIComponent(error.message)}`);
    }
    throw error;
  }

  redirect(`/studio/recordings/${recordingId}/programme?programmeId=${programmeId}`);
}

export async function removeProgrammeItemAction(recordingId: string, programmeId: string, itemId: string) {
  const session = await getCurrentStudioSession();
  requireCatalogueWrite(session?.user.role, recordingId);

  try {
    await removeProgrammeItem(itemId, session!.user.id, { refuseIfInPublishedContent: true });
  } catch (error) {
    if (error instanceof ProgrammeInPublishedContentError || error instanceof ProgrammeBusyError) {
      redirect(`/studio/recordings/${recordingId}/programme?programmeId=${programmeId}&error=${encodeURIComponent(error.message)}`);
    }
    throw error;
  }
  redirect(`/studio/recordings/${recordingId}/programme?programmeId=${programmeId}`);
}
