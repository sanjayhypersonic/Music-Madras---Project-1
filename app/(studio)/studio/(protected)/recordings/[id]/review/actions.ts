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
import type { ReviewNoticeCode } from "../../../../../../../modules/publishing/reviewNotices";
import { RECORDING_HOLD_REASONS, RecordingHoldError, imposeRecordingHold, liftRecordingHold } from "../../../../../../../modules/db/repositories/recordingHoldRepository";
import type { RecordingHoldReason } from "@prisma/client";

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
// A refusal comes back as `?error=` (text); a success as `?notice=<CODE>` (a fixed code the page maps to a fixed sentence: modules/publishing/reviewNotices.ts).
function back(recordingId: string, error?: string, notice?: ReviewNoticeCode): never {
  revalidatePath(`/studio/recordings/${recordingId}`, "layout");
  const query = error ? `?error=${encodeURIComponent(error)}` : notice ? `?notice=${notice}` : "";
  redirect(`/studio/recordings/${recordingId}/review${query}`);
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
  back(recordingId, undefined, "SUBMITTED");
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
  back(recordingId, undefined, "PUBLISHED");
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
  back(recordingId, undefined, "UNPUBLISHED");
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
  back(recordingId, undefined, "RESTORED");
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

// Recording-level hold (project register R-20). Needs RECORDING_PUBLISH, like every change to what visitors see (and like a video hold). Imposing or lifting a
// hold changes nothing about the Recording's publication state or revisions; the page says so, and the repository guarantees it.
export async function imposeHoldAction(recordingId: string, formData: FormData) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "RECORDING_PUBLISH")) {
    back(recordingId, "You do not have permission to put a recording on hold.");
  }
  const reason = String(formData.get("reason") ?? "") as RecordingHoldReason;
  if (!RECORDING_HOLD_REASONS.includes(reason)) back(recordingId, "Choose the kind of hold.");

  try {
    await imposeRecordingHold({ recordingId, reason, note: String(formData.get("note") ?? "") || null, actorId: session!.user.id });
  } catch (err) {
    if (err instanceof RecordingBusyError || err instanceof RecordingHoldError) back(recordingId, err.message);
    back(recordingId, "The hold could not be recorded.");
  }
  back(recordingId, undefined, "HOLD_SET");
}

export async function liftHoldAction(recordingId: string) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "RECORDING_PUBLISH")) {
    back(recordingId, "You do not have permission to lift a hold.");
  }

  try {
    await liftRecordingHold({ recordingId, actorId: session!.user.id });
  } catch (err) {
    if (err instanceof RecordingBusyError || err instanceof RecordingHoldError) back(recordingId, err.message);
    back(recordingId, "The hold could not be lifted.");
  }
  back(recordingId, undefined, "HOLD_LIFTED");
}
