"use server";

import { requestPasswordReset } from "../../../../modules/db/repositories/passwordResetRepository";
import { getConfiguredEmailProvider } from "../../../../modules/auth/email/emailProvider";

export interface RequestResetFormState {
  submitted?: boolean;
}

// Always reports success, whether or not the email matched an ACTIVE
// account (modules/db/repositories/passwordResetRepository.requestPasswordReset
// already returns null silently in that case) — never reveal account
// existence through the response.
export async function requestResetAction(
  _prevState: RequestResetFormState,
  formData: FormData
): Promise<RequestResetFormState> {
  const email = String(formData.get("email") ?? "").trim();

  if (email) {
    const result = await requestPasswordReset(email);
    if (result) {
      const resetUrl = `${process.env.AUTH_URL ?? "http://localhost:3000"}/studio/reset-password/confirm?token=${result.rawToken}`;
      await getConfiguredEmailProvider().sendPasswordResetEmail({ toEmail: email, resetUrl });
    }
  }

  return { submitted: true };
}
