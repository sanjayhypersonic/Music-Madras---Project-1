"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../../modules/auth/authService";
import { can } from "../../../../../../../modules/auth/policy";
import {
  RecordingBusyError,
  archiveRecording,
  publishRecordingDraft,
  restoreRecording,
  submitRecordingForReview,
  unpublishRecording,
} from "../../../../../../../modules/db/repositories/recordingRepository";
import { describePublishRefusal } from "../../../../../../../modules/publishing/publishRefusal";

// Phase 6J-1 — the lifecycle actions of the Review & Publish step.
//   - publish validates the Recording's ACTUAL open draft (resolved server-side;
//     the bound revision id is only an expected token), refuses an archived
//     Recording, and reports failures instead of throwing.
//   - unpublish / restore wire the repository functions that already existed
//     (6G-5A) behind the same RECORDING_PUBLISH permission as publish/archive.
// Each is idempotent-safe against a double click: a repeat finds the state
// already changed and reports it rather than corrupting anything.

// The workflow layout (step list, heading, phase) is preserved by Next across navigations, so a
// lifecycle change must invalidate it or the old phase stays on screen (found in 6J-3B QA).
function back(recordingId: string, error?: string): never {
  revalidatePath(`/studio/recordings/${recordingId}`, "layout");
  redirect(`/studio/recordings/${recordingId}/review${error ? `?error=${encodeURIComponent(error)}` : ""}`);
}

export async function submitForReviewAction(recordingId: string) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "EDITORIAL_REVIEW")) {
    back(recordingId, "You do not have permission to submit for review.");
  }

  try {
    await submitRecordingForReview(recordingId, session!.user.id);
  } catch (err) {
    if (err instanceof RecordingBusyError) back(recordingId, err.message);
    back(recordingId, "This recording can no longer be submitted for review (its status has changed).");
  }
  back(recordingId);
}

export async function publishAction(recordingId: string, expectedDraftRevisionId: string) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "RECORDING_PUBLISH")) {
    back(recordingId, "You do not have permission to publish.");
  }

  // Phase 6J-10B: every publication precondition — not archived, the expected draft still current,
  // completeness — is re-validated INSIDE the publishing transaction, under the per-Recording lock,
  // and the writes are conditional (recordingRepository.publishRecordingDraft). The Studio shows the
  // explicit refusal (it says WHAT is still required); no database error reaches the editor.
  const result = await publishRecordingDraft({
    recordingId,
    actorId: session!.user.id,
    expectedDraftRevisionId,
  });
  if (!result.ok) back(recordingId, describePublishRefusal(result.reason, result.missingCategories));
  back(recordingId);
}

export async function unpublishAction(recordingId: string) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "RECORDING_PUBLISH")) {
    back(recordingId, "You do not have permission to unpublish.");
  }

  try {
    await unpublishRecording(recordingId, session!.user.id);
  } catch (err) {
    if (err instanceof RecordingBusyError) back(recordingId, err.message);
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
  } catch (err) {
    if (err instanceof RecordingBusyError) back(recordingId, err.message);
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
  } catch (err) {
    if (err instanceof RecordingBusyError) back(recordingId, err.message);
    back(recordingId, "This recording could not be archived.");
  }
  redirect(`/studio/recordings`);
}
