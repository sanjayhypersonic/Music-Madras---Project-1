"use server";

import { getCurrentStudioSession } from "../../../../../../../modules/auth/authService";
import { can } from "../../../../../../../modules/auth/policy";
import { ConcurrentEditError, updateDraftRevisionContent } from "../../../../../../../modules/db/repositories/recordingRepository";
import type { AutosaveSaveResult } from "../../../../_components/AutosaveStepForm";

export async function saveSourceStep(
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
      title: patch.title || null,
      description: patch.description || null,
    });
    return { ok: true, updatedAt: updated.updatedAt.toISOString() };
  } catch (error) {
    if (error instanceof ConcurrentEditError) {
      return { ok: false, error: error.message };
    }
    throw error;
  }
}
