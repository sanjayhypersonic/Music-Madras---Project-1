"use server";

import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../modules/auth/authService";
import { markAllNotificationsRead, markNotificationRead } from "../../../../../modules/db/repositories/studioNotificationRepository";

// Phase 6K-1 — Server Actions for the notification inbox. Each re-checks the session; whether a person may mark a given notification
// read is decided by the repository (it must be one their role may see).

async function requireUser() {
  const session = await getCurrentStudioSession();
  if (!session || session.user.status !== "ACTIVE") redirect("/studio/signin");
  return session.user;
}

export async function markReadAction(formData: FormData) {
  const user = await requireUser();
  await markNotificationRead({ id: String(formData.get("id") ?? ""), userId: user.id, role: user.role });
  redirect("/studio/notifications");
}

export async function markAllReadAction() {
  const user = await requireUser();
  await markAllNotificationsRead({ userId: user.id, role: user.role });
  redirect("/studio/notifications");
}
