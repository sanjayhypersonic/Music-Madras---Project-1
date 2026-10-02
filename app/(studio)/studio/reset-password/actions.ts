"use server";

import { requestPasswordReset } from "../../../../modules/db/repositories/passwordResetRepository";
import { countRecentResetRequests, recordResetRequest } from "../../../../modules/db/repositories/authAttemptRepository";
import { getConfiguredEmailProvider } from "../../../../modules/auth/email/emailProvider";
import { isResetRequestLimited } from "../../../../modules/auth/authRateLimit";
import { runAfterResponse } from "../../../../modules/auth/runAfterResponse";
import { getSiteOrigin } from "../../../../modules/config/siteOrigin";

export interface RequestResetFormState {
  submitted?: boolean;
}

// Always reports success, whether or not the email matched an ACTIVE
// account (modules/db/repositories/passwordResetRepository.requestPasswordReset
// already returns null silently in that case) — never reveal account
// existence through the response.
//
// Phase 6J-1:
//   - requests are limited per email (modules/auth/authRateLimit.ts); beyond the
//     limit nothing is created or sent, and the response is identical;
//   - the token/email work runs AFTER the response (runAfterResponse), so the
//     response time is the same for real and unknown accounts;
//   - an email that cannot be delivered is logged for the operator (without the
//     link) and is never shown to the visitor, for the same no-enumeration reason.
export async function requestResetAction(
  _prevState: RequestResetFormState,
  formData: FormData
): Promise<RequestResetFormState> {
  const email = String(formData.get("email") ?? "").trim();

  if (email) {
    await runAfterResponse(async () => {
      try {
        if (isResetRequestLimited(await countRecentResetRequests(email))) return;
        await recordResetRequest(email);

        const result = await requestPasswordReset(email);
        if (result) {
          const resetUrl = `${getSiteOrigin()}/studio/reset-password/confirm?token=${result.rawToken}`;
          await getConfiguredEmailProvider().sendPasswordResetEmail({ toEmail: email, resetUrl });
        }
      } catch (error) {
        console.error("[password reset] the reset email could not be sent:", error instanceof Error ? error.name : "unknown error");
      }
    });
  }

  return { submitted: true };
}
