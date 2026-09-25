"use server";

import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../../modules/auth/authService";
import { can } from "../../../../../../../modules/auth/policy";
import { addRecordingToCollection } from "../../../../../../../modules/db/repositories/collectionRepository";
import { attachOccasionToEntity, detachOccasionFromEntity } from "../../../../../../../modules/db/repositories/occasionRepository";

export async function addToCollectionAction(recordingId: string, formData: FormData) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "CATALOGUE_WRITE")) {
    redirect(`/studio/recordings/${recordingId}/relationships?error=You+do+not+have+permission.`);
  }

  const collectionId = String(formData.get("collectionId") ?? "");
  if (!collectionId) {
    redirect(`/studio/recordings/${recordingId}/relationships?error=Select+a+collection.`);
  }

  await addRecordingToCollection(collectionId, recordingId, session!.user.id);
  redirect(`/studio/recordings/${recordingId}/relationships`);
}

export async function attachOccasionAction(recordingId: string, formData: FormData) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "CATALOGUE_WRITE")) {
    redirect(`/studio/recordings/${recordingId}/relationships?error=You+do+not+have+permission.`);
  }

  const occasionId = String(formData.get("occasionId") ?? "");
  if (!occasionId) {
    redirect(`/studio/recordings/${recordingId}/relationships?error=Select+an+occasion.`);
  }

  try {
    await attachOccasionToEntity({ entityType: "RECORDING", entityId: recordingId, occasionId, actorId: session!.user.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not attach the occasion.";
    redirect(`/studio/recordings/${recordingId}/relationships?error=${encodeURIComponent(message)}`);
  }
  redirect(`/studio/recordings/${recordingId}/relationships`);
}

export async function detachOccasionAction(recordingId: string, occasionId: string) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "CATALOGUE_WRITE")) {
    redirect(`/studio/recordings/${recordingId}/relationships?error=You+do+not+have+permission.`);
  }

  await detachOccasionFromEntity("RECORDING", recordingId, occasionId, session!.user.id);
  redirect(`/studio/recordings/${recordingId}/relationships`);
}
