import nodemailer from "nodemailer";
import { buildInvitationEmail, buildPasswordResetEmail, type EmailMessage } from "./emailTemplates";

// Transactional email boundary (ADR §7.2, §25 open item).
//
// Phase 6J-1: the V1 audit found that Studio invitations and password resets
// were only ever written to the server console, so on a real deployment nobody
// could be onboarded and reset links (with live tokens) sat in function logs.
// This keeps the existing provider-neutral interface and adds:
//
//   - SmtpEmailProvider — plain SMTP via nodemailer. SMTP is the one delivery
//     protocol every email service speaks, so no commercial vendor is baked in:
//     the operator points SMTP_URL at whichever service they choose. Credentials
//     live only in the environment (never in source).
//   - ConsoleEmailProvider — kept ONLY for local development/tests.
//   - getConfiguredEmailProvider — picks one from the environment and, in
//     production, refuses to fall back to the console: a missing or invalid
//     configuration is an explicit, visible error, never silent log output.
//
// Environment (names only; see .env.example):
//   EMAIL_PROVIDER   "smtp" | "console"  (unset: console in development, error in production)
//   SMTP_URL         e.g. smtps://user:password@smtp.example.com:465
//   EMAIL_FROM       e.g. "Music Madras <studio@example.org>"

export interface EmailProvider {
  sendInvitationEmail(input: { toEmail: string; inviteUrl: string; invitedByName: string }): Promise<void>;
  sendPasswordResetEmail(input: { toEmail: string; resetUrl: string }): Promise<void>;
}

/** Email delivery is not configured (or is configured unsafely) — an operator problem, never a user error. */
export class EmailNotConfiguredError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "EmailNotConfiguredError";
  }
}

/** The provider accepted the call but the message could not be delivered. Carries no credentials. */
export class EmailDeliveryError extends Error {
  constructor() {
    super("The email could not be delivered.");
    this.name = "EmailDeliveryError";
  }
}

export class ConsoleEmailProvider implements EmailProvider {
  async sendInvitationEmail(input: { toEmail: string; inviteUrl: string; invitedByName: string }): Promise<void> {
    console.log(`[ConsoleEmailProvider] Studio invitation for ${input.toEmail} (invited by ${input.invitedByName}): ${input.inviteUrl}`);
  }

  async sendPasswordResetEmail(input: { toEmail: string; resetUrl: string }): Promise<void> {
    console.log(`[ConsoleEmailProvider] Password reset for ${input.toEmail}: ${input.resetUrl}`);
  }
}

/** The one method of a nodemailer transport this provider uses — lets tests inject a recording transport. */
export interface MailTransport {
  sendMail(message: { from: string; to: string; subject: string; text: string }): Promise<unknown>;
}

export class SmtpEmailProvider implements EmailProvider {
  constructor(
    private readonly transport: MailTransport,
    private readonly from: string
  ) {}

  private async send(toEmail: string, message: EmailMessage): Promise<void> {
    try {
      await this.transport.sendMail({ from: this.from, to: toEmail, subject: message.subject, text: message.text });
    } catch {
      // Deliberately not rethrowing the transport's error: it can contain the SMTP URL/credentials.
      throw new EmailDeliveryError();
    }
  }

  sendInvitationEmail(input: { toEmail: string; inviteUrl: string; invitedByName: string }): Promise<void> {
    return this.send(input.toEmail, buildInvitationEmail({ inviteUrl: input.inviteUrl, invitedByName: input.invitedByName }));
  }

  sendPasswordResetEmail(input: { toEmail: string; resetUrl: string }): Promise<void> {
    return this.send(input.toEmail, buildPasswordResetEmail({ resetUrl: input.resetUrl }));
  }
}

export type EmailProviderChoice = { kind: "smtp"; smtpUrl: string; from: string } | { kind: "console" } | { kind: "unconfigured"; reason: string };

/** Pure: which provider the environment asks for, and whether that is acceptable here. */
export function resolveEmailProviderChoice(env: Record<string, string | undefined>): EmailProviderChoice {
  const isProduction = env.NODE_ENV === "production";
  const requested = env.EMAIL_PROVIDER?.trim().toLowerCase() || undefined;

  if (requested === "smtp") {
    const smtpUrl = env.SMTP_URL?.trim();
    const from = env.EMAIL_FROM?.trim();
    if (!smtpUrl || !from) return { kind: "unconfigured", reason: "EMAIL_PROVIDER=smtp requires SMTP_URL and EMAIL_FROM to be set." };
    return { kind: "smtp", smtpUrl, from };
  }

  if (requested === undefined || requested === "console") {
    if (isProduction) {
      return {
        kind: "unconfigured",
        reason: "Email delivery is not configured. Set EMAIL_PROVIDER=smtp (with SMTP_URL and EMAIL_FROM) — production never falls back to console output.",
      };
    }
    return { kind: "console" };
  }

  return { kind: "unconfigured", reason: `Unsupported EMAIL_PROVIDER "${requested}". Use "smtp".` };
}

export function getConfiguredEmailProvider(env: Record<string, string | undefined> = process.env): EmailProvider {
  const choice = resolveEmailProviderChoice(env);
  if (choice.kind === "unconfigured") throw new EmailNotConfiguredError(choice.reason);
  if (choice.kind === "console") return new ConsoleEmailProvider();
  return new SmtpEmailProvider(nodemailer.createTransport(choice.smtpUrl), choice.from);
}
