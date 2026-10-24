import { randomUUID } from "crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Must be at the true top level — vi.mock is hoisted above every import.
const mockGetCurrentStudioSession = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("../../modules/auth/authService", () => ({
  getCurrentStudioSession: () => mockGetCurrentStudioSession(),
}));

import { prisma } from "../../modules/db/client";
import { listNotificationsForUser } from "../../modules/db/repositories/studioNotificationRepository";
import { loadIncidentOverview, recordOperationalIncident, recordOperationalIncidentSafely, resolveIncident } from "../../modules/db/repositories/operationalIncidentRepository";
import { resolveIncidentAction } from "../../app/(studio)/studio/(protected)/health/actions";

// Operational incidents (R-15, first slice), against the isolated test database: creation and deduplication, concurrency, safe data, the recurring-incident
// notification (one per kind, announced only when the set of recurring incidents changes, evaluated at most once per window), resolution and reopening, and
// who may see and resolve them. The Organisation-page wiring is proved in recordingRelationshipsCutover.test.ts. Synthetic fixtures only.

const TAG = "phase7inc";
const TOKEN = randomUUID().slice(0, 8);
const T = 120000;
const KIND = "ORGANISATION_PAGE_RECORDING_OMITTED" as const;
const NOTIFICATION_KEY = `operational-incident-recurring-${KIND}`;
const users = {} as Record<"founder" | "superAdmin" | "admin" | "editor", string>;
const subjectIds: string[] = [];
let counter = 0;

const newSubject = () => {
  const id = `${TAG}-${TOKEN}-${++counter}`;
  subjectIds.push(id);
  return { type: "Recording", id };
};
const rec = (subject: { type: string; id: string }, now?: Date, reasonCode = "PUBLISHED_REVISION_NOT_PUBLISHED") => recordOperationalIncident({ kind: KIND, reasonCode, subject }, now);
const rowsFor = (subjectId: string) => prisma.operationalIncident.findMany({ where: { subjectId } });
const notification = () => prisma.studioNotification.findUnique({ where: { dedupeKey: NOTIFICATION_KEY } });
const resetNotification = () => prisma.studioNotification.deleteMany({ where: { dedupeKey: NOTIFICATION_KEY } });
const hours = (n: number) => n * 3_600_000;

function as(role: "FOUNDER" | "SUPER_ADMINISTRATOR" | "ADMINISTRATOR" | "EDITOR", userId: string) {
  mockGetCurrentStudioSession.mockResolvedValue({ user: { id: userId, role, name: role, email: `${role}@example.test`, status: "ACTIVE" } });
}
async function redirectOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (err) {
    const digest = (err as { digest?: unknown })?.digest;
    if (typeof digest === "string" && digest.startsWith("NEXT_REDIRECT")) return decodeURIComponent(digest.split(";").slice(2, -2).join(";").replace(/\+/g, " "));
    throw err;
  }
  throw new Error("Action did not redirect");
}

beforeAll(async () => {
  for (const [key, role] of [["founder", "FOUNDER"], ["superAdmin", "SUPER_ADMINISTRATOR"], ["admin", "ADMINISTRATOR"], ["editor", "EDITOR"]] as const) {
    users[key] = (await prisma.studioUser.create({ data: { id: randomUUID(), email: `${TAG}-${key}-${TOKEN}@musicmadras.test`, name: `Inc ${key}`, role, status: "ACTIVE" } })).id;
  }
  await resetNotification();
}, T);

// Each test starts from this file's own clean slate: the recurring SET of a kind covers every open incident of that kind, so incidents left over from an
// earlier test in this file would change what the notification says. (Only incidents on this file's own subjects are touched.)
beforeEach(async () => {
  await prisma.operationalIncident.deleteMany({ where: { subjectId: { in: subjectIds } } });
  await resetNotification();
});

