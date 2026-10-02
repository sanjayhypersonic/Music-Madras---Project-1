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
import { resolveEditableDraftRevision } from "../../../../../../../modules/db/repositories/recordingRepository";
import { describeEditableDraftRefusal } from "../../../../../../../modules/publishing/editableDraftRefusal";

// Phase 6J-1: these actions edit the Performance a Recording's draft points at.
// The performance id bound into the form is only an expected token — the server
// resolves the draft's actual performance and refuses a stale or unrelated one,
// so a replayed form can never edit a Performance this Recording's draft does
// not use (or edit anything on an archived Recording).

function assertCanWrite(role: StudioRoleName | undefined) {
  return Boolean(role) && can(role as StudioRoleName, "RECORDING_WRITE");
}

function fail(recordingId: string, message: string): never {
  redirect(`/studio/recordings/${recordingId}/participants?error=${encodeURIComponent(message)}`);
}

async function requireDraftPerformance(recordingId: string, performanceId: string): Promise<void> {
  const draft = await resolveEditableDraftRevision(recordingId);
  if (!draft.ok) fail(recordingId, describeEditableDraftRefusal(draft.reason));
  if (draft.performanceId === null || draft.performanceId !== performanceId) {
    fail(recordingId, describeEditableDraftRefusal("STALE_REVISION"));
  }
}

export async function addPerformerAction(recordingId: string, performanceId: string, formData: FormData) {
  const session = await getCurrentStudioSession();
  if (!session || !assertCanWrite(session.user.role)) {
    redirect(`/studio/recordings/${recordingId}/participants?error=You+do+not+have+permission.`);
  }

  const artistId = String(formData.get("artistId") ?? "");
  if (!artistId) redirect(`/studio/recordings/${recordingId}/participants?error=Select+an+artist.`);

  await requireDraftPerformance(recordingId, performanceId);
  await addPerformerToPerformance(performanceId, artistId, String(formData.get("role") ?? "") || undefined, session!.user.id);
  redirect(`/studio/recordings/${recordingId}/participants`);
}

export async function removePerformerAction(recordingId: string, performanceId: string, artistId: string) {
  const session = await getCurrentStudioSession();
  if (!session || !assertCanWrite(session.user.role)) {
    redirect(`/studio/recordings/${recordingId}/participants?error=You+do+not+have+permission.`);
  }

  await requireDraftPerformance(recordingId, performanceId);
  await removePerformerFromPerformance(performanceId, artistId, session!.user.id);
  redirect(`/studio/recordings/${recordingId}/participants`);
}

export async function addChoirAction(recordingId: string, performanceId: string, formData: FormData) {
  const session = await getCurrentStudioSession();
  if (!session || !assertCanWrite(session.user.role)) {
    redirect(`/studio/recordings/${recordingId}/participants?error=You+do+not+have+permission.`);
  }

  const choirId = String(formData.get("choirId") ?? "");
  if (!choirId) redirect(`/studio/recordings/${recordingId}/participants?error=Select+a+choir.`);

  await requireDraftPerformance(recordingId, performanceId);
  await addChoirToPerformance(performanceId, choirId, session!.user.id);
  redirect(`/studio/recordings/${recordingId}/participants`);
}

export async function addConductorAction(recordingId: string, performanceId: string, formData: FormData) {
  const session = await getCurrentStudioSession();
  if (!session || !assertCanWrite(session.user.role)) {
    redirect(`/studio/recordings/${recordingId}/participants?error=You+do+not+have+permission.`);
  }

  const conductorId = String(formData.get("conductorId") ?? "");
  if (!conductorId) redirect(`/studio/recordings/${recordingId}/participants?error=Select+a+conductor.`);

  await requireDraftPerformance(recordingId, performanceId);
  await addConductorToPerformance(performanceId, conductorId, session!.user.id);
  redirect(`/studio/recordings/${recordingId}/participants`);
}
