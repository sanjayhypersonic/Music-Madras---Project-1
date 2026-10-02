import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "crypto";

// Must be at the true top level — vi.mock is hoisted above every import.
const mockGetCurrentStudioSession = vi.fn();
vi.mock("../../modules/auth/authService", () => ({
  getCurrentStudioSession: () => mockGetCurrentStudioSession(),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ set: vi.fn() }),
}));

const verifySpy = vi.fn();
vi.mock("../../modules/auth/passwordHashing", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../modules/auth/passwordHashing")>();
  return {
    ...actual,
    verifyPassword: (hash: string, plain: string) => {
      verifySpy(hash);
      return actual.verifyPassword(hash, plain);
    },
  };
});

const sentResets: Array<{ toEmail: string; resetUrl: string }> = [];
vi.mock("../../modules/auth/email/emailProvider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../modules/auth/email/emailProvider")>();
  return {
    ...actual,
    getConfiguredEmailProvider: () => ({
      async sendInvitationEmail() {},
      async sendPasswordResetEmail(input: { toEmail: string; resetUrl: string }) {
        sentResets.push(input);
      },
    }),
  };
});

const auditListSpy = vi.fn();
vi.mock("../../modules/audit/listAuditLog", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../modules/audit/listAuditLog")>();
  return {
    ...actual,
    listRecentAuditLogEntries: (limit: number) => {
      auditListSpy(limit);
      return actual.listRecentAuditLogEntries(limit);
    },
  };
});

import { prisma } from "../../modules/db/client";
import { hashPassword } from "../../modules/auth/passwordHashing";
import { signInWithStudioCredentials } from "../../modules/auth/credentialsSignIn";
import { SIGN_IN_LOCKED_MESSAGE, SIGN_IN_MAX_FAILURES, attemptKey } from "../../modules/auth/authRateLimit";
import { countRecentResetRequests, countRecentSignInFailures } from "../../modules/db/repositories/authAttemptRepository";
import { requestResetAction } from "../../app/(studio)/studio/reset-password/actions";
import StudioDashboardPage from "../../app/(studio)/studio/(protected)/dashboard/page";
import type { ReactNode } from "react";

// Phase 6J-1 — authentication hardening against a real database with
// disposable users: lockout, no account enumeration, timing equalisation,
// reset-request limiting, and the dashboard's audit permission.

const TAG = "phase6j1auth";
const TOKEN = randomUUID().slice(0, 8);
const T = 120000;
const PASSWORD = "correct-horse-battery-staple-6j1";

const emails: string[] = [];
const userIds: string[] = [];

async function makeUser(role: "EDITOR" | "ADMINISTRATOR" = "EDITOR") {
  const email = `${TAG}-${randomUUID().slice(0, 6)}-${TOKEN}@musicmadras.test`;
  emails.push(email);
  const user = await prisma.studioUser.create({
    data: { id: randomUUID(), email, name: `Auth ${role}`, role, status: "ACTIVE", passwordHash: await hashPassword(PASSWORD) },
  });
  userIds.push(user.id);
  return { email, user };
}

function uniqueEmail(label: string) {
  const email = `${TAG}-${label}-${randomUUID().slice(0, 6)}-${TOKEN}@musicmadras.test`;
  emails.push(email);
  return email;
}

beforeEach(() => {
  verifySpy.mockClear();
  auditListSpy.mockClear();
  sentResets.length = 0;
});

afterAll(async () => {
  const keys = emails.map(attemptKey);
  await prisma.auditLogEntry.deleteMany({ where: { OR: [{ entityType: "AuthAttempt", entityId: { in: keys } }, { actorId: { in: userIds } }, { entityType: "StudioUser", entityId: { in: userIds } }] } });
  await prisma.passwordResetToken.deleteMany({ where: { studioUserId: { in: userIds } } });
  await prisma.studioSession.deleteMany({ where: { studioUserId: { in: userIds } } });
  await prisma.studioUser.deleteMany({ where: { id: { in: userIds } } });
}, T);