afterAll(async () => {
  const incidents = await prisma.operationalIncident.findMany({ where: { subjectId: { in: subjectIds } }, select: { id: true } });
  await prisma.auditLogEntry.deleteMany({ where: { OR: [{ entityId: { in: incidents.map((i) => i.id) } }, { actorId: { in: Object.values(users).filter(Boolean) } }] } });
  await prisma.operationalIncident.deleteMany({ where: { subjectId: { in: subjectIds } } });
  await resetNotification();
  await prisma.studioUser.deleteMany({ where: { id: { in: Object.values(users).filter(Boolean) } } });
}, T);

describe("creation and deduplication", () => {
  it("the first occurrence creates one OPEN incident; repeats count and re-timestamp the SAME row", async () => {
    const subject = newSubject();
    const t0 = new Date("2026-03-01T10:00:00Z");
    const first = await rec(subject, t0);
    expect(first).toMatchObject({ created: true, occurrenceCount: 1, notificationEvaluated: false });
    await rec(subject, new Date(t0.getTime() + 1000));
    const third = await rec(subject, new Date(t0.getTime() + 2000));
    expect(third).toMatchObject({ created: false, occurrenceCount: 3 });

    const rows = await rowsFor(subject.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: KIND, status: "OPEN", reasonCode: "PUBLISHED_REVISION_NOT_PUBLISHED", subjectType: "Recording", subjectId: subject.id, occurrenceCount: 3 });
    expect(rows[0].firstSeenAt.getTime()).toBe(t0.getTime());
    expect(rows[0].lastSeenAt.getTime()).toBe(t0.getTime() + 2000);
    await resetNotification();
  }, T);

  it("a different subject or a different reason is a different incident", async () => {
    const a = newSubject();
    const b = newSubject();
    await rec(a);
    await rec(b);
    await rec(a, undefined, "PUBLISHED_REVISION_MISSING");
    expect(await rowsFor(a.id)).toHaveLength(2);
    expect(await rowsFor(b.id)).toHaveLength(1);
    await resetNotification();
  }, T);

  it("20 simultaneous occurrences of one problem make exactly one row with all 20 counted, and exactly one notification announcement", async () => {
    await resetNotification();
    const subject = newSubject();
    await Promise.all(Array.from({ length: 20 }, () => rec(subject)));
    const rows = await rowsFor(subject.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].occurrenceCount).toBe(20);
    const raised = await notification();
    expect(raised).toMatchObject({ kind: "OPERATIONAL_INCIDENT_RECURRING", status: "OPEN" });
    expect(raised!.occurrenceCount).toBe(1); // announced once, not once per request
    await resetNotification();
  }, T);
});

describe("safe data handling", () => {
  it("stores only a code and an id: exception text, a URL or an address passed as input never reaches the table", async () => {
    const subject = newSubject();
    const outcome = await recordOperationalIncident({ kind: KIND, reasonCode: "connect ECONNREFUSED 10.0.0.5:5432 password=hunter2", subject });
    const row = await prisma.operationalIncident.findUniqueOrThrow({ where: { id: outcome.id } });
    expect(row.reasonCode).toBe("UNSPECIFIED");
    const hostile = await recordOperationalIncident({ kind: KIND, reasonCode: "CODE", subject: { type: "Recording", id: "https://evil.example/?token=abc" } });
    const hostileRow = await prisma.operationalIncident.findUniqueOrThrow({ where: { id: hostile.id } });
    expect(hostileRow).toMatchObject({ subjectType: null, subjectId: null });
    for (const r of [row, hostileRow]) expect(JSON.stringify(r)).not.toMatch(/hunter2|ECONNREFUSED|evil\.example|token=/);
    await prisma.operationalIncident.deleteMany({ where: { id: hostile.id } });
    await resetNotification();
  }, T);

  it("an unknown kind is refused outright", async () => {
    await expect(recordOperationalIncident({ kind: "NOT_A_KIND", reasonCode: "CODE" })).rejects.toThrow(/Unknown operational incident kind/);
  }, T);

  it("the safe recorder never throws, even when the database is down, and logs the error CLASS only (never the message)", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const down = vi.spyOn(prisma, "$queryRaw").mockRejectedValue(new Error("connection refused: password=hunter2 host=10.0.0.5"));
    try {
      await expect(recordOperationalIncidentSafely({ kind: KIND, reasonCode: "CODE", subject: newSubject() })).resolves.toBeNull();
      const lines = logged.mock.calls.map((c) => c.map(String).join(" ")).join("\n");
      expect(lines).toContain("could not be recorded");
      expect(lines).not.toMatch(/hunter2|10\.0\.0\.5|connection refused/);
    } finally {
      down.mockRestore();
      logged.mockRestore();
    }
  }, T);
});

