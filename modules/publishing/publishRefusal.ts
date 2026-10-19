import { describeEditableDraftRefusal, type EditableDraftRefusal } from "./editableDraftRefusal";

// Phase 6J-10B — why a publication attempt was refused, and what to tell the editor. Pure: no database,
// no framework. The reasons come from recordingRepository.publishRecordingDraft, which re-validates
// inside its transaction; none of the messages can contain a database error or a value.

export type PublishRefusalReason = EditableDraftRefusal | "NOT_READY" | "STATE_CHANGED" | "BUSY" | "FAILED";

export function describePublishRefusal(reason: PublishRefusalReason, missingCategories: readonly string[] = []): string {
  switch (reason) {
    case "RECORDING_NOT_FOUND":
    case "RECORDING_ARCHIVED":
    case "NO_OPEN_DRAFT":
    case "STALE_REVISION":
      return describeEditableDraftRefusal(reason);
    case "NOT_READY":
      return `This recording is not ready to publish.${missingCategories.length > 0 ? ` Still required: ${missingCategories.join(", ")}.` : ""}`;
    case "STATE_CHANGED":
      return "This recording changed while it was being published, so nothing was published. Reload the page and try again.";
    case "BUSY":
      return "Someone else is changing this recording right now, so nothing was published. Wait a moment and try again.";
    case "FAILED":
      return "The recording could not be published. Nothing was changed. Reload the page and try again.";
  }
}
