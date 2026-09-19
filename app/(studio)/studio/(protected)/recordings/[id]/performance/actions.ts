"use server";

import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../../modules/auth/authService";
import { can } from "../../../../../../../modules/auth/policy";
import { createPerformance } from "../../../../../../../modules/db/repositories/performanceRepository";
import { updateDraftRevisionContent } from "../../../../../../../modules/db/repositories/recordingRepository";

export async function createPerformanceAction(recordingId: string, revisionUpdatedAt: string, formData: FormData) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "RECORDING_WRITE")) {
    redirect(`/studio/recordings/${recordingId}/performance?error=You+do+not+have+permission+to+edit+this+recording.`);
  }

  const programmeId = String(formData.get("programmeId") ?? "");
  const venueId = String(formData.get("venueId") ?? "");
  if (!programmeId || !venueId) {
    redirect(`/studio/recordings/${recordingId}/performance?error=Select+both+a+programme+and+a+venue.`);
  }

  const performanceDateRaw = String(formData.get("performanceDate") ?? "");
  const performance = await createPerformance({
    programmeId,
    venueId,
    performanceDate: performanceDateRaw ? new Date(performanceDateRaw) : undefined,
    actorId: session!.user.id,
  });

  await updateDraftRevisionContent(recordingId, new Date(revisionUpdatedAt), session!.user.id, {
    performanceId: performance.id,
  });

  redirect(`/studio/recordings/${recordingId}/performance`);
}