describe("the recurring-incident notification", () => {
  it("a first occurrence interrupts nobody; a recurrence raises ONE notification for the administrators only, with counts and no ids", async () => {
    await resetNotification();
    const subject = newSubject();
    await rec(subject);
    expect(await notification()).toBeNull();

    const second = await rec(subject);
    expect(second.notificationEvaluated).toBe(true);
    const raised = (await notification())!;
    expect(raised).toMatchObject({ kind: "OPERATIONAL_INCIDENT_RECURRING", status: "OPEN", audienceAction: "SETTINGS_MANAGE", href: "/studio/health" });
    expect(`${raised.title} ${raised.body}`).not.toContain(subject.id);
    expect(`${raised.title} ${raised.body}`).not.toContain("PUBLISHED_REVISION");

    // Visible to those who may manage settings, to nobody else.
    expect((await listNotificationsForUser({ userId: users.superAdmin, role: "SUPER_ADMINISTRATOR" })).some((n) => n.kind === "OPERATIONAL_INCIDENT_RECURRING")).toBe(true);
    expect((await listNotificationsForUser({ userId: users.founder, role: "FOUNDER" })).some((n) => n.kind === "OPERATIONAL_INCIDENT_RECURRING")).toBe(true);
    for (const [role, userId] of [["ADMINISTRATOR", users.admin], ["EDITOR", users.editor]] as const) {
      expect((await listNotificationsForUser({ userId, role })).some((n) => n.kind === "OPERATIONAL_INCIDENT_RECURRING"), role).toBe(false);
    }
  }, T);

  it("no flood: further occurrences inside the window evaluate nothing and re-announce nothing", async () => {
    await resetNotification();
    const subject = newSubject();
    const t0 = new Date("2026-04-01T09:00:00Z");
    await rec(subject, t0);
    await rec(subject, new Date(t0.getTime() + 1000)); // recurrence: evaluated and announced
    const announcedOnce = (await notification())!;
    await prisma.studioNotificationRead.create({ data: { notificationId: announcedOnce.id, userId: users.superAdmin } }); // an administrator has read it

    for (let i = 2; i < 30; i += 1) {
      const outcome = await rec(subject, new Date(t0.getTime() + i * 1000));
      expect(outcome.notificationEvaluated, `occurrence ${i + 1}`).toBe(false);
    }
    const after = (await notification())!;
    expect(after.occurrenceCount).toBe(1);
    expect(await prisma.studioNotificationRead.count({ where: { notificationId: after.id, userId: users.superAdmin } })).toBe(1); // still read: not announced again
  }, T);

  it("after the window the evaluation runs again but, with the same set of recurring incidents, only refreshes the text silently; a NEW recurring incident announces again", async () => {
    await resetNotification();
    const a = newSubject();
    const t0 = new Date("2026-05-01T09:00:00Z");
    await rec(a, t0);
    await rec(a, new Date(t0.getTime() + 1000));
    const first = (await notification())!;
    await prisma.studioNotificationRead.create({ data: { notificationId: first.id, userId: users.superAdmin } });

    // Two hours later the same incident recurs: evaluated again, same set -> refreshed, not re-announced, still read.
    for (let i = 0; i < 3; i += 1) await rec(a, new Date(t0.getTime() + hours(2) + i * 1000));
    const refreshed = (await notification())!;
    expect(refreshed.occurrenceCount).toBe(1);
    expect(refreshed.body).toMatch(/with (\d+) occurrences/);
    expect(Number(/with (\d+) occurrences/.exec(refreshed.body)![1])).toBeGreaterThan(2);
    expect(await prisma.studioNotificationRead.count({ where: { notificationId: first.id, userId: users.superAdmin } })).toBe(1);

    // A second distinct problem starts recurring: the set grew, so administrators are told afresh (unread again).
    const b = newSubject();
    await rec(b, new Date(t0.getTime() + hours(3)));
    await rec(b, new Date(t0.getTime() + hours(3) + 1000));
    const announced = (await notification())!;
    expect(announced.occurrenceCount).toBe(2);
    expect(await prisma.studioNotificationRead.count({ where: { notificationId: first.id } })).toBe(0);
    expect(announced.body).toMatch(/2 distinct problems are open/);
  }, T);
});

