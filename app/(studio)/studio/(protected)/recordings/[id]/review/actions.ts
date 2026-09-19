"use server";

import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../../modules/auth/authService";
import { can } from "../../../../../../../modules/auth/policy";
import {
  archiveRecording,
  getRecordingRevisionCompletenessReport,
  publishCurrentDraft,
  submitRecordingForReview,
} from "../../../../../../../modules/db/repositories/recordingRepository";
import { isReadyToPublish } from "../../../../../../../modules/mmke/completeness/checkRecordingRevisionCompleteness";

export async function submitForReviewAction(recordingId: string) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "EDITORIAL_REVIEW")) {
    redirect(`/studio/recordings/${recordingId}/review?error=You+do+not+have+permission+to+submit+for+review.`);
  }

  await submitRecordingForReview(recordingId, session!.user.id);
  redirect(`/studio/recordings/${recordingId}/review`);
}

export async function publishAction(recordingId: string, currentDraftRevisionId: string) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "RECORDING_PUBLISH")) {
    redirect(`/studio/recordings/${recordingId}/review?error=You+do+not+have+permission+to+publish.`);
  }

  const completeness = await getRecordingRevisionCompletenessReport(currentDraftRevisionId);
  if (!completeness || !isReadyToPublish(completeness.report)) {
    redirect(`/studio/recordings/${recordingId}/review?error=This+recording+is+not+ready+to+publish.`);
  }

  await publishCurrentDraft(recordingId, session!.user.id);
  redirect(`/studio/recordings/${recordingId}/review`);
}

export async function archiveAction(recordingId: string) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "RECORDING_PUBLISH")) {
    redirect(`/studio/recordings/${recordingId}/review?error=You+do+not+have+permission+to+archive.`);
  }

  await archiveRecording(recordingId, session!.user.id);
  redirect(`/studio/recordings`);
}
