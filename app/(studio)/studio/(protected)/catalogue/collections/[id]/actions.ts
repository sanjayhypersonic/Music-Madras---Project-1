"use server";

import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../../modules/auth/authService";
import { can } from "../../../../../../../modules/auth/policy";
import {
  addMusicalWorkToCollection,
  addRecordingToCollection,
  archiveCollection,
  publishCollection,
  reorderCollectionRecordings,
  reorderCollectionWorks,
  removeMusicalWorkFromCollection,
  removeRecordingFromCollection,
  restoreCollection,
  unpublishCollection,
  updateCollection,
} from "../../../../../../../modules/db/repositories/collectionRepository";
import { attachOccasionToEntity, detachOccasionFromEntity } from "../../../../../../../modules/db/repositories/occasionRepository";

function errorRedirect(collectionId: string, message: string): never {
  redirect(`/studio/catalogue/collections/${collectionId}?error=${encodeURIComponent(message)}`);
}

export async function updateCollectionAction(collectionId: string, formData: FormData) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "CATALOGUE_WRITE")) {
    errorRedirect(collectionId, "You do not have permission to edit this collection.");
  }

  const title = String(formData.get("title") ?? "").trim();
  if (!title) {
    errorRedirect(collectionId, "Title is required.");
  }

  await updateCollection(collectionId, {
    title,
    description: String(formData.get("description") ?? "") || null,
    actorId: session!.user.id,
  });

  redirect(`/studio/catalogue/collections/${collectionId}`);
}

export async function publishCollectionAction(collectionId: string) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "CATALOGUE_WRITE")) {
    errorRedirect(collectionId, "You do not have permission to publish this collection.");
  }

  await publishCollection(collectionId, session!.user.id);
  redirect(`/studio/catalogue/collections/${collectionId}`);
}

export async function unpublishCollectionAction(collectionId: string) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "CATALOGUE_WRITE")) {
    errorRedirect(collectionId, "You do not have permission to unpublish this collection.");
  }

  await unpublishCollection(collectionId, session!.user.id);
  redirect(`/studio/catalogue/collections/${collectionId}`);
}

export async function archiveCollectionAction(collectionId: string) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "CATALOGUE_WRITE")) {
    errorRedirect(collectionId, "You do not have permission to archive this collection.");
  }

  await archiveCollection(collectionId, session!.user.id);
  redirect(`/studio/catalogue/collections/${collectionId}`);
}

export async function restoreCollectionAction(collectionId: string) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "CATALOGUE_WRITE")) {
    errorRedirect(collectionId, "You do not have permission to restore this collection.");
  }

  await restoreCollection(collectionId, session!.user.id);
  redirect(`/studio/catalogue/collections/${collectionId}`);
}

export async function attachOccasionAction(collectionId: string, formData: FormData) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "CATALOGUE_WRITE")) {
    errorRedirect(collectionId, "You do not have permission to edit this collection.");
  }

  const occasionId = String(formData.get("occasionId") ?? "");
  if (!occasionId) {
    errorRedirect(collectionId, "Select an occasion to attach.");
  }

  try {
    await attachOccasionToEntity({ entityType: "COLLECTION", entityId: collectionId, occasionId, actorId: session!.user.id });
  } catch (err) {
    errorRedirect(collectionId, err instanceof Error ? err.message : "Could not attach the occasion.");
  }
  redirect(`/studio/catalogue/collections/${collectionId}`);
}

export async function detachOccasionAction(collectionId: string, occasionId: string) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "CATALOGUE_WRITE")) {
    errorRedirect(collectionId, "You do not have permission to edit this collection.");
  }

  await detachOccasionFromEntity("COLLECTION", collectionId, occasionId, session!.user.id);
  redirect(`/studio/catalogue/collections/${collectionId}`);
}

export async function addRecordingAction(collectionId: string, formData: FormData) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "CATALOGUE_WRITE")) {
    errorRedirect(collectionId, "You do not have permission to edit this collection.");
  }

  const recordingId = String(formData.get("recordingId") ?? "");
  if (!recordingId) {
    errorRedirect(collectionId, "Select a recording to add.");
  }

  await addRecordingToCollection(collectionId, recordingId, session!.user.id);
  redirect(`/studio/catalogue/collections/${collectionId}`);
}

export async function removeRecordingAction(collectionId: string, recordingId: string) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "CATALOGUE_WRITE")) {
    errorRedirect(collectionId, "You do not have permission to edit this collection.");
  }

  await removeRecordingFromCollection(collectionId, recordingId, session!.user.id);
  redirect(`/studio/catalogue/collections/${collectionId}`);
}

export async function moveRecordingAction(collectionId: string, recordingId: string, targetIndex: number) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "CATALOGUE_WRITE")) {
    errorRedirect(collectionId, "You do not have permission to edit this collection.");
  }

  await reorderCollectionRecordings(collectionId, recordingId, targetIndex, session!.user.id);
  redirect(`/studio/catalogue/collections/${collectionId}`);
}

export async function addWorkAction(collectionId: string, formData: FormData) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "CATALOGUE_WRITE")) {
    errorRedirect(collectionId, "You do not have permission to edit this collection.");
  }

  const musicalWorkId = String(formData.get("musicalWorkId") ?? "");
  if (!musicalWorkId) {
    errorRedirect(collectionId, "Select a musical work to add.");
  }

  await addMusicalWorkToCollection(collectionId, musicalWorkId, session!.user.id);
  redirect(`/studio/catalogue/collections/${collectionId}`);
}

export async function removeWorkAction(collectionId: string, musicalWorkId: string) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "CATALOGUE_WRITE")) {
    errorRedirect(collectionId, "You do not have permission to edit this collection.");
  }

  await removeMusicalWorkFromCollection(collectionId, musicalWorkId, session!.user.id);
  redirect(`/studio/catalogue/collections/${collectionId}`);
}

export async function moveWorkAction(collectionId: string, musicalWorkId: string, targetIndex: number) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "CATALOGUE_WRITE")) {
    errorRedirect(collectionId, "You do not have permission to edit this collection.");
  }

  await reorderCollectionWorks(collectionId, musicalWorkId, targetIndex, session!.user.id);
  redirect(`/studio/catalogue/collections/${collectionId}`);
}
