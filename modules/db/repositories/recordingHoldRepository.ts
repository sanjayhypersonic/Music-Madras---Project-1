import type { RecordingHoldReason } from "@prisma/client";
import { writeAuditLog } from "../../audit/writeAuditLog";
import { withRecordingEditLock } from "./recordingRepository";

// Recording-level HOLDS (project register R-20): an explicit, recorded decision to withhold one Recording from the public Museum.
//
//   - It is a property of the Recording (four columns on `recordings`), independent of the Recording's publication state and of any hold on its videos:
//     holding a video never holds its Recording, and holding a Recording never holds its videos (a video is a separate distribution asset with its own rules).
//   - It never touches publication state or any revision: no status change, no pointer change, no draft, no revision row. Lifting it changes nothing but the
//     hold itself, so an unpublished Recording stays unpublished and a published one is visible again exactly when the existing rules say so.
//   - Every public surface asks isRecordingPubliclyVisible / RECORDING_NOT_HELD_WHERE / PUBLISHED_REVISION_WHERE (publicEligibility.ts), so enforcement is in
//     the canonical readers, not in the UI.
//   - Imposing and lifting are each ONE conditional write plus one audit entry in the same transaction, under the per-Recording edit lock that serializes
//     publish, archive and the other lifecycle changes. The audit log is the history (who, when, why, what it was). The caller checks the permission.

export const MAX_HOLD_NOTE = 500;

export type RecordingHoldRefusal = "NOT_FOUND" | "ALREADY_HELD" | "NOT_HELD" | "CHANGED";

export class RecordingHoldError extends Error {
  constructor(public readonly reason: RecordingHoldRefusal) {
    super(
      reason === "NOT_FOUND"
        ? "This recording no longer exists."
        : reason === "ALREADY_HELD"
          ? "This recording is already on hold. Lift the hold first if you want to record a different one."
          : reason === "NOT_HELD"
            ? "This recording is not on hold."
            : "This recording changed while the hold was being recorded. Reload and try again."
    );
    this.name = "RecordingHoldError";
  }
}

export const RECORDING_HOLD_REASONS: readonly RecordingHoldReason[] = ["RIGHTS", "COPYRIGHT", "PRIVACY", "OTHER"];

/** Puts a Recording on hold. Refuses (never overwrites) a Recording that is already held. */
export async function imposeRecordingHold(input: { recordingId: string; reason: RecordingHoldReason; note?: string | null; actorId: string }): Promise<void> {
  if (!RECORDING_HOLD_REASONS.includes(input.reason)) throw new RecordingHoldError("CHANGED");
  const note = input.note?.trim() ? input.note.trim().slice(0, MAX_HOLD_NOTE) : null;
  await withRecordingEditLock(input.recordingId, async (tx) => {
    const current = await tx.recording.findUnique({ where: { id: input.recordingId }, select: { id: true, holdReason: true } });
    if (!current) throw new RecordingHoldError("NOT_FOUND");
    if (current.holdReason !== null) throw new RecordingHoldError("ALREADY_HELD");
    const now = new Date();
    const moved = await tx.recording.updateMany({
      where: { id: input.recordingId, holdReason: null },
      data: { holdReason: input.reason, holdNote: note, holdSetAt: now, holdSetById: input.actorId },
    });
    if (moved.count !== 1) throw new RecordingHoldError("CHANGED");
    await writeAuditLog(
      { actorId: input.actorId, action: "RECORDING_HOLD_SET", entityType: "Recording", entityId: input.recordingId, afterSnapshot: { holdReason: input.reason, holdNote: note, holdSetAt: now.toISOString() } },
      tx
    );
  });
}

/**
 * Lifts a hold. Nothing else changes: the Recording's status, revisions and pointers are exactly as they were, so an unpublished Recording stays unpublished.
 * Whether it is visible afterwards is decided by the existing publication rules alone.
 */
export async function liftRecordingHold(input: { recordingId: string; actorId: string }): Promise<void> {
  await withRecordingEditLock(input.recordingId, async (tx) => {
    const current = await tx.recording.findUnique({ where: { id: input.recordingId }, select: { id: true, holdReason: true, holdNote: true, holdSetAt: true, holdSetById: true } });
    if (!current) throw new RecordingHoldError("NOT_FOUND");
    if (current.holdReason === null) throw new RecordingHoldError("NOT_HELD");
    const moved = await tx.recording.updateMany({
      where: { id: input.recordingId, holdReason: current.holdReason },
      data: { holdReason: null, holdNote: null, holdSetAt: null, holdSetById: null },
    });
    if (moved.count !== 1) throw new RecordingHoldError("CHANGED");
    await writeAuditLog(
      {
        actorId: input.actorId,
        action: "RECORDING_HOLD_LIFTED",
        entityType: "Recording",
        entityId: input.recordingId,
        beforeSnapshot: { holdReason: current.holdReason, holdNote: current.holdNote, holdSetAt: current.holdSetAt?.toISOString() ?? null, holdSetById: current.holdSetById },
      },
      tx
    );
  });
}
