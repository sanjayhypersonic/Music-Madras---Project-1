"use server";

import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../../modules/auth/authService";
import { can } from "../../../../../../../modules/auth/policy";
import {
  archiveMusicalWork,
  changeMusicalWorkComposer,
  findMusicalWorkById,
  restoreMusicalWork,
  updateMusicalWork,
} from "../../../../../../../modules/db/repositories/musicalWorkRepository";

function errorRedirect(workId: string, message: string): never {
  redirect(`/studio/catalogue/works/${workId}?error=${encodeURIComponent(message)}`);
}

export async function updateWorkAction(workId: string, formData: FormData) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "CATALOGUE_WRITE")) {
    errorRedirect(workId, "You do not have permission to edit this musical work.");
  }

  const title = String(formData.get("title") ?? "").trim();
  const composerId = String(formData.get("composerId") ?? "");
  if (!title || !composerId) {
    errorRedirect(workId, "Title and composer are required.");
  }

  const work = await findMusicalWorkById(workId);
  if (!work) {
    errorRedirect(workId, "This musical work no longer exists.");
  }

  await updateMusicalWork(workId, {
    title,
    catalogueNumber: String(formData.get("catalogueNumber") ?? "") || null,
    keySignature: String(formData.get("keySignature") ?? "") || null,
    language: String(formData.get("language") ?? "") || null,
    notes: String(formData.get("notes") ?? "") || null,
    actorId: session!.user.id,
  });

  // Reassigning the canonical Composer is its own distinct, separately
  // audited operation (brief §21) — only invoked when the picker's value
  // actually changed, never when the same Composer was resubmitted.
  if (composerId !== work!.composerId) {
    try {
      await changeMusicalWorkComposer(workId, composerId, session!.user.id);
    } catch (err) {
      errorRedirect(workId, err instanceof Error ? err.message : "Could not change the composer.");
    }
  }

  redirect(`/studio/catalogue/works/${workId}`);
}

export async function archiveWorkAction(workId: string) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "CATALOGUE_WRITE")) {
    errorRedirect(workId, "You do not have permission to archive this musical work.");
  }

  await archiveMusicalWork(workId, session!.user.id);
  redirect(`/studio/catalogue/works/${workId}`);
}

export async function restoreWorkAction(workId: string) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "CATALOGUE_WRITE")) {
    errorRedirect(workId, "You do not have permission to restore this musical work.");
  }

  await restoreMusicalWork(workId, session!.user.id);
  redirect(`/studio/catalogue/works/${workId}`);
}
