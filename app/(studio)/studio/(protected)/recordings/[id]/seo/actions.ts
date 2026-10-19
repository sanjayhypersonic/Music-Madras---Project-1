"use server";

import { getCurrentStudioSession } from "../../../../../../../modules/auth/authService";
import { can } from "../../../../../../../modules/auth/policy";
import { ConcurrentEditError, RecordingBusyError, updateDraftRevisionContent } from "../../../../../../../modules/db/repositories/recordingRepository";
import type { AutosaveSaveResult } from "../../../../_components/AutosaveStepForm";

// expectedRevisionId is bound by the page (6J-10C): the draft this form was rendered for.
export async function saveSeoStep(
  expectedRevisionId: string,
  recordingId: string,
  expectedUpdatedAt: string,
  patch: Record<string, string>
): Promise<AutosaveSaveResult> {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "RECORDING_WRITE")) {
    return { ok: false, error: "You do not have permission to edit recordings." };
  }

  try {
    const updated = await updateDraftRevisionContent(recordingId, new Date(expectedUpdatedAt), session.user.id, {
      seoMetaTitle: patch.seoMetaTitle || null,
      seoMetaDescription: patch.seoMetaDescription || null,
      seoCanonicalPath: patch.seoCanonicalPath || null,
    }, undefined, { expectedRevisionId });
    return { ok: true, updatedAt: updated.updatedAt.toISOString() };
  } catch (error) {
    if (error instanceof ConcurrentEditError || error instanceof RecordingBusyError) {
      return { ok: false, error: error.message };
    }
    throw error;
  }
}
