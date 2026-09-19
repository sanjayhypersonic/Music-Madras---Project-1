"use server";

import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../../modules/auth/authService";
import { can } from "../../../../../../../modules/auth/policy";
import { addRecordingToCollection } from "../../../../../../../modules/db/repositories/collectionRepository";

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
