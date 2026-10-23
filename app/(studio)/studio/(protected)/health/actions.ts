"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../modules/auth/authService";
import { can } from "../../../../../modules/auth/policy";
import { resolveIncident } from "../../../../../modules/db/repositories/operationalIncidentRepository";

// Operational incidents are private to the people who operate the platform: viewing them (the Health page) and resolving them both need
// SETTINGS_MANAGE (Super Administrators and Founders), checked here on the server regardless of what the page shows.

export async function resolveIncidentAction(incidentId: string) {
  const session = await getCurrentStudioSession();
  if (!session || session.user.status !== "ACTIVE" || !can(session.user.role, "SETTINGS_MANAGE")) {
    redirect("/studio/health?error=You+do+not+have+permission.");
  }
  await resolveIncident({ id: incidentId, actorId: session!.user.id });
  revalidatePath("/studio/health");
  redirect("/studio/health");
}
