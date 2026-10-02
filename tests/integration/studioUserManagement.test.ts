import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "crypto";

// Must be at the true top level — vi.mock is hoisted above every import.
const mockGetCurrentStudioSession = vi.fn();
vi.mock("../../modules/auth/authService", () => ({
  getCurrentStudioSession: () => mockGetCurrentStudioSession(),
}));

const emailState: { mode: "ok" | "unconfigured" | "fail"; sent: Array<{ toEmail: string; inviteUrl: string; invitedByName: string }> } = { mode: "ok", sent: [] };
vi.mock("../../modules/auth/email/emailProvider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../modules/auth/email/emailProvider")>();
  return {
    ...actual,
    getConfiguredEmailProvider: () => {
      if (emailState.mode === "unconfigured") throw new actual.EmailNotConfiguredError("not configured");
      return {
        async sendInvitationEmail(input: { toEmail: string; inviteUrl: string; invitedByName: string }) {
          if (emailState.mode === "fail") throw new actual.EmailDeliveryError();
          emailState.sent.push(input);
        },
        async sendPasswordResetEmail() {},
      };
    },
  };
});

import { prisma } from "../../modules/db/client";
import { hashPassword } from "../../modules/auth/passwordHashing";
import { createInvitation, InvitationError } from "../../modules/db/repositories/invitationRepository";
import {
  changeStudioUserRole,
  disableStudioUser,
  reactivateStudioUser,
  UserManagementError,
} from "../../modules/db/repositories/studioUserAdminRepository";
import { changeRoleAction, disableUserAction, inviteUserAction, reactivateUserAction } from "../../app/(studio)/studio/(protected)/users/actions";
import type { StudioRoleName } from "../../modules/auth/types";

// Phase 6J-1 — user-management rules enforced by the repositories, against a
// real database with disposable users. The pure rule matrix is exercised
// exhaustively in tests/unit/userManagementRules.test.ts; this proves the
// enforcement is wired in, atomic, audited and reachable from the Server Actions.

const TAG = "phase6j1um";
const TOKEN = randomUUID().slice(0, 8);
const T = 120000;

const createdEmails: string[] = [];
const createdUserIds: string[] = [];

async function makeUser(role: StudioRoleName, over: { status?: "ACTIVE" | "DISABLED" | "INVITED"; password?: boolean; label?: string } = {}) {
  const email = `${TAG}-${over.label ?? role.toLowerCase()}-${randomUUID().slice(0, 6)}-${TOKEN}@musicmadras.test`;
  createdEmails.push(email);
  const user = await prisma.studioUser.create({
    data: {
      id: randomUUID(),
      email,
      name: `UM ${over.label ?? role}`,
      role,
      status: over.status ?? "ACTIVE",
      passwordHash: over.password === false ? null : await hashPassword(`pw-${randomUUID()}`),
    },
  });
  createdUserIds.push(user.id);
  return user;
}

const reload = (id: string) => prisma.studioUser.findUniqueOrThrow({ where: { id } });

function extractRedirectPath(err: unknown): string {
  if (typeof err === "object" && err !== null && "digest" in err) {
    const digest = (err as { digest: unknown }).digest;
    if (typeof digest === "string" && digest.startsWith("NEXT_REDIRECT")) return digest.split(";").slice(2, -2).join(";");
  }
  throw err;
}
async function redirectOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (err) {
    return decodeURIComponent(extractRedirectPath(err).replace(/\+/g, " "));
  }
  throw new Error("Action did not redirect");
}
function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
}
async function refusalOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (err) {
    if (err instanceof UserManagementError) return err.reason;
    throw err;
  }
  return "NO_REFUSAL";
}

beforeEach(() => {
  emailState.mode = "ok";
  emailState.sent = [];
});

afterAll(async () => {
  await prisma.auditLogEntry.deleteMany({ where: { OR: [{ entityType: "StudioUser", entityId: { in: createdUserIds } }, { actorId: { in: createdUserIds } }] } });
  await prisma.invitation.deleteMany({ where: { email: { in: createdEmails } } });
  await prisma.studioSession.deleteMany({ where: { studioUserId: { in: createdUserIds } } });
  await prisma.studioUser.deleteMany({ where: { email: { in: createdEmails } } });
}, T);

beforeAll(() => {
  // The real Founder account exists in this database and is never touched: every user below is a disposable fixture.
});

