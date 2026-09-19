"use server";

import { redirect } from "next/navigation";
import { acceptInvitation, InvitationError } from "../../../../modules/db/repositories/invitationRepository";
import { hashPassword } from "../../../../modules/auth/passwordHashing";

export interface AcceptInviteFormState {
  error?: string;
}

const MIN_PASSWORD_LENGTH = 10;

export async function acceptInviteAction(
  _prevState: AcceptInviteFormState,
  formData: FormData
): Promise<AcceptInviteFormState> {
  const token = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  if (!token) {
    return { error: "This invitation link is missing its token." };
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` };
  }
  if (password !== confirmPassword) {
    return { error: "Passwords do not match." };
  }

  try {
    const passwordHash = await hashPassword(password);
    await acceptInvitation(token, passwordHash);
  } catch (error) {
    if (error instanceof InvitationError) {
      return { error: error.message };
    }
    throw error;
  }

  redirect("/studio/signin");
}
