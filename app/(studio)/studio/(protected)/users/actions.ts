"use server";

import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../modules/auth/authService";
import { canManageUsers } from "../../../../../modules/auth/policy";
import { createInvitation, InvitationError } from "../../../../../modules/db/repositories/invitationRepository";
import {
  changeStudioUserRole,
  disableStudioUser,
  reactivateStudioUser,
} from "../../../../../modules/db/repositories/studioUserAdminRepository";
import { getConfiguredEmailProvider } from "../../../../../modules/auth/email/emailProvider";
import type { StudioRoleName } from "../../../../../modules/auth/types";

const ROLES: StudioRoleName[] = ["FOUNDER", "SUPER_ADMINISTRATOR", "ADMINISTRATOR", "EDITOR", "REVIEWER", "CONTRIBUTOR"];

export async function inviteUserAction(formData: FormData) {
  const session = await getCurrentStudioSession();
  if (!session || !canManageUsers(session.user.role)) {
    redirect("/studio/users?error=You+do+not+have+permission+to+invite+users.");
  }

  const email = String(formData.get("email") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const role = String(formData.get("role") ?? "") as StudioRoleName;
  if (!email || !name || !ROLES.includes(role)) {
    redirect("/studio/users?error=Name,+email,+and+a+valid+role+are+required.");
  }

  try {
    const { rawToken } = await createInvitation(email, role, session!.user.id, name);
    const inviteUrl = `${process.env.AUTH_URL ?? "http://localhost:3000"}/studio/accept-invite?token=${rawToken}`;
    await getConfiguredEmailProvider().sendInvitationEmail({ toEmail: email, inviteUrl, invitedByName: session!.user.name });
  } catch (err) {
    if (err instanceof InvitationError) {
      redirect(`/studio/users?error=${encodeURIComponent(err.message)}`);
    }
    throw err;
  }

  redirect("/studio/users");
}

export async function disableUserAction(targetUserId: string) {
  const session = await getCurrentStudioSession();
  if (!session || !canManageUsers(session.user.role)) {
    redirect("/studio/users?error=You+do+not+have+permission.");
  }
  if (session!.user.id === targetUserId) {
    redirect("/studio/users?error=You+cannot+disable+your+own+account.");
  }

  await disableStudioUser(targetUserId, session!.user.id);
  redirect("/studio/users");
}

export async function reactivateUserAction(targetUserId: string) {
  const session = await getCurrentStudioSession();
  if (!session || !canManageUsers(session.user.role)) {
    redirect("/studio/users?error=You+do+not+have+permission.");
  }

  await reactivateStudioUser(targetUserId, session!.user.id);
  redirect("/studio/users");
}

export async function changeRoleAction(targetUserId: string, formData: FormData) {
  const session = await getCurrentStudioSession();
  if (!session || !canManageUsers(session.user.role)) {
    redirect("/studio/users?error=You+do+not+have+permission.");
  }

  const role = String(formData.get("role") ?? "") as StudioRoleName;
  if (!ROLES.includes(role)) {
    redirect("/studio/users?error=Invalid+role.");
  }

  await changeStudioUserRole(targetUserId, role, session!.user.id);
  redirect("/studio/users");
}
