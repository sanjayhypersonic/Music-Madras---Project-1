"use server";

import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../../modules/auth/authService";
import { can } from "../../../../../../../modules/auth/policy";
import { ConcurrentEditError, RecordingBusyError, createPerformanceForDraft, resolveEditableDraftRevision } from "../../../../../../../modules/db/repositories/recordingRepository";
import { describeEditableDraftRefusal } from "../../../../../../../modules/publishing/editableDraftRefusal";

// `revisionId` and `revisionUpdatedAt` are the draft the form was rendered for (6J-10C): the save is a
// compare-and-swap on both, so a form for a draft that has since been published or replaced is refused.
export async function createPerformanceAction(recordingId: string, revisionId: string, revisionUpdatedAt: string, formData: FormData) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "RECORDING_WRITE")) {
    redirect(`/studio/recordings/${recordingId}/performance?error=You+do+not+have+permission+to+edit+this+recording.`);
  }

  const programmeId = String(formData.get("programmeId") ?? "");
  const venueId = String(formData.get("venueId") ?? "");
  if (!programmeId || !venueId) {
    redirect(`/studio/recordings/${recordingId}/performance?error=Select+both+a+programme+and+a+venue.`);
  }

  // Phase 6J-1: confirm the Recording still has an editable draft BEFORE creating anything,
  // so a stale/archived form cannot leave an orphan Performance behind.
  const draft = await resolveEditableDraftRevision(recordingId, revisionId);
  if (!draft.ok) {
    redirect(`/studio/recordings/${recordingId}/performance?error=${encodeURIComponent(describeEditableDraftRefusal(draft.reason))}`);
  }

  const performanceDateRaw = String(formData.get("performanceDate") ?? "");
  // The Performance row and its link to the draft are one transaction: a refused save leaves no orphan row.
  let refusal: string | null = null;
  try {
    await createPerformanceForDraft(recordingId, revisionId, new Date(revisionUpdatedAt), {
      programmeId,
      venueId,
      performanceDate: performanceDateRaw ? new Date(performanceDateRaw) : undefined,
      actorId: session!.user.id,
    });
  } catch (error) {
    if (error instanceof ConcurrentEditError || error instanceof RecordingBusyError) refusal = error.message;
    else throw error;
  }
  if (refusal) redirect(`/studio/recordings/${recordingId}/performance?error=${encodeURIComponent(refusal)}`);

  redirect(`/studio/recordings/${recordingId}/performance`);
}
