"use server";

import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../modules/auth/authService";
import { canManageUsers } from "../../../../../modules/auth/policy";
import { createInvitation, InvitationError } from "../../../../../modules/db/repositories/invitationRepository";
import {
  changeStudioUserRole,
  disableStudioUser,
  reactivateStudioUser,
  UserManagementError,
} from "../../../../../modules/db/repositories/studioUserAdminRepository";
import { EmailDeliveryError, EmailNotConfiguredError, getConfiguredEmailProvider } from "../../../../../modules/auth/email/emailProvider";
import { getSiteOrigin } from "../../../../../modules/config/siteOrigin";
import type { StudioRoleName } from "../../../../../modules/auth/types";

const ROLES: StudioRoleName[] = ["FOUNDER", "SUPER_ADMINISTRATOR", "ADMINISTRATOR", "EDITOR", "REVIEWER", "CONTRIBUTOR"];

// Phase 6J-1: who may invite/promote/disable/reactivate whom is enforced in the
// repositories (modules/auth/userManagementRules.ts) — the Founder is protected,
// nobody can lock themselves out, and an invited account cannot be reactivated
// into existence. These actions authenticate, call the repository, and turn a
// refusal into a clear message instead of an error page.

function back(error?: string): never {
  redirect(error ? `/studio/users?error=${encodeURIComponent(error)}` : "/studio/users");
}

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

  let failure: string | null = null;
  try {
    const { rawToken } = await createInvitation(email, role, session!.user.id, name);
    const inviteUrl = `${getSiteOrigin()}/studio/accept-invite?token=${rawToken}`;
    await getConfiguredEmailProvider().sendInvitationEmail({ toEmail: email, inviteUrl, invitedByName: session!.user.name });
  } catch (err) {
    if (err instanceof InvitationError) {
      failure = err.message;
    } else if (err instanceof EmailNotConfiguredError) {
      // An operator problem — say so plainly. The invitation row exists; sending again after fixing the
      // configuration issues a fresh link.
      failure = "The invitation was created but no email could be sent because email delivery is not configured. Ask the site operator to configure it, then send the invitation again.";
    } else if (err instanceof EmailDeliveryError) {
      failure = "The invitation was created but the email could not be delivered. Check the address and the email configuration, then send the invitation again.";
    } else {
      throw err;
    }
  }
  if (failure) back(failure);

  back();
}

async function guarded(run: (actorId: string) => Promise<unknown>) {
  const session = await getCurrentStudioSession();
  if (!session || !canManageUsers(session.user.role)) {
    back("You do not have permission.");
  }
  try {
    await run(session!.user.id);
  } catch (err) {
    if (err instanceof UserManagementError) back(err.message);
    throw err;
  }
  back();
}

export async function disableUserAction(targetUserId: string) {
  await guarded((actorId) => disableStudioUser(targetUserId, actorId));
}

export async function reactivateUserAction(targetUserId: string) {
  await guarded((actorId) => reactivateStudioUser(targetUserId, actorId));
}

export async function changeRoleAction(targetUserId: string, formData: FormData) {
  const role = String(formData.get("role") ?? "") as StudioRoleName;
  const session = await getCurrentStudioSession();
  if (!session || !canManageUsers(session.user.role)) {
    back("You do not have permission.");
  }
  if (!ROLES.includes(role)) {
    back("Invalid role.");
  }
  await guarded((actorId) => changeStudioUserRole(targetUserId, role, actorId));
}
