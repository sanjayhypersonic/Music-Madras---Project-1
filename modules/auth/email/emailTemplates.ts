// Phase 6J-1 — the text of the two transactional emails Studio sends. Pure and
// provider-neutral: the same message goes through any EmailProvider. Plain
// text on purpose (no tracking pixels, nothing to render): the link is the
// message.

export interface EmailMessage {
  subject: string;
  text: string;
}

export function buildInvitationEmail(input: { inviteUrl: string; invitedByName: string }): EmailMessage {
  return {
    subject: "You have been invited to Music Madras Studio",
    text: [
      `${input.invitedByName} has invited you to Music Madras Studio, the editorial workspace for the Music Madras archive.`,
      "",
      "Use this link to choose your password and activate your account. It can be used once and expires in 72 hours:",
      input.inviteUrl,
      "",
      "If you were not expecting this invitation, you can ignore this email.",
    ].join("\n"),
  };
}

export function buildPasswordResetEmail(input: { resetUrl: string }): EmailMessage {
  return {
    subject: "Reset your Music Madras Studio password",
    text: [
      "We received a request to reset the password for your Music Madras Studio account.",
      "",
      "Use this link to choose a new password. It can be used once and expires in 30 minutes:",
      input.resetUrl,
      "",
      "If you did not ask for this, you can ignore this email — your password will not change.",
    ].join("\n"),
  };
}
