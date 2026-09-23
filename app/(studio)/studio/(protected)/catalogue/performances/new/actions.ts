"use server";

import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../../modules/auth/authService";
import { can } from "../../../../../../../modules/auth/policy";
import { createPerformance } from "../../../../../../../modules/db/repositories/performanceRepository";

function errorRedirect(message: string): never {
  redirect(`/studio/catalogue/performances/new?error=${encodeURIComponent(message)}`);
}

export async function createPerformanceAction(formData: FormData) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "CATALOGUE_WRITE")) {
    errorRedirect("You do not have permission to add performances.");
  }

  const programmeId = String(formData.get("programmeId") ?? "");
  const venueId = String(formData.get("venueId") ?? "");
  if (!programmeId || !venueId) {
    errorRedirect("Select both a programme and a venue.");
  }

  const performanceDateRaw = String(formData.get("performanceDate") ?? "");

  const performance = await createPerformance({
    programmeId,
    venueId,
    performanceDate: performanceDateRaw ? new Date(performanceDateRaw) : undefined,
    actorId: session!.user.id,
  });

  redirect(`/studio/catalogue/performances/${performance.id}`);
}
