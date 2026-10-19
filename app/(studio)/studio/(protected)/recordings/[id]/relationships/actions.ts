"use server";

import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../../modules/auth/authService";
import { can } from "../../../../../../../modules/auth/policy";
import { CollectionMembershipPublishRequiredError, addRecordingToCollection } from "../../../../../../../modules/db/repositories/collectionRepository";
import { attachOccasionToEntity, detachOccasionFromEntity } from "../../../../../../../modules/db/repositories/occasionRepository";
import { attachSourceToEntity, detachSourceFromEntity } from "../../../../../../../modules/db/repositories/sourceRepository";
import { attachRightsInformationToEntity, detachRightsInformationFromEntity } from "../../../../../../../modules/db/repositories/rightsInformationRepository";

export async function addToCollectionAction(recordingId: string, formData: FormData) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "CATALOGUE_WRITE")) {
    redirect(`/studio/recordings/${recordingId}/relationships?error=You+do+not+have+permission.`);
  }

  const collectionId = String(formData.get("collectionId") ?? "");
  if (!collectionId) {
    redirect(`/studio/recordings/${recordingId}/relationships?error=Select+a+collection.`);
  }

  // Phase 6J-12A: a change that is visible to visitors at once (published Collection + published Recording) needs RECORDING_PUBLISH.
  try {
    await addRecordingToCollection(collectionId, recordingId, session!.user.id, { canPublish: can(session!.user.role, "RECORDING_PUBLISH") });
  } catch (err) {
    if (err instanceof CollectionMembershipPublishRequiredError) {
      redirect(`/studio/recordings/${recordingId}/relationships?error=${encodeURIComponent(err.message)}`);
    }
    throw err;
  }
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

export async function attachSourceAction(recordingId: string, formData: FormData) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "CATALOGUE_WRITE")) {
    redirect(`/studio/recordings/${recordingId}/relationships?error=You+do+not+have+permission.`);
  }

  const sourceId = String(formData.get("sourceId") ?? "");
  if (!sourceId) {
    redirect(`/studio/recordings/${recordingId}/relationships?error=Select+a+source.`);
  }

  try {
    await attachSourceToEntity({ entityType: "RECORDING", entityId: recordingId, sourceId, actorId: session!.user.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not attach the source.";
    redirect(`/studio/recordings/${recordingId}/relationships?error=${encodeURIComponent(message)}`);
  }
  redirect(`/studio/recordings/${recordingId}/relationships`);
}

export async function detachSourceAction(recordingId: string, sourceId: string) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "CATALOGUE_WRITE")) {
    redirect(`/studio/recordings/${recordingId}/relationships?error=You+do+not+have+permission.`);
  }

  await detachSourceFromEntity("RECORDING", recordingId, sourceId, session!.user.id);
  redirect(`/studio/recordings/${recordingId}/relationships`);
}

export async function attachRightsAction(recordingId: string, formData: FormData) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "CATALOGUE_WRITE")) {
    redirect(`/studio/recordings/${recordingId}/relationships?error=You+do+not+have+permission.`);
  }

  const rightsInformationId = String(formData.get("rightsInformationId") ?? "");
  if (!rightsInformationId) {
    redirect(`/studio/recordings/${recordingId}/relationships?error=Select+a+rights+information+record.`);
  }

  try {
    await attachRightsInformationToEntity({ entityType: "RECORDING", entityId: recordingId, rightsInformationId, actorId: session!.user.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not attach the rights information.";
    redirect(`/studio/recordings/${recordingId}/relationships?error=${encodeURIComponent(message)}`);
  }
  redirect(`/studio/recordings/${recordingId}/relationships`);
}

export async function detachRightsAction(recordingId: string, rightsInformationId: string) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "CATALOGUE_WRITE")) {
    redirect(`/studio/recordings/${recordingId}/relationships?error=You+do+not+have+permission.`);
  }

  await detachRightsInformationFromEntity("RECORDING", recordingId, rightsInformationId, session!.user.id);
  redirect(`/studio/recordings/${recordingId}/relationships`);
}
