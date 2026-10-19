"use server";

import { getCurrentStudioSession } from "../../../../../../../modules/auth/authService";
import { can } from "../../../../../../../modules/auth/policy";
import { updateDraftRevisionContent } from "../../../../../../../modules/db/repositories/recordingRepository";
import type { AutosaveSaveResult } from "../../../../../../../modules/studio/autosave/autosaveTypes";
import { FORBIDDEN_RESULT, runAutosaveSave } from "../../../../_components/autosaveServer";

// `expectedRevisionId` is bound by the page (6J-10C): the draft this form was rendered for. The result carries the
// KIND of any refusal (6J-10E) so the client can keep the editor's text and stop, retry later, or ask for a reload.
export async function saveEducationalStep(
  expectedRevisionId: string,
  recordingId: string,
  expectedUpdatedAt: string,
  patch: Record<string, string>
): Promise<AutosaveSaveResult> {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "RECORDING_WRITE")) return FORBIDDEN_RESULT;

  return runAutosaveSave(() =>
    updateDraftRevisionContent(
      recordingId,
      new Date(expectedUpdatedAt),
      session.user.id,
      {
        educationalDifficultyLevel: patch.educationalDifficultyLevel || null,
        educationalListeningGuide: patch.educationalListeningGuide || null,
        educationalAnalysis: patch.educationalAnalysis || null,
      },
      undefined,
      { expectedRevisionId }
    )
  );
}