"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../modules/auth/authService";
import { can } from "../../../../../../modules/auth/policy";
import { RecordingBusyError, RevisionNotEditableError, findRecordingById, forkDraftFromPublished } from "../../../../../../modules/db/repositories/recordingRepository";

// Phase 6J-4 — "Start a new draft": the one way back to an EDITABLE draft once a
// Recording has no open draft revision — either because it is published with no
// pending changes, or because it was UNPUBLISHED (unpublish deliberately keeps the
// last published revision as history and does not open a draft; see
// recordingRepository.unpublishRecording).
//
// It is the existing forkDraftFromPublished (copies the published revision's
// content, works and media into a new DRAFT revision, audit-logged) behind the same
// permission that governs editing a draft (RECORDING_WRITE). It never publishes and
// never changes what is public: a live Recording stays live while its draft is
// edited; an unpublished one stays unpublished. Used by BOTH the Source step and the
// Review & Publish step, so there is a single set of guards.
//
//   - ARCHIVED Recordings are refused: forking would quietly move them to IN_REVIEW,
//     bypassing restore (and its audit entry);
//   - a repeat (double click, replayed form) when a draft is already open changes
//     nothing and simply lands the editor on the page;
//   - `step` is checked against an allow-list, never used as a free-form redirect.

const LANDING_STEPS = new Set(["source", "review", "relationships"]);

function land(recordingId: string, step: string, error?: string): never {
  const safeStep = LANDING_STEPS.has(step) ? step : "review";
  redirect(`/studio/recordings/${recordingId}/${safeStep}${error ? `?error=${encodeURIComponent(error)}` : ""}`);
}

export async function startNewDraftAction(recordingId: string, step: string) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "RECORDING_WRITE")) {
    land(recordingId, step, "You do not have permission to edit this recording.");
  }

  const current = await findRecordingById(recordingId);
  if (!current) redirect("/studio/recordings");

  if (current.status === "ARCHIVED") {
    land(recordingId, step, "This recording is archived. Restore it before making changes.");
  }

  if (current.currentDraftRevisionId === null) {
    try {
      await forkDraftFromPublished(recordingId, session!.user.id);
    } catch (err) {
      // 6J-10D: the repository re-checks under the edit lock, so a refusal here is authoritative. Typed
      // refusals (archived since the check above, busy) are shown as themselves; a draft that appeared
      // meanwhile (double click) is a success, not an error.
      if (err instanceof RevisionNotEditableError || err instanceof RecordingBusyError) land(recordingId, step, err.message);
      const after = await findRecordingById(recordingId);
      if (!after || after.currentDraftRevisionId === null) {
        land(recordingId, step, "A new draft could not be started (this recording has no published version to start from).");
      }
    }
  }

  // The step list, heading and phase live in the workflow LAYOUT, which Next keeps across
  // navigations; without this the old phase stays on screen after the lifecycle changes.
  revalidatePath(`/studio/recordings/${recordingId}`, "layout");
  land(recordingId, step);
}