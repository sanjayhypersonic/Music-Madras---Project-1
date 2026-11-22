"use server";

import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../../modules/auth/authService";
import { can } from "../../../../../../../modules/auth/policy";
import {
  archiveMusicalWork,
  findMusicalWorkById,
  listMusicalWorkComposerIds,
  restoreMusicalWork,
  setMusicalWorkComposers,
  updateMusicalWork,
} from "../../../../../../../modules/db/repositories/musicalWorkRepository";
import { changeComposerOrder, type ComposerOrderChange } from "../../../../../../../modules/mmke/workPage/workCredits";
import { alternateTitlesProblem, parseAlternateTitles } from "../../../../../../../modules/mmke/workPage/alternateTitles";
import { attachSourceToEntity, detachSourceFromEntity } from "../../../../../../../modules/db/repositories/sourceRepository";
import { attachRightsInformationToEntity, detachRightsInformationFromEntity } from "../../../../../../../modules/db/repositories/rightsInformationRepository";

function errorRedirect(workId: string, message: string): never {
  redirect(`/studio/catalogue/works/${workId}?error=${encodeURIComponent(message)}`);
}

export async function updateWorkAction(workId: string, formData: FormData) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "CATALOGUE_WRITE")) {
    errorRedirect(workId, "You do not have permission to edit this musical work.");
  }

  const title = String(formData.get("title") ?? "").trim();
  if (!title) {
    errorRedirect(workId, "Title is required.");
  }

  const work = await findMusicalWorkById(workId);
  if (!work) {
    errorRedirect(workId, "This musical work no longer exists.");
  }

  // R-37: saving rewrites the whole list (one title per line); the audit entry (MUSICAL_WORK_UPDATED) records the list before and after.
  const alternateTitles = parseAlternateTitles(String(formData.get("alternateTitles") ?? ""));
  const alternateProblem = alternateTitlesProblem(alternateTitles);
  if (alternateProblem) errorRedirect(workId, alternateProblem);

  await updateMusicalWork(workId, {
    title,
    alternateTitles,
    catalogueNumber: String(formData.get("catalogueNumber") ?? "") || null,
    keySignature: String(formData.get("keySignature") ?? "") || null,
    language: String(formData.get("language") ?? "") || null,
    notes: String(formData.get("notes") ?? "") || null,
    actorId: session!.user.id,
  });

  redirect(`/studio/catalogue/works/${workId}`);
}

/**
 * R-36: add, remove or move one of the work's composers (musical_work_composers). The first composer is the primary composer
 * (MusicalWork.composerId); each change is its own audited operation (MUSICAL_WORK_COMPOSERS_SET).
 */
async function applyComposerChange(workId: string, change: ComposerOrderChange) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "CATALOGUE_WRITE")) {
    errorRedirect(workId, "You do not have permission to edit this musical work.");
  }
  const next = changeComposerOrder(await listMusicalWorkComposerIds(workId), change);
  if (!next.ok) errorRedirect(workId, next.reason);
  try {
    await setMusicalWorkComposers(workId, next.order, session!.user.id);
  } catch (err) {
    errorRedirect(workId, err instanceof Error ? err.message : "Could not change the composers.");
  }
  redirect(`/studio/catalogue/works/${workId}`);
}

/** Moves a composer up or down, or removes it (bound per composer). */
export async function moveWorkComposerAction(workId: string, kind: "up" | "down" | "remove", composerId: string) {
  await applyComposerChange(workId, { kind, composerId });
}

/** Adds the composer chosen in the form at the end of the list. */
export async function addWorkComposerAction(workId: string, formData: FormData) {
  await applyComposerChange(workId, { kind: "add", composerId: String(formData.get("composerId") ?? "") });
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

export async function attachSourceAction(workId: string, formData: FormData) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "CATALOGUE_WRITE")) {
    errorRedirect(workId, "You do not have permission to edit this musical work.");
  }

  const sourceId = String(formData.get("sourceId") ?? "");
  if (!sourceId) {
    errorRedirect(workId, "Select a source to attach.");
  }

  try {
    await attachSourceToEntity({ entityType: "WORK", entityId: workId, sourceId, actorId: session!.user.id });
  } catch (err) {
    errorRedirect(workId, err instanceof Error ? err.message : "Could not attach the source.");
  }
  redirect(`/studio/catalogue/works/${workId}`);
}

export async function detachSourceAction(workId: string, sourceId: string) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "CATALOGUE_WRITE")) {
    errorRedirect(workId, "You do not have permission to edit this musical work.");
  }

  await detachSourceFromEntity("WORK", workId, sourceId, session!.user.id);
  redirect(`/studio/catalogue/works/${workId}`);
}

export async function attachRightsAction(workId: string, formData: FormData) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "CATALOGUE_WRITE")) {
    errorRedirect(workId, "You do not have permission to edit this musical work.");
  }

  const rightsInformationId = String(formData.get("rightsInformationId") ?? "");
  if (!rightsInformationId) {
    errorRedirect(workId, "Select a rights information record to attach.");
  }

  try {
    await attachRightsInformationToEntity({ entityType: "WORK", entityId: workId, rightsInformationId, actorId: session!.user.id });
  } catch (err) {
    errorRedirect(workId, err instanceof Error ? err.message : "Could not attach the rights information.");
  }
  redirect(`/studio/catalogue/works/${workId}`);
}

export async function detachRightsAction(workId: string, rightsInformationId: string) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "CATALOGUE_WRITE")) {
    errorRedirect(workId, "You do not have permission to edit this musical work.");
  }

  await detachRightsInformationFromEntity("WORK", workId, rightsInformationId, session!.user.id);
  redirect(`/studio/catalogue/works/${workId}`);
}
