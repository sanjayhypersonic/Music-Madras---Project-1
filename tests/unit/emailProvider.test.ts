import { describe, expect, it, vi } from "vitest";
import {
  ConsoleEmailProvider,
  EmailDeliveryError,
  EmailNotConfiguredError,
  SmtpEmailProvider,
  getConfiguredEmailProvider,
  resolveEmailProviderChoice,
  type MailTransport,
} from "../../modules/auth/email/emailProvider";
import { buildInvitationEmail, buildPasswordResetEmail } from "../../modules/auth/email/emailTemplates";

// Phase 6J-1 — production must never silently depend on console output for
// onboarding; the SMTP provider delivers the real message and never leaks
// credentials. No network: a recording transport stands in for SMTP.

class RecordingTransport implements MailTransport {
  readonly sent: Array<{ from: string; to: string; subject: string; text: string }> = [];
  async sendMail(message: { from: string; to: string; subject: string; text: string }) {
    this.sent.push(message);
    return { accepted: [message.to] };
  }
}

describe("resolveEmailProviderChoice", () => {
  it("development/test with nothing configured uses the console (safe, non-production)", () => {
    expect(resolveEmailProviderChoice({ NODE_ENV: "development" })).toEqual({ kind: "console" });
    expect(resolveEmailProviderChoice({ NODE_ENV: "test" })).toEqual({ kind: "console" });
    expect(resolveEmailProviderChoice({})).toEqual({ kind: "console" });
  });

  it("production with nothing configured is an explicit error — never the console", () => {
    const choice = resolveEmailProviderChoice({ NODE_ENV: "production" });
    expect(choice.kind).toBe("unconfigured");
    if (choice.kind === "unconfigured") expect(choice.reason).toMatch(/EMAIL_PROVIDER=smtp/);
  });

  it("production rejects an explicit console provider", () => {
    expect(resolveEmailProviderChoice({ NODE_ENV: "production", EMAIL_PROVIDER: "console" }).kind).toBe("unconfigured");
  });

  it("smtp needs both SMTP_URL and EMAIL_FROM", () => {
    expect(resolveEmailProviderChoice({ NODE_ENV: "production", EMAIL_PROVIDER: "smtp" }).kind).toBe("unconfigured");
    expect(resolveEmailProviderChoice({ NODE_ENV: "production", EMAIL_PROVIDER: "smtp", SMTP_URL: "smtps://u:p@h:465" }).kind).toBe("unconfigured");
    expect(resolveEmailProviderChoice({ NODE_ENV: "production", EMAIL_PROVIDER: "smtp", SMTP_URL: "smtps://u:p@h:465", EMAIL_FROM: "Music Madras <a@b.org>" })).toEqual({
      kind: "smtp",
      smtpUrl: "smtps://u:p@h:465",
      from: "Music Madras <a@b.org>",
    });
  });

  it("is case/space tolerant and rejects unknown providers", () => {
    expect(resolveEmailProviderChoice({ EMAIL_PROVIDER: " SMTP ", SMTP_URL: "smtp://h", EMAIL_FROM: "a@b.org" }).kind).toBe("smtp");
    expect(resolveEmailProviderChoice({ EMAIL_PROVIDER: "carrier-pigeon" }).kind).toBe("unconfigured");
  });
});

describe("getConfiguredEmailProvider", () => {
  it("returns the console provider only outside production", () => {
    expect(getConfiguredEmailProvider({ NODE_ENV: "development" })).toBeInstanceOf(ConsoleEmailProvider);
  });

  it("throws EmailNotConfiguredError in production when delivery is not configured", () => {
    expect(() => getConfiguredEmailProvider({ NODE_ENV: "production" })).toThrow(EmailNotConfiguredError);
  });

  it("builds an SMTP provider from a valid configuration", () => {
    expect(getConfiguredEmailProvider({ NODE_ENV: "production", EMAIL_PROVIDER: "smtp", SMTP_URL: "smtp://user:pw@localhost:2525", EMAIL_FROM: "a@b.org" })).toBeInstanceOf(SmtpEmailProvider);
  });
});

describe("SmtpEmailProvider", () => {
  it("delivers the invitation to the invitee from the configured sender, with the link in the body", async () => {
    const transport = new RecordingTransport();
    const provider = new SmtpEmailProvider(transport, "Music Madras <studio@example.org>");

    await provider.sendInvitationEmail({ toEmail: "new@example.org", inviteUrl: "https://studio.example.org/studio/accept-invite?token=abc", invitedByName: "Asha" });

    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0]).toMatchObject({ from: "Music Madras <studio@example.org>", to: "new@example.org" });
    expect(transport.sent[0].text).toContain("https://studio.example.org/studio/accept-invite?token=abc");
    expect(transport.sent[0].text).toContain("Asha");
    expect(transport.sent[0].subject).toMatch(/invited/i);
  });

  it("delivers the password reset with its link", async () => {
    const transport = new RecordingTransport();
    await new SmtpEmailProvider(transport, "a@b.org").sendPasswordResetEmail({ toEmail: "me@example.org", resetUrl: "https://studio.example.org/reset?token=xyz" });
    expect(transport.sent[0].to).toBe("me@example.org");
    expect(transport.sent[0].text).toContain("https://studio.example.org/reset?token=xyz");
    expect(transport.sent[0].subject).toMatch(/reset/i);
  });

  it("turns a transport failure into EmailDeliveryError without leaking the SMTP URL or credentials", async () => {
    const transport: MailTransport = { sendMail: vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED smtps://user:SECRET-PASSWORD@smtp.example.com:465")) };
    const provider = new SmtpEmailProvider(transport, "a@b.org");

    const failure = await provider.sendInvitationEmail({ toEmail: "x@y.org", inviteUrl: "https://z", invitedByName: "A" }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(EmailDeliveryError);
    expect(String((failure as Error).message)).not.toMatch(/SECRET-PASSWORD|smtp\.example\.com/);
  });
});

describe("email templates", () => {
  it("state the expiry and carry the link", () => {
    const invitation = buildInvitationEmail({ inviteUrl: "https://x/i", invitedByName: "Asha" });
    expect(invitation.text).toContain("https://x/i");
    expect(invitation.text).toMatch(/72 hours/);
    const reset = buildPasswordResetEmail({ resetUrl: "https://x/r" });
    expect(reset.text).toContain("https://x/r");
    expect(reset.text).toMatch(/30 minutes/);
  });
});