describe("A. Sign-in lockout", () => {
  it("locks an email out after repeated failures — even the correct password is then refused", async () => {
    const { email } = await makeUser();
    for (let i = 0; i < SIGN_IN_MAX_FAILURES; i++) {
      expect(await signInWithStudioCredentials(email, "wrong-password")).toMatchObject({ success: false, error: "Incorrect email or password." });
    }
    const locked = await signInWithStudioCredentials(email, PASSWORD);
    expect(locked).toEqual({ success: false, error: SIGN_IN_LOCKED_MESSAGE });
    expect(await prisma.studioSession.count({ where: { studioUser: { email } } })).toBe(0);
  }, T);

  it("behaves identically for an account that does not exist (a lockout reveals nothing)", async () => {
    const ghost = uniqueEmail("ghost");
    for (let i = 0; i < SIGN_IN_MAX_FAILURES; i++) {
      expect(await signInWithStudioCredentials(ghost, "whatever")).toMatchObject({ error: "Incorrect email or password." });
    }
    expect(await signInWithStudioCredentials(ghost, "whatever")).toEqual({ success: false, error: SIGN_IN_LOCKED_MESSAGE });
  }, T);

  it("matches the email case-insensitively, so changing the case does not dodge the limit", async () => {
    const { email } = await makeUser();
    for (let i = 0; i < SIGN_IN_MAX_FAILURES; i++) await signInWithStudioCredentials(email, "wrong");
    expect(await signInWithStudioCredentials(email.toUpperCase(), "wrong")).toEqual({ success: false, error: SIGN_IN_LOCKED_MESSAGE });
  }, T);

  it("a successful sign-in resets the count, and the lockout lapses after its window", async () => {
    const { email } = await makeUser();
    for (let i = 0; i < SIGN_IN_MAX_FAILURES - 1; i++) await signInWithStudioCredentials(email, "wrong");
    expect(await signInWithStudioCredentials(email, PASSWORD)).toEqual({ success: true });
    expect(await countRecentSignInFailures(email)).toBe(0);

    // Four more failures after the success are still below the limit.
    for (let i = 0; i < SIGN_IN_MAX_FAILURES - 1; i++) await signInWithStudioCredentials(email, "wrong");
    expect(await signInWithStudioCredentials(email, PASSWORD)).toEqual({ success: true });

    const lockedOut = await makeUser();
    for (let i = 0; i < SIGN_IN_MAX_FAILURES; i++) await signInWithStudioCredentials(lockedOut.email, "wrong");
    expect(await countRecentSignInFailures(lockedOut.email)).toBe(SIGN_IN_MAX_FAILURES);
    expect(await countRecentSignInFailures(lockedOut.email, new Date(Date.now() + 16 * 60 * 1000))).toBe(0); // window passed
  }, T);

  it("records sign-in failures and successes in the audit trail without storing the email address", async () => {
    const { email, user } = await makeUser();
    await signInWithStudioCredentials(email, "wrong");
    await signInWithStudioCredentials(email, PASSWORD);

    const rows = await prisma.auditLogEntry.findMany({ where: { entityType: "AuthAttempt", entityId: attemptKey(email) }, orderBy: { timestamp: "asc" } });
    expect(rows.map((r) => r.action)).toEqual(["AUTH_SIGN_IN_FAILED", "AUTH_SIGN_IN_SUCCEEDED"]);
    expect(rows[1].actorId).toBe(user.id);
    expect(JSON.stringify(rows)).not.toContain(email);
  }, T);

  it("verifies a password in EVERY case — a real hash for real accounts, a dummy hash otherwise — so timing does not reveal which", async () => {
    const { email, user } = await makeUser();
    const unknown = uniqueEmail("timing-unknown");
    const disabled = await makeUser();
    await prisma.studioUser.update({ where: { id: disabled.user.id }, data: { status: "DISABLED" } });

    verifySpy.mockClear();
    await signInWithStudioCredentials(email, "wrong");
    expect(verifySpy).toHaveBeenCalledTimes(1);
    expect(verifySpy.mock.calls[0][0]).toBe((await prisma.studioUser.findUniqueOrThrow({ where: { id: user.id } })).passwordHash);

    for (const target of [unknown, disabled.email]) {
      verifySpy.mockClear();
      await signInWithStudioCredentials(target, "wrong");
      expect(verifySpy).toHaveBeenCalledTimes(1); // never skipped
      expect(String(verifySpy.mock.calls[0][0])).toMatch(/^\$argon2/);
    }
  }, T);
});

