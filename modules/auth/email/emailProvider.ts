// Transactional email boundary (ADR §7.2, §25 open item — no provider has
// been chosen yet). No real email credentials exist anywhere in this
// codebase (guardrail: do not create production email credentials).
//
// ConsoleEmailProvider is a safe, honest default for local development:
// it does not pretend to deliver an email — it logs the link so a
// developer/administrator can see and manually share it. This is not
// "fake functionality" in the sense the Phase 4 brief warns against
// (fabricating a successful result); it is a clearly-labeled stand-in
// that surfaces exactly the information a real provider would send,
// through a channel that genuinely works without any external account.

export interface EmailProvider {
  sendInvitationEmail(input: { toEmail: string; inviteUrl: string; invitedByName: string }): Promise<void>;
  sendPasswordResetEmail(input: { toEmail: string; resetUrl: string }): Promise<void>;
}

export class ConsoleEmailProvider implements EmailProvider {
  async sendInvitationEmail(input: { toEmail: string; inviteUrl: string; invitedByName: string }): Promise<void> {
    console.log(
      `[ConsoleEmailProvider] Studio invitation for ${input.toEmail} (invited by ${input.invitedByName}): ${input.inviteUrl}`
    );
  }

  async sendPasswordResetEmail(input: { toEmail: string; resetUrl: string }): Promise<void> {
    console.log(`[ConsoleEmailProvider] Password reset for ${input.toEmail}: ${input.resetUrl}`);
  }
}

export function getConfiguredEmailProvider(): EmailProvider {
  // No real provider is configured anywhere in this codebase yet (ADR
  // §25 open item). When one is chosen, this is the only function that
  // needs to change.
  return new ConsoleEmailProvider();
}