describe("A. The Founder is protected", () => {
  it("a Super Administrator cannot disable the Founder or change the Founder's role", async () => {
    const founder = await makeUser("FOUNDER", { label: "founder" });
    const sa = await makeUser("SUPER_ADMINISTRATOR", { label: "sa" });

    expect(await refusalOf(() => disableStudioUser(founder.id, sa.id))).toBe("FOUNDER_PROTECTED");
    expect(await refusalOf(() => changeStudioUserRole(founder.id, "EDITOR", sa.id))).toBe("FOUNDER_PROTECTED");

    const after = await reload(founder.id);
    expect(after.status).toBe("ACTIVE");
    expect(after.role).toBe("FOUNDER");
    expect(await prisma.auditLogEntry.count({ where: { entityType: "StudioUser", entityId: founder.id } })).toBe(0);
  }, T);

  it("even another Founder-level account cannot disable or demote the Founder, and nobody can be made Founder", async () => {
    const founder = await makeUser("FOUNDER", { label: "f1" });
    const other = await makeUser("FOUNDER", { label: "f2" });
    const sa = await makeUser("SUPER_ADMINISTRATOR", { label: "sa2" });

    expect(await refusalOf(() => disableStudioUser(founder.id, other.id))).toBe("FOUNDER_PROTECTED");
    expect(await refusalOf(() => changeStudioUserRole(founder.id, "EDITOR", other.id))).toBe("FOUNDER_PROTECTED");
    expect(await refusalOf(() => changeStudioUserRole(sa.id, "FOUNDER", other.id))).toBe("FOUNDER_ROLE_NOT_ASSIGNABLE");
    expect((await reload(sa.id)).role).toBe("SUPER_ADMINISTRATOR");
  }, T);
});

