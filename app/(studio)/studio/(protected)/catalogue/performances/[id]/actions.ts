"use server";

import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../../modules/auth/authService";
import { can } from "../../../../../../../modules/auth/policy";
import {
  addChoirToPerformance,
  addConductorToPerformance,
  addPerformerToPerformance,
  archivePerformance,
  findPerformanceById,
  reassignPerformanceProgramme,
  reassignPerformanceVenue,
  removeChoirFromPerformance,
  removeConductorFromPerformance,
  removePerformerFromPerformance,
  restorePerformance,
  updatePerformance,
} from "../../../../../../../modules/db/repositories/performanceRepository";
import { attachOccasionToEntity, detachOccasionFromEntity } from "../../../../../../../modules/db/repositories/occasionRepository";

function errorRedirect(performanceId: string, message: string): never {
  redirect(`/studio/catalogue/performances/${performanceId}?error=${encodeURIComponent(message)}`);
}

export async function updatePerformanceAction(performanceId: string, formData: FormData) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "CATALOGUE_WRITE")) {
    errorRedirect(performanceId, "You do not have permission to edit this performance.");
  }

  const programmeId = String(formData.get("programmeId") ?? "");
  const venueId = String(formData.get("venueId") ?? "");
  if (!programmeId || !venueId) {
    errorRedirect(performanceId, "Programme and venue are required.");
  }

  const performance = await findPerformanceById(performanceId);
  if (!performance) {
    errorRedirect(performanceId, "This performance no longer exists.");
  }

  const performanceDateRaw = String(formData.get("performanceDate") ?? "");
  await updatePerformance(performanceId, {
    performanceDate: performanceDateRaw ? new Date(performanceDateRaw) : null,
    actorId: session!.user.id,
  });

  // Reassigning the canonical Programme/Venue is its own distinct,
  // separately audited operation — only invoked when the picker's value
  // actually changed, never when the same entity was resubmitted.
  if (programmeId !== performance!.programmeId) {
    try {
      await reassignPerformanceProgramme(performanceId, programmeId, session!.user.id);
    } catch (err) {
      errorRedirect(performanceId, err instanceof Error ? err.message : "Could not change the programme.");
    }
  }

  if (venueId !== performance!.venueId) {
    try {
      await reassignPerformanceVenue(performanceId, venueId, session!.user.id);
    } catch (err) {
      errorRedirect(performanceId, err instanceof Error ? err.message : "Could not change the venue.");
    }
  }

  redirect(`/studio/catalogue/performances/${performanceId}`);
}

export async function archivePerformanceAction(performanceId: string) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "CATALOGUE_WRITE")) {
    errorRedirect(performanceId, "You do not have permission to archive this performance.");
  }

  await archivePerformance(performanceId, session!.user.id);
  redirect(`/studio/catalogue/performances/${performanceId}`);
}

export async function restorePerformanceAction(performanceId: string) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "CATALOGUE_WRITE")) {
    errorRedirect(performanceId, "You do not have permission to restore this performance.");
  }

  await restorePerformance(performanceId, session!.user.id);
  redirect(`/studio/catalogue/performances/${performanceId}`);
}

export async function attachOccasionAction(performanceId: string, formData: FormData) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "CATALOGUE_WRITE")) {
    errorRedirect(performanceId, "You do not have permission to edit this performance.");
  }

  const occasionId = String(formData.get("occasionId") ?? "");
  if (!occasionId) {
    errorRedirect(performanceId, "Select an occasion to attach.");
  }

  try {
    await attachOccasionToEntity({ entityType: "PERFORMANCE", entityId: performanceId, occasionId, actorId: session!.user.id });
  } catch (err) {
    errorRedirect(performanceId, err instanceof Error ? err.message : "Could not attach the occasion.");
  }
  redirect(`/studio/catalogue/performances/${performanceId}`);
}

export async function detachOccasionAction(performanceId: string, occasionId: string) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "CATALOGUE_WRITE")) {
    errorRedirect(performanceId, "You do not have permission to edit this performance.");
  }

  await detachOccasionFromEntity("PERFORMANCE", performanceId, occasionId, session!.user.id);
  redirect(`/studio/catalogue/performances/${performanceId}`);
}

export async function addArtistAction(performanceId: string, formData: FormData) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "CATALOGUE_WRITE")) {
    errorRedirect(performanceId, "You do not have permission to edit this performance.");
  }

  const artistId = String(formData.get("artistId") ?? "");
  if (!artistId) {
    errorRedirect(performanceId, "Select an artist to add.");
  }

  const role = String(formData.get("role") ?? "").trim() || undefined;
  await addPerformerToPerformance(performanceId, artistId, role, session!.user.id);
  redirect(`/studio/catalogue/performances/${performanceId}`);
}

export async function removeArtistAction(performanceId: string, artistId: string) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "CATALOGUE_WRITE")) {
    errorRedirect(performanceId, "You do not have permission to edit this performance.");
  }

  await removePerformerFromPerformance(performanceId, artistId, session!.user.id);
  redirect(`/studio/catalogue/performances/${performanceId}`);
}

export async function addChoirAction(performanceId: string, formData: FormData) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "CATALOGUE_WRITE")) {
    errorRedirect(performanceId, "You do not have permission to edit this performance.");
  }

  const choirId = String(formData.get("choirId") ?? "");
  if (!choirId) {
    errorRedirect(performanceId, "Select a choir to add.");
  }

  await addChoirToPerformance(performanceId, choirId, session!.user.id);
  redirect(`/studio/catalogue/performances/${performanceId}`);
}

export async function removeChoirAction(performanceId: string, choirId: string) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "CATALOGUE_WRITE")) {
    errorRedirect(performanceId, "You do not have permission to edit this performance.");
  }

  await removeChoirFromPerformance(performanceId, choirId, session!.user.id);
  redirect(`/studio/catalogue/performances/${performanceId}`);
}

export async function addConductorAction(performanceId: string, formData: FormData) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "CATALOGUE_WRITE")) {
    errorRedirect(performanceId, "You do not have permission to edit this performance.");
  }

  const conductorId = String(formData.get("conductorId") ?? "");
  if (!conductorId) {
    errorRedirect(performanceId, "Select a conductor to add.");
  }

  await addConductorToPerformance(performanceId, conductorId, session!.user.id);
  redirect(`/studio/catalogue/performances/${performanceId}`);
}

export async function removeConductorAction(performanceId: string, conductorId: string) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "CATALOGUE_WRITE")) {
    errorRedirect(performanceId, "You do not have permission to edit this performance.");
  }

  await removeConductorFromPerformance(performanceId, conductorId, session!.user.id);
  redirect(`/studio/catalogue/performances/${performanceId}`);
}
