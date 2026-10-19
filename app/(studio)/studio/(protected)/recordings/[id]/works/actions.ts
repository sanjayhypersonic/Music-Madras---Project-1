"use server";

import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../../modules/auth/authService";
import { can } from "../../../../../../../modules/auth/policy";
import {
  attachWorkToRevision,
  RecordingBusyError,
  RevisionNotEditableError,
  detachWorkFromRevision,
  resolveEditableDraftRevision,
} from "../../../../../../../modules/db/repositories/recordingRepository";
import { describeEditableDraftRefusal } from "../../../../../../../modules/publishing/editableDraftRefusal";

// Phase 6J-1: the revision id bound into these forms is only an "expected"
// token. The server resolves the Recording's actual editable draft
// (resolveEditableDraftRevision) and refuses a stale, published, archived or
// unrelated revision — it never mutates whichever revision the browser names.

function fail(recordingId: string, message: string): never {
  redirect(`/studio/recordings/${recordingId}/works?error=${encodeURIComponent(message)}`);
}

export async function attachWorkAction(recordingId: string, revisionId: string, formData: FormData) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "RECORDING_WRITE")) {
    redirect(`/studio/recordings/${recordingId}/works?error=You+do+not+have+permission+to+edit+this+recording.`);
  }

  const musicalWorkId = String(formData.get("musicalWorkId") ?? "");
  if (!musicalWorkId) {
    redirect(`/studio/recordings/${recordingId}/works?error=Select+a+work.`);
  }

  const draft = await resolveEditableDraftRevision(recordingId, revisionId);
  if (!draft.ok) fail(recordingId, describeEditableDraftRefusal(draft.reason));

  try {
    await attachWorkToRevision(draft.revisionId, musicalWorkId, session!.user.id);
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

  const draft = await resolveEditableDraftRevision(recordingId, revisionId);
  if (!draft.ok) fail(recordingId, describeEditableDraftRefusal(draft.reason));

  try {
    await detachWorkFromRevision(draft.revisionId, musicalWorkId, session!.user.id);
  } catch (err) {
    // 6J-10C: the repository re-verifies eligibility under the edit lock; surface a refusal as itself.
    if (err instanceof RevisionNotEditableError || err instanceof RecordingBusyError) fail(recordingId, err.message);
    fail(recordingId, "That work is no longer attached to this recording.");
  }
  redirect(`/studio/recordings/${recordingId}/works`);
}
