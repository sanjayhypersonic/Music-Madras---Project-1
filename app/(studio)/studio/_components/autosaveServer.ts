import {
  ConcurrentEditError,
  RecordingBusyError,
  RevisionNotEditableError,
} from "../../../../modules/db/repositories/recordingRepository";
import type { AutosaveSaveResult } from "../../../../modules/studio/autosave/autosaveTypes";

// Phase 6J-10E — the one place a Studio autosave Server Action turns the repository's typed refusals into the result
// the client controller understands (modules/studio/autosave). The client needs the KIND, not just a message: a stale
// token must stop saving and keep the editor's text, a busy Recording is retried later, an archived Recording is not
// retried at all. Anything not listed here is unexpected and is rethrown (the client treats a thrown action as a
// transient failure; no database error text reaches the editor).

export const FORBIDDEN_RESULT: AutosaveSaveResult = { ok: false, kind: "FORBIDDEN", error: "You do not have permission to edit recordings." };

export async function runAutosaveSave(save: () => Promise<{ updatedAt: Date }>): Promise<AutosaveSaveResult> {
  try {
    const updated = await save();
    return { ok: true, updatedAt: updated.updatedAt.toISOString() };
  } catch (error) {
    if (error instanceof ConcurrentEditError) return { ok: false, kind: "CONFLICT", error: error.message };
    if (error instanceof RevisionNotEditableError) {
      // STALE_REVISION: the page was rendered for a draft that is no longer the current one.
      return { ok: false, kind: error.reason === "STALE_REVISION" ? "CONFLICT" : "NOT_EDITABLE", error: error.message };
    }
    if (error instanceof RecordingBusyError) return { ok: false, kind: "BUSY", error: error.message };
    throw error;
  }
}