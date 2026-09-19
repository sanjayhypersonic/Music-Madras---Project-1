"use server";

import { redirect } from "next/navigation";
import { completePasswordReset, PasswordResetError } from "../../../../../modules/db/repositories/passwordResetRepository";
import { hashPassword } from "../../../../../modules/auth/passwordHashing";

export interface ConfirmResetFormState {
  error?: string;
}

const MIN_PASSWORD_LENGTH = 10;

export async function confirmResetAction(
  _prevState: ConfirmResetFormState,
  formData: FormData
): Promise<ConfirmResetFormState> {
  const token = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  if (!token) {
    return { error: "This reset link is missing its token." };
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` };
  }
  if (password !== confirmPassword) {
    return { error: "Passwords do not match." };
  }

  try {
    const passwordHash = await hashPassword(password);
    await completePasswordReset(token, passwordHash);
  } catch (error) {
    if (error instanceof PasswordResetError) {
      return { error: error.message };
    }
    throw error;
  }

  redirect("/studio/signin");
}