describe("the operator alert when an incident recurs (ALERT_WEBHOOK_URL)", () => {
  const WEBHOOK = "https://hooks.example.test/services/T1/B1/integration-webhook-token";
  const sent: Array<{ url: string; body: Record<string, unknown> }> = [];

  it("sends ONE alert at the recurrence, none at the first occurrence or inside the window, with only a code (no subject id, no URL), and never when unconfigured", async () => {
    const { resetAlertCooldowns } = await import("../../modules/ops/operatorAlert");
    resetAlertCooldowns();
    sent.length = 0;
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      sent.push({ url, body: JSON.parse(init.body as string) });
      return new Response("ok", { status: 200 });
    });
    try {
      // unconfigured: the recurrence is still evaluated, but nothing leaves the process
      const quiet = newSubject();
      const t0 = new Date("2026-05-01T09:00:00Z");
      await rec(quiet, t0);
      expect((await rec(quiet, new Date(t0.getTime() + 1000))).notificationEvaluated).toBe(true);
      expect(sent).toHaveLength(0);

      vi.stubEnv("ALERT_WEBHOOK_URL", WEBHOOK);
      await prisma.operationalIncident.deleteMany({ where: { subjectId: quiet.id } });
      await resetNotification();
      resetAlertCooldowns();
      const subject = newSubject();
      await rec(subject, t0);
      expect(sent).toHaveLength(0); // a first occurrence interrupts nobody
      expect((await rec(subject, new Date(t0.getTime() + 1000))).notificationEvaluated).toBe(true);
      expect(sent).toHaveLength(1);
      expect(sent[0].url).toBe(WEBHOOK);
      expect(sent[0].body).toMatchObject({ event: "operator_alert", kind: "INCIDENT_RECURRING", code: "PUBLISHED_REVISION_NOT_PUBLISHED" });
      expect(JSON.stringify(sent[0].body)).not.toContain(subject.id);
      expect(JSON.stringify(sent[0].body)).not.toContain("integration-webhook-token");
      for (let i = 2; i < 12; i += 1) await rec(subject, new Date(t0.getTime() + i * 1000));
      expect(sent).toHaveLength(1); // inside the window: no flood
    } finally {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
    }
  }, T);

  it("a broken alert destination never stops the incident from being recorded or the in-app notification from being raised", async () => {
    const { resetAlertCooldowns } = await import("../../modules/ops/operatorAlert");
    resetAlertCooldowns();
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("getaddrinfo ENOTFOUND hooks.example.test");
    });
    vi.stubEnv("ALERT_WEBHOOK_URL", WEBHOOK);
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const subject = newSubject();
      await rec(subject);
      const outcome = await rec(subject);
      expect(outcome.notificationEvaluated).toBe(true);
      expect((await rowsFor(subject.id))[0].occurrenceCount).toBe(2);
      expect(await notification()).not.toBeNull();
      expect(logged.mock.calls.map((c) => c.join(" ")).join("\n")).not.toContain("integration-webhook-token");
    } finally {
      logged.mockRestore();
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
    }
  }, T);
});

