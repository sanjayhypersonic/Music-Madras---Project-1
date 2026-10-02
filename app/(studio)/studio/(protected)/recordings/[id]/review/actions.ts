"use server";

import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../../modules/auth/authService";
import { can } from "../../../../../../../modules/auth/policy";
import {
  archiveRecording,
  getRecordingRevisionCompletenessReport,
  publishCurrentDraft,
  resolveEditableDraftRevision,
  restoreRecording,
  submitRecordingForReview,
  unpublishRecording,
} from "../../../../../../../modules/db/repositories/recordingRepository";
import { isReadyToPublish } from "../../../../../../../modules/mmke/completeness/checkRecordingRevisionCompleteness";
import { describeEditableDraftRefusal } from "../../../../../../../modules/publishing/editableDraftRefusal";

// Phase 6J-1 — the lifecycle actions of the Review & Publish step.
//   - publish validates the Recording's ACTUAL open draft (resolved server-side;
//     the bound revision id is only an expected token), refuses an archived
//     Recording, and reports failures instead of throwing.
//   - unpublish / restore wire the repository functions that already existed
//     (6G-5A) behind the same RECORDING_PUBLISH permission as publish/archive.
// Each is idempotent-safe against a double click: a repeat finds the state
// already changed and reports it rather than corrupting anything.

function back(recordingId: string, error?: string): never {
  redirect(`/studio/recordings/${recordingId}/review${error ? `?error=${encodeURIComponent(error)}` : ""}`);
}

export async function submitForReviewAction(recordingId: string) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "EDITORIAL_REVIEW")) {
    back(recordingId, "You do not have permission to submit for review.");
  }

  try {
    await submitRecordingForReview(recordingId, session!.user.id);
  } catch {
    back(recordingId, "This recording can no longer be submitted for review (its status has changed).");
  }
  back(recordingId);
}

export async function publishAction(recordingId: string, expectedDraftRevisionId: string) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "RECORDING_PUBLISH")) {
    back(recordingId, "You do not have permission to publish.");
  }

  const draft = await resolveEditableDraftRevision(recordingId, expectedDraftRevisionId);
  if (!draft.ok) back(recordingId, describeEditableDraftRefusal(draft.reason));

  const completeness = await getRecordingRevisionCompletenessReport(draft.revisionId);
  if (!completeness || !isReadyToPublish(completeness.report)) {
    back(recordingId, "This recording is not ready to publish.");
  }

  try {
    await publishCurrentDraft(recordingId, session!.user.id);
  } catch {
    back(recordingId, "The recording could not be published. Nothing was changed. Reload the page and try again.");
  }
  back(recordingId);
}

export async function unpublishAction(recordingId: string) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "RECORDING_PUBLISH")) {
    back(recordingId, "You do not have permission to unpublish.");
  }

  try {
    await unpublishRecording(recordingId, session!.user.id);
  } catch {
    back(recordingId, "This recording is not published, so it cannot be unpublished.");
  }
  back(recordingId);
}

export async function restoreAction(recordingId: string) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "RECORDING_PUBLISH")) {
    back(recordingId, "You do not have permission to restore.");
  }

  try {
    await restoreRecording(recordingId, session!.user.id);
  } catch {
    back(recordingId, "This recording is not archived, so it cannot be restored.");
  }
  back(recordingId);
}

export async function archiveAction(recordingId: string) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "RECORDING_PUBLISH")) {
    back(recordingId, "You do not have permission to archive.");
  }

  try {
    await archiveRecording(recordingId, session!.user.id);
  } catch {
    back(recordingId, "This recording could not be archived.");
  }
  redirect(`/studio/recordings`);
}
