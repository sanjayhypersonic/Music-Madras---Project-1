"use server";

import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../modules/auth/authService";
import { can } from "../../../../../modules/auth/policy";
import { updateSheetMusicRequestStatus } from "../../../../../modules/db/repositories/sheetMusicRequestRepository";
import type { SheetMusicRequestStatus } from "@prisma/client";

export async function updateRequestStatusAction(requestId: string, formData: FormData) {
  const session = await getCurrentStudioSession();
  if (!session || !can(session.user.role, "CATALOGUE_WRITE")) {
    redirect("/studio/sheet-music?error=You+do+not+have+permission+to+update+requests.");
  }

  const status = String(formData.get("status") ?? "") as SheetMusicRequestStatus;
  await updateSheetMusicRequestStatus(requestId, status, session!.user.id);
  redirect("/studio/sheet-music");
}
