"use server";

import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../../modules/auth/authService";
import { can } from "../../../../../../../modules/auth/policy";
import type { StudioRoleName } from "../../../../../../../modules/auth/types";
import {
  addPerformerToPerformance,
  removePerformerFromPerformance,
  addChoirToPerformance,
  addConductorToPerformance,
} from "../../../../../../../modules/db/repositories/performanceRepository";
import {
  ConcurrentEditError,
  RecordingBusyError,
  RevisionNotEditableError,
  discardDraftPerformanceClone,
  editDraftPerformanceParticipants,
} from "../../../../../../../modules/db/repositories/recordingRepository";
import type { Prisma } from "@prisma/client";

// Phase 6J-1: these actions edit the Performance a Recording's draft points at. The performance id bound into the form
// is only an expected token — the server resolves the draft's actual performance and refuses a stale or unrelated one,
// so a replayed form can never edit a Performance this Recording's draft does not use (or edit anything on an
// archived Recording).
//
// Phase 6J-10F: a Performance that a published revision also uses is NOT edited in place — that would change the live
// page before the draft is published. editDraftPerformanceParticipants gives the draft its own copy first (copy-on-write,
// under the Recording's edit lock) and applies the change to that copy; publishing promotes it. See
// docs/recording-publication-safety.md.

function assertCanWrite(role: StudioRoleName | undefined) {
  return Boolean(role) && can(role as StudioRoleName, "RECORDING_WRITE");
}

function fail(recordingId: string, message: string): never {
  redirect(`/studio/recordings/${recordingId}/participants?error=${encodeURIComponent(message)}`);
}

async function editParticipants(
  recordingId: string,
  performanceId: string,
  actorId: string,
  change: (tx: Prisma.TransactionClient, ownedPerformanceId: string) => Promise<unknown>
): Promise<void> {
  let refusal: string | null = null;
  try {
    await editDraftPerformanceParticipants({ recordingId, expectedPerformanceId: performanceId, actorId, change });
  } catch (error) {
    if (error instanceof RevisionNotEditableError || error instanceof RecordingBusyError || error instanceof ConcurrentEditError) refusal = error.message;
    else throw error;
  }
  if (refusal) fail(recordingId, refusal);
}

export async function addPerformerAction(recordingId: string, performanceId: string, formData: FormData) {
  const session = await getCurrentStudioSession();
  if (!session || !assertCanWrite(session.user.role)) {
    redirect(`/studio/recordings/${recordingId}/participants?error=You+do+not+have+permission.`);
  }

  const artistId = String(formData.get("artistId") ?? "");
  if (!artistId) redirect(`/studio/recordings/${recordingId}/participants?error=Select+an+artist.`);

  const role = String(formData.get("role") ?? "") || undefined;
  await editParticipants(recordingId, performanceId, session!.user.id, (tx, owned) => addPerformerToPerformance(owned, artistId, role, session!.user.id, tx));
  redirect(`/studio/recordings/${recordingId}/participants`);
}

export async function removePerformerAction(recordingId: string, performanceId: string, artistId: string) {
  const session = await getCurrentStudioSession();
  if (!session || !assertCanWrite(session.user.role)) {
    redirect(`/studio/recordings/${recordingId}/participants?error=You+do+not+have+permission.`);
  }

  await editParticipants(recordingId, performanceId, session!.user.id, (tx, owned) => removePerformerFromPerformance(owned, artistId, session!.user.id, tx));
  redirect(`/studio/recordings/${recordingId}/participants`);
}

export async function addChoirAction(recordingId: string, performanceId: string, formData: FormData) {
  const session = await getCurrentStudioSession();
  if (!session || !assertCanWrite(session.user.role)) {
    redirect(`/studio/recordings/${recordingId}/participants?error=You+do+not+have+permission.`);
  }

  const choirId = String(formData.get("choirId") ?? "");
  if (!choirId) redirect(`/studio/recordings/${recordingId}/participants?error=Select+a+choir.`);

  await editParticipants(recordingId, performanceId, session!.user.id, (tx, owned) => addChoirToPerformance(owned, choirId, session!.user.id, tx));
  redirect(`/studio/recordings/${recordingId}/participants`);
}

export async function addConductorAction(recordingId: string, performanceId: string, formData: FormData) {
  const session = await getCurrentStudioSession();
  if (!session || !assertCanWrite(session.user.role)) {
    redirect(`/studio/recordings/${recordingId}/participants?error=You+do+not+have+permission.`);
  }

  const conductorId = String(formData.get("conductorId") ?? "");
  if (!conductorId) redirect(`/studio/recordings/${recordingId}/participants?error=Select+a+conductor.`);

  await editParticipants(recordingId, performanceId, session!.user.id, (tx, owned) => addConductorToPerformance(owned, conductorId, session!.user.id, tx));
  redirect(`/studio/recordings/${recordingId}/participants`);
}

// Phase 6J-10F: the way out of a refused publication (PERFORMANCE_CHANGED) or simply "I want the published participants
// back": drops this draft's own copy of the participants and points the draft at the published Performance again.
export async function discardParticipantChangesAction(recordingId: string) {
  const session = await getCurrentStudioSession();
  if (!session || !assertCanWrite(session.user.role)) {
    redirect(`/studio/recordings/${recordingId}/participants?error=You+do+not+have+permission.`);
  }

  let refusal: string | null = null;
  try {
    await discardDraftPerformanceClone({ recordingId, actorId: session!.user.id });
  } catch (error) {
    if (error instanceof RevisionNotEditableError || error instanceof RecordingBusyError || error instanceof ConcurrentEditError) refusal = error.message;
    else throw error;
  }
  if (refusal) fail(recordingId, refusal);
  redirect(`/studio/recordings/${recordingId}/participants`);
}
