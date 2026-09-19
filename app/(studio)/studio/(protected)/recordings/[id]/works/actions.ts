"use server";

import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../../modules/auth/authService";
import { can } from "../../../../../../../modules/auth/policy";
import { attachWorkToRevision, detachWorkFromRevision } from "../../../../../../../modules/db/repositories/recordingRepository";

export async function attachWorkAction(recordingId: string, revisionId: string, formData: FormData) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "RECORDING_WRITE")) {
    redirect(`/studio/recordings/${recordingId}/works?error=You+do+not+have+permission+to+edit+this+recording.`);
  }

  const musicalWorkId = String(formData.get("musicalWorkId") ?? "");
  if (!musicalWorkId) {
    redirect(`/studio/recordings/${recordingId}/works?error=Select+a+work.`);
  }

  try {
    await attachWorkToRevision(revisionId, musicalWorkId, session!.user.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not attach the work.";
    redirect(`/studio/recordings/${recordingId}/works?error=${encodeURIComponent(message)}`);
  }

  redirect(`/studio/recordings/${recordingId}/works`);
}

export async function detachWorkAction(recordingId: string, revisionId: string, musicalWorkId: string) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "RECORDING_WRITE")) {
    redirect(`/studio/recordings/${recordingId}/works?error=You+do+not+have+permission+to+edit+this+recording.`);
  }

  await detachWorkFromRevision(revisionId, musicalWorkId, session!.user.id);
  redirect(`/studio/recordings/${recordingId}/works`);
}