describe("B. Password-reset requests", () => {
  it("are limited per email; beyond the limit nothing is created or sent, and the response is identical", async () => {
    const { email, user } = await makeUser();
    const formData = new FormData();
    formData.set("email", email);

    for (let i = 0; i < 7; i++) {
      expect(await requestResetAction({}, formData)).toEqual({ submitted: true });
    }

    expect(await countRecentResetRequests(email)).toBe(5);
    expect(await prisma.passwordResetToken.count({ where: { studioUserId: user.id } })).toBe(5);
    expect(sentResets).toHaveLength(5);
    expect(sentResets[0].resetUrl).toMatch(/\/studio\/reset-password\/confirm\?token=/);
  }, T);

  it("answer identically for an unknown address: submitted, no token, no email", async () => {
    const unknown = uniqueEmail("reset-unknown");
    const formData = new FormData();
    formData.set("email", unknown);
    expect(await requestResetAction({}, formData)).toEqual({ submitted: true });
    expect(sentResets).toHaveLength(0);
  }, T);
});

describe("C. The dashboard only shows audit activity to roles with AUDIT_VIEW", () => {
  function collectText(node: ReactNode): string {
    if (node === null || node === undefined || typeof node === "boolean") return "";
    if (typeof node === "string" || typeof node === "number") return String(node);
    if (Array.isArray(node)) return node.map(collectText).join(" ");
    const element = node as { props?: { children?: ReactNode } };
    return collectText(element.props?.children);
  }

  async function dashboardAs(role: "EDITOR" | "ADMINISTRATOR", userId: string) {
    mockGetCurrentStudioSession.mockResolvedValue({ user: { id: userId, role, name: "Dash", email: "d@example.test", status: "ACTIVE" } });
    return collectText(await StudioDashboardPage());
  }

  it("an Editor sees no audit data and the audit log is not even queried; an Administrator sees it", async () => {
    const editor = await makeUser("EDITOR");
    const admin = await makeUser("ADMINISTRATOR");
    // Make sure there is at least one distinctive entry to look for.
    await prisma.auditLogEntry.create({ data: { actorId: admin.user.id, action: "PHASE6J1_DASHBOARD_MARKER", entityType: "StudioUser", entityId: admin.user.id } });

    auditListSpy.mockClear();
    const editorView = await dashboardAs("EDITOR", editor.user.id);
    expect(auditListSpy).not.toHaveBeenCalled();
    expect(editorView).not.toMatch(/PHASE6J1_DASHBOARD_MARKER/);
    expect(editorView).toMatch(/visible to Administrators and above/i);
    expect(editorView).not.toMatch(/View full audit log/);

    const adminView = await dashboardAs("ADMINISTRATOR", admin.user.id);
    expect(auditListSpy).toHaveBeenCalledTimes(1);
    expect(adminView).toMatch(/PHASE6J1_DASHBOARD_MARKER/);
    expect(adminView).toMatch(/View full audit log/);
  }, T);

  it("redirects an unauthenticated visitor instead of rendering", async () => {
    mockGetCurrentStudioSession.mockResolvedValue(null);
    await expect(StudioDashboardPage()).rejects.toMatchObject({ digest: expect.stringContaining("NEXT_REDIRECT") });
    expect(auditListSpy).not.toHaveBeenCalled();
  }, T);
});
