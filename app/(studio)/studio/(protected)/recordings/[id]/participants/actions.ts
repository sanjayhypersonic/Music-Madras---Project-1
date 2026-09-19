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

function assertCanWrite(role: StudioRoleName | undefined) {
  return Boolean(role) && can(role as StudioRoleName, "RECORDING_WRITE");
}

export async function addPerformerAction(recordingId: string, performanceId: string, formData: FormData) {
  const session = await getCurrentStudioSession();
  if (!session || !assertCanWrite(session.user.role)) {
    redirect(`/studio/recordings/${recordingId}/participants?error=You+do+not+have+permission.`);
  }

  const artistId = String(formData.get("artistId") ?? "");
  if (!artistId) redirect(`/studio/recordings/${recordingId}/participants?error=Select+an+artist.`);

  await addPerformerToPerformance(performanceId, artistId, String(formData.get("role") ?? "") || undefined, session!.user.id);
  redirect(`/studio/recordings/${recordingId}/participants`);
}

export async function removePerformerAction(recordingId: string, performanceId: string, artistId: string) {
  const session = await getCurrentStudioSession();
  if (!session || !assertCanWrite(session.user.role)) {
    redirect(`/studio/recordings/${recordingId}/participants?error=You+do+not+have+permission.`);
  }

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

  await addConductorToPerformance(performanceId, conductorId, session!.user.id);
  redirect(`/studio/recordings/${recordingId}/participants`);
}
