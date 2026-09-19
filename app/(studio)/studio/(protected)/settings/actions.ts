"use server";

import { redirect } from "next/navigation";
import { getCurrentStudioSession, signOutCurrentUser } from "../../../../../modules/auth/authService";
import { findStudioUserById } from "../../../../../modules/db/repositories/studioAuthRepository";
import { updateStudioUserPassword } from "../../../../../modules/db/repositories/studioUserAdminRepository";
import { hashPassword, verifyPassword } from "../../../../../modules/auth/passwordHashing";

const MIN_PASSWORD_LENGTH = 10;

export interface ChangePasswordFormState {
  error?: string;
}

export async function changePasswordAction(
  _prevState: ChangePasswordFormState,
  formData: FormData
): Promise<ChangePasswordFormState> {
  const session = await getCurrentStudioSession();
  if (!session) redirect("/studio/signin");

  const currentPassword = String(formData.get("currentPassword") ?? "");
  const newPassword = String(formData.get("newPassword") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  const user = await findStudioUserById(session.user.id);
  if (!user?.passwordHash || !(await verifyPassword(user.passwordHash, currentPassword))) {
    return { error: "Current password is incorrect." };
  }
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return { error: `New password must be at least ${MIN_PASSWORD_LENGTH} characters.` };
  }
  if (newPassword !== confirmPassword) {
    return { error: "New passwords do not match." };
  }

  const newPasswordHash = await hashPassword(newPassword);
  await updateStudioUserPassword(user.id, newPasswordHash);
  await signOutCurrentUser();
  redirect("/studio/signin");
}