describe("resolution and reopening", () => {
  it("resolving keeps the incident on record, resolves the notification when nothing recurring is left, and audits who did it", async () => {
    await resetNotification();
    const subject = newSubject();
    await rec(subject);
    const recurred = await rec(subject);
    expect(await notification()).toMatchObject({ status: "OPEN" });

    expect(await resolveIncident({ id: recurred.id, actorId: users.superAdmin })).toBe(true);
    const row = await prisma.operationalIncident.findUniqueOrThrow({ where: { id: recurred.id } });
    expect(row).toMatchObject({ status: "RESOLVED", resolvedById: users.superAdmin, occurrenceCount: 2 });
    expect(row.resolvedAt).not.toBeNull();
    expect(await notification()).toMatchObject({ status: "RESOLVED" });
    expect(await prisma.auditLogEntry.count({ where: { action: "OPERATIONAL_INCIDENT_RESOLVED", entityId: recurred.id, actorId: users.superAdmin } })).toBe(1);
    expect(await resolveIncident({ id: recurred.id, actorId: users.superAdmin })).toBe(false); // nothing open to resolve twice
  }, T);

  it("a resolved incident that happens again is REOPENED (count continues) and administrators are notified at once, without waiting out the window", async () => {
    await resetNotification();
    const subject = newSubject();
    const t0 = new Date("2026-06-01T09:00:00Z");
    await rec(subject, t0);
    const second = await rec(subject, new Date(t0.getTime() + 1000));
    await resolveIncident({ id: second.id, actorId: users.superAdmin }, new Date(t0.getTime() + 2000));
    expect(await notification()).toMatchObject({ status: "RESOLVED" });

    const again = await rec(subject, new Date(t0.getTime() + 3000)); // seconds later: inside what would have been the window
    expect(again).toMatchObject({ created: false, occurrenceCount: 3, notificationEvaluated: true });
    const row = await prisma.operationalIncident.findUniqueOrThrow({ where: { id: second.id } });
    expect(row).toMatchObject({ status: "OPEN", resolvedAt: null, resolvedById: null });
    expect(await notification()).toMatchObject({ status: "OPEN" }); // reopened and announced again
  }, T);

  it("the overview lists open incidents with counts and the number resolved", async () => {
    const subject = newSubject();
    await rec(subject);
    await rec(subject);
    const overview = await loadIncidentOverview(500);
    const mine = overview.open.find((i) => i.subjectId === subject.id)!;
    expect(mine).toMatchObject({ kind: KIND, occurrenceCount: 2, recurring: true, reasonCode: "PUBLISHED_REVISION_NOT_PUBLISHED" });
    expect(mine.kindLabel.length).toBeGreaterThan(10);
    expect(overview.openCount).toBeGreaterThanOrEqual(1);
    expect(overview.resolvedCount).toBeGreaterThanOrEqual(0);
  }, T);
});

describe("who may see and resolve incidents (Studio -> Health)", () => {
  it("only SETTINGS_MANAGE (Super Administrator, Founder) can resolve; Administrator and Editor are refused and the incident stays open", async () => {
    const subject = newSubject();
    const outcome = await rec(subject);
    for (const [role, userId] of [["ADMINISTRATOR", users.admin], ["EDITOR", users.editor]] as const) {
      as(role, userId);
      expect(await redirectOf(() => resolveIncidentAction(outcome.id)), role).toMatch(/do not have permission/i);
      expect((await prisma.operationalIncident.findUniqueOrThrow({ where: { id: outcome.id } })).status, role).toBe("OPEN");
    }
    mockGetCurrentStudioSession.mockResolvedValue(null); // signed out
    expect(await redirectOf(() => resolveIncidentAction(outcome.id))).toMatch(/do not have permission/i);
    expect((await prisma.operationalIncident.findUniqueOrThrow({ where: { id: outcome.id } })).status).toBe("OPEN");

    as("SUPER_ADMINISTRATOR", users.superAdmin);
    expect(await redirectOf(() => resolveIncidentAction(outcome.id))).toBe("/studio/health");
    expect((await prisma.operationalIncident.findUniqueOrThrow({ where: { id: outcome.id } })).status).toBe("RESOLVED");
  }, T);
});