describe("B. No lockout and no rank games", () => {
  it("nobody can disable themselves or change their own role", async () => {
    const sa = await makeUser("SUPER_ADMINISTRATOR", { label: "self" });
    expect(await refusalOf(() => disableStudioUser(sa.id, sa.id))).toBe("SELF_DISABLE");
    expect(await refusalOf(() => changeStudioUserRole(sa.id, "EDITOR", sa.id))).toBe("SELF_ROLE_CHANGE");
    const after = await reload(sa.id);
    expect([after.status, after.role]).toEqual(["ACTIVE", "SUPER_ADMINISTRATOR"]);
  }, T);

  it("a Super Administrator cannot demote or disable a peer, or promote anyone to their own rank", async () => {
    const sa = await makeUser("SUPER_ADMINISTRATOR", { label: "actor" });
    const peer = await makeUser("SUPER_ADMINISTRATOR", { label: "peer" });
    const editor = await makeUser("EDITOR", { label: "ed" });

    expect(await refusalOf(() => disableStudioUser(peer.id, sa.id))).toBe("TARGET_RANK_TOO_HIGH");
    expect(await refusalOf(() => changeStudioUserRole(peer.id, "EDITOR", sa.id))).toBe("TARGET_RANK_TOO_HIGH");
    expect(await refusalOf(() => changeStudioUserRole(editor.id, "SUPER_ADMINISTRATOR", sa.id))).toBe("ROLE_RANK_TOO_HIGH");
    expect((await reload(peer.id)).role).toBe("SUPER_ADMINISTRATOR");
    expect((await reload(editor.id)).role).toBe("EDITOR");
  }, T);

  it("a legitimate change succeeds, is audited with before/after, and a disable revokes sessions", async () => {
    const founder = await makeUser("FOUNDER", { label: "boss" });
    const target = await makeUser("EDITOR", { label: "target" });
    await prisma.studioSession.create({ data: { sessionToken: randomUUID(), studioUserId: target.id, expires: new Date(Date.now() + 60_000) } });

    await changeStudioUserRole(target.id, "ADMINISTRATOR", founder.id);
    const changed = await prisma.auditLogEntry.findFirstOrThrow({ where: { entityType: "StudioUser", entityId: target.id, action: "STUDIO_USER_ROLE_CHANGED" } });
    expect(changed.beforeSnapshot).toMatchObject({ role: "EDITOR" });
    expect(changed.afterSnapshot).toMatchObject({ role: "ADMINISTRATOR" });

    await disableStudioUser(target.id, founder.id);
    expect((await reload(target.id)).status).toBe("DISABLED");
    expect(await prisma.studioSession.count({ where: { studioUserId: target.id } })).toBe(0);
  }, T);

  it("two simultaneous disables of the same user: exactly one wins, the other is refused (advisory lock)", async () => {
    const founder = await makeUser("FOUNDER", { label: "racer" });
    const target = await makeUser("EDITOR", { label: "race-target" });

    const results = await Promise.allSettled([disableStudioUser(target.id, founder.id), disableStudioUser(target.id, founder.id)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect((rejected.reason as UserManagementError).reason).toBe("ALREADY_DISABLED");
    expect(await prisma.auditLogEntry.count({ where: { entityType: "StudioUser", entityId: target.id, action: "STUDIO_USER_DISABLED" } })).toBe(1);
  }, T);
});

describe("C. Reactivation cannot bypass invitation acceptance", () => {
  it("an INVITED user cannot be reactivated (they must accept their invitation)", async () => {
    const founder = await makeUser("FOUNDER", { label: "react-boss" });
    const invited = await makeUser("EDITOR", { status: "INVITED", password: false, label: "invited" });
    expect(await refusalOf(() => reactivateStudioUser(invited.id, founder.id))).toBe("MUST_ACCEPT_INVITATION");
    expect((await reload(invited.id)).status).toBe("INVITED");
  }, T);

  it("a DISABLED user with no password cannot be reactivated; one with a password can", async () => {
    const founder = await makeUser("FOUNDER", { label: "react-boss2" });
    const noPassword = await makeUser("EDITOR", { status: "DISABLED", password: false, label: "nopw" });
    const withPassword = await makeUser("EDITOR", { status: "DISABLED", label: "haspw" });

    expect(await refusalOf(() => reactivateStudioUser(noPassword.id, founder.id))).toBe("NO_PASSWORD");
    expect((await reload(noPassword.id)).status).toBe("DISABLED");

    await reactivateStudioUser(withPassword.id, founder.id);
    expect((await reload(withPassword.id)).status).toBe("ACTIVE");
  }, T);
});

describe("D. Invitations obey the same rules", () => {
  it("nobody can invite a FOUNDER, and an inviter can only hand out roles below their own", async () => {
    const founder = await makeUser("FOUNDER", { label: "inv-founder" });
    const sa = await makeUser("SUPER_ADMINISTRATOR", { label: "inv-sa" });
    const admin = await makeUser("ADMINISTRATOR", { label: "inv-admin" });
    const email = (label: string) => {
      const e = `${TAG}-invitee-${label}-${randomUUID().slice(0, 6)}-${TOKEN}@musicmadras.test`;
      createdEmails.push(e);
      return e;
    };

    await expect(createInvitation(email("f"), "FOUNDER", founder.id, "X")).rejects.toThrow(InvitationError);
    await expect(createInvitation(email("f2"), "FOUNDER", sa.id, "X")).rejects.toThrow(/Founder/);
    await expect(createInvitation(email("sa"), "SUPER_ADMINISTRATOR", sa.id, "X")).rejects.toThrow(/below your own/);
    await expect(createInvitation(email("admin"), "ADMINISTRATOR", admin.id, "X")).rejects.toThrow(InvitationError);

    const ok = await createInvitation(email("ok"), "ADMINISTRATOR", sa.id, "Fine");
    expect(ok.studioUser.role).toBe("ADMINISTRATOR");
    const fromFounder = await createInvitation(email("ok2"), "SUPER_ADMINISTRATOR", founder.id, "Fine2");
    expect(fromFounder.studioUser.role).toBe("SUPER_ADMINISTRATOR");
    createdUserIds.push(ok.studioUser.id, fromFounder.studioUser.id);
  }, T);

  it("re-inviting a pending user with a higher role is refused — it cannot be used to raise a role unchecked", async () => {
    const sa = await makeUser("SUPER_ADMINISTRATOR", { label: "reinv-sa" });
    const email = `${TAG}-reinvite-${randomUUID().slice(0, 6)}-${TOKEN}@musicmadras.test`;
    createdEmails.push(email);

    const first = await createInvitation(email, "EDITOR", sa.id, "Pending");
    createdUserIds.push(first.studioUser.id);
    await expect(createInvitation(email, "SUPER_ADMINISTRATOR", sa.id, "Pending")).rejects.toThrow(InvitationError);
    expect((await reload(first.studioUser.id)).role).toBe("EDITOR");
  }, T);
});

describe("E. The Server Actions enforce permission and report refusals", () => {
  it("a user without USER_MANAGE cannot invite, disable, reactivate or change roles; nothing changes", async () => {
    const editor = await makeUser("EDITOR", { label: "act-editor" });
    const victim = await makeUser("CONTRIBUTOR", { label: "act-victim" });
    mockGetCurrentStudioSession.mockResolvedValue({ user: { id: editor.id, role: "EDITOR", name: editor.name, email: editor.email, status: "ACTIVE" } });
    const email = `${TAG}-nope-${randomUUID().slice(0, 6)}-${TOKEN}@musicmadras.test`;
    createdEmails.push(email);

    expect(await redirectOf(() => inviteUserAction(form({ email, name: "N", role: "CONTRIBUTOR" })))).toMatch(/permission/i);
    expect(await redirectOf(() => disableUserAction(victim.id))).toMatch(/permission/i);
    expect(await redirectOf(() => reactivateUserAction(victim.id))).toMatch(/permission/i);
    expect(await redirectOf(() => changeRoleAction(victim.id, form({ role: "EDITOR" })))).toMatch(/permission/i);

    expect(await prisma.studioUser.findUnique({ where: { email } })).toBeNull();
    expect((await reload(victim.id)).role).toBe("CONTRIBUTOR");
    expect(emailState.sent).toHaveLength(0);
  }, T);

  it("a refused change surfaces the reason instead of an error page", async () => {
    const sa = await makeUser("SUPER_ADMINISTRATOR", { label: "act-sa" });
    const founder = await makeUser("FOUNDER", { label: "act-founder" });
    mockGetCurrentStudioSession.mockResolvedValue({ user: { id: sa.id, role: "SUPER_ADMINISTRATOR", name: sa.name, email: sa.email, status: "ACTIVE" } });

    expect(await redirectOf(() => disableUserAction(founder.id))).toMatch(/Founder account cannot be disabled/);
    expect(await redirectOf(() => changeRoleAction(sa.id, form({ role: "EDITOR" })))).toMatch(/cannot change your own role/);
    expect(await redirectOf(() => disableUserAction(sa.id))).toMatch(/cannot disable your own account/);
  }, T);

  it("inviting sends the real email with a working link", async () => {
    const sa = await makeUser("SUPER_ADMINISTRATOR", { label: "mail-sa" });
    mockGetCurrentStudioSession.mockResolvedValue({ user: { id: sa.id, role: "SUPER_ADMINISTRATOR", name: sa.name, email: sa.email, status: "ACTIVE" } });
    const email = `${TAG}-mail-${randomUUID().slice(0, 6)}-${TOKEN}@musicmadras.test`;
    createdEmails.push(email);

    const path = await redirectOf(() => inviteUserAction(form({ email, name: "Mail Person", role: "EDITOR" })));
    expect(path).toBe("/studio/users");
    expect(emailState.sent).toHaveLength(1);
    expect(emailState.sent[0].toEmail).toBe(email);
    expect(emailState.sent[0].inviteUrl).toMatch(/\/studio\/accept-invite\?token=[A-Za-z0-9_-]{20,}/);
    expect(emailState.sent[0].invitedByName).toBe(sa.name);
    const created = await prisma.studioUser.findUniqueOrThrow({ where: { email } });
    createdUserIds.push(created.id);
  }, T);

  it("when email is not configured or cannot be delivered, the inviter is told — it is never silent", async () => {
    const sa = await makeUser("SUPER_ADMINISTRATOR", { label: "mail-sa2" });
    mockGetCurrentStudioSession.mockResolvedValue({ user: { id: sa.id, role: "SUPER_ADMINISTRATOR", name: sa.name, email: sa.email, status: "ACTIVE" } });

    const e1 = `${TAG}-unconf-${randomUUID().slice(0, 6)}-${TOKEN}@musicmadras.test`;
    const e2 = `${TAG}-fail-${randomUUID().slice(0, 6)}-${TOKEN}@musicmadras.test`;
    createdEmails.push(e1, e2);

    emailState.mode = "unconfigured";
    expect(await redirectOf(() => inviteUserAction(form({ email: e1, name: "U", role: "EDITOR" })))).toMatch(/email delivery is not configured/i);
    emailState.mode = "fail";
    expect(await redirectOf(() => inviteUserAction(form({ email: e2, name: "U", role: "EDITOR" })))).toMatch(/could not be delivered/i);
    expect(emailState.sent).toHaveLength(0);

    for (const e of [e1, e2]) {
      const u = await prisma.studioUser.findUnique({ where: { email: e } });
      if (u) createdUserIds.push(u.id);
    }
  }, T);
});
