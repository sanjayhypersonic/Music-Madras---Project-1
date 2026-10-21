import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { EmailProvider } from "../../modules/auth/email/emailProvider";
import { prisma } from "../../modules/db/client";
import {
  EMAIL_MAX_ATTEMPTS,
  NotificationInputError,
  countUnreadNotifications,
  emailDeliveryCounts,
  listNotificationsForUser,
  markAllNotificationsRead,
  markNotificationRead,
  processEmailDeliveries,
  raiseNotification,
  resolveNotification,
} from "../../modules/db/repositories/studioNotificationRepository";

// Phase 6K-1 — Studio notifications against the isolated test database: idempotent raising, fingerprint-driven re-notification,
// RBAC visibility, read state, honest email delivery with bounded retries.

const TAG = randomUUID().slice(0, 8);
const T = 60000;
const key = (name: string) => `t6k1-${TAG}-${name}`;
const users = {} as Record<"founder" | "admin" | "editor" | "contributor" | "disabledAdmin", { id: string; email: string }>;
const roleOf = { founder: "FOUNDER", admin: "ADMINISTRATOR", editor: "EDITOR", contributor: "CONTRIBUTOR", disabledAdmin: "ADMINISTRATOR" } as const;

const view = (who: "founder" | "admin" | "editor" | "contributor") => ({ userId: users[who].id, role: roleOf[who] });

class RecordingProvider implements EmailProvider {
  sent: { toEmail: string; subject: string; text: string }[] = [];
  constructor(private readonly failures = 0) {}
  private calls = 0;
  async sendInvitationEmail() {}
  async sendPasswordResetEmail() {}
  async sendStudioNotificationEmail(input: { toEmail: string; subject: string; text: string }) {
    this.calls += 1;
    if (this.calls <= this.failures) throw new Error("535 auth failed for smtps://mailer:SECRET-PASSWORD-123@smtp.example.test:465");
    this.sent.push(input);
  }
}

async function cleanup() {
  await prisma.studioNotification.deleteMany({ where: { OR: [{ dedupeKey: { startsWith: `t6k1-${TAG}` } }, { kind: "NOTIFICATION_DELIVERY_PROBLEM" }] } });
  await prisma.siteSetting.deleteMany({ where: { key: "notifications.email.enabled" } });
}

beforeAll(async () => {
  for (const who of Object.keys(roleOf) as (keyof typeof roleOf)[]) {
    users[who] = await prisma.studioUser.create({
      data: { id: randomUUID(), email: `n6k1-${who}-${TAG}@musicmadras.test`, name: `Notify ${who}`, role: roleOf[who], status: who === "disabledAdmin" ? "DISABLED" : "ACTIVE" },
    });
  }
  await cleanup();
}, T);

afterAll(async () => {
  await cleanup();
  await prisma.auditLogEntry.deleteMany({ where: { actorId: { in: Object.values(users).map((u) => u.id) } } });
  await prisma.studioUser.deleteMany({ where: { id: { in: Object.values(users).map((u) => u.id) } } });
}, T);

describe("raising is idempotent and fingerprint-driven", () => {
  it("creates once, and raising the same unchanged condition again changes nothing", async () => {
    const first = await raiseNotification({ kind: "PLAYLIST_QUALITY_FAILED", dedupeKey: key("a"), title: "Playlist X needs more", body: "Missing: an introduction.", href: "/studio/notifications", contentFingerprint: "v1" });
    expect(first.outcome).toBe("CREATED");
    await markAllNotificationsRead(view("editor"));
    const again = await raiseNotification({ kind: "PLAYLIST_QUALITY_FAILED", dedupeKey: key("a"), title: "Playlist X needs more", body: "Missing: an introduction.", href: "/studio/notifications", contentFingerprint: "v1" });
    expect(again).toEqual({ id: first.id, outcome: "UNCHANGED" });
    const row = await prisma.studioNotification.findUniqueOrThrow({ where: { id: first.id } });
    expect(row.occurrenceCount).toBe(1);
    expect(await prisma.studioNotificationRead.count({ where: { notificationId: first.id } })).toBeGreaterThan(0); // not made unread again
  }, T);

  it("a materially changed condition updates it, counts the occurrence and makes it unread again", async () => {
    const id = (await prisma.studioNotification.findUniqueOrThrow({ where: { dedupeKey: key("a") } })).id;
    const changed = await raiseNotification({ kind: "PLAYLIST_QUALITY_FAILED", dedupeKey: key("a"), title: "Playlist X needs more", body: "Missing: an introduction and sources.", href: "/studio/notifications", contentFingerprint: "v2" });
    expect(changed).toEqual({ id, outcome: "UPDATED" });
    expect((await prisma.studioNotification.findUniqueOrThrow({ where: { id } })).occurrenceCount).toBe(2);
    expect(await prisma.studioNotificationRead.count({ where: { notificationId: id } })).toBe(0);
  }, T);

  it("a resolved condition that recurs reopens the same notification", async () => {
    expect(await resolveNotification(key("a"), "fixed")).toBe(true);
    expect(await resolveNotification(key("a"), "fixed again")).toBe(false); // nothing open
    const reopened = await raiseNotification({ kind: "PLAYLIST_QUALITY_FAILED", dedupeKey: key("a"), title: "Playlist X needs more", body: "Missing again.", contentFingerprint: "v2" });
    expect(reopened.outcome).toBe("REOPENED");
    expect((await prisma.studioNotification.findUniqueOrThrow({ where: { dedupeKey: key("a") } })).status).toBe("OPEN");
  }, T);

  it("simultaneous raises of the same condition produce one row", async () => {
    const results = await Promise.all(Array.from({ length: 6 }, () => raiseNotification({ kind: "PLAYLIST_QUALITY_FAILED", dedupeKey: key("race"), title: "Race", body: "Race body", contentFingerprint: "r" })));
    expect(await prisma.studioNotification.count({ where: { dedupeKey: key("race") } })).toBe(1);
    expect(results.filter((r) => r.outcome === "CREATED")).toHaveLength(1);
  }, T);

  it("refuses unknown kinds, empty text, over-long text, and any link that is not a Studio page", async () => {
    const base = { kind: "PLAYLIST_QUALITY_FAILED" as const, dedupeKey: key("bad"), title: "t", body: "b" };
    await expect(raiseNotification({ ...base, kind: "NOPE" as never })).rejects.toBeInstanceOf(NotificationInputError);
    await expect(raiseNotification({ ...base, title: " " })).rejects.toBeInstanceOf(NotificationInputError);
    await expect(raiseNotification({ ...base, body: "x".repeat(2001) })).rejects.toBeInstanceOf(NotificationInputError);
    await expect(raiseNotification({ ...base, href: "https://evil.example/studio/x" })).rejects.toBeInstanceOf(NotificationInputError);
    await expect(raiseNotification({ ...base, dedupeKey: " " })).rejects.toBeInstanceOf(NotificationInputError);
    await expect(raiseNotification({ ...base, kind: "UNLISTED_REVIEW_PENDING", dedupeKey: key("a") })).rejects.toBeInstanceOf(NotificationInputError); // key belongs to another kind
    expect(await prisma.studioNotification.count({ where: { dedupeKey: key("bad") } })).toBe(0);
  }, T);
});

describe("visibility follows RBAC, and read state is per person", () => {
  it("each role sees only the notifications its permissions allow", async () => {
    await raiseNotification({ kind: "UNLISTED_REVIEW_PENDING", dedupeKey: key("publish"), title: "Videos await a decision", body: "3 unlisted videos.", contentFingerprint: "p1" });
    await raiseNotification({ kind: "NOTIFICATION_DELIVERY_PROBLEM", dedupeKey: key("ops"), title: "Delivery problem", body: "Email is not configured.", contentFingerprint: "o1" });
    const ids = async (who: "founder" | "admin" | "editor" | "contributor") => (await listNotificationsForUser(view(who))).map((n) => n.title);
    expect(await ids("founder")).toEqual(expect.arrayContaining(["Videos await a decision", "Delivery problem", "Race"]));
    expect(await ids("admin")).toEqual(expect.arrayContaining(["Videos await a decision", "Race"]));
    expect(await ids("admin")).not.toContain("Delivery problem");
    expect(await ids("editor")).toContain("Race");
    expect(await ids("editor")).not.toContain("Videos await a decision");
    expect(await ids("editor")).not.toContain("Delivery problem");
    expect(await ids("contributor")).toEqual([]);
    expect(await countUnreadNotifications(view("contributor"))).toBe(0);
  }, T);

  it("a person cannot mark read what they cannot see; reading is per person", async () => {
    const adminOnly = (await prisma.studioNotification.findUniqueOrThrow({ where: { dedupeKey: key("publish") } })).id;
    expect(await markNotificationRead({ id: adminOnly, ...view("editor") })).toBe(false);
    expect(await prisma.studioNotificationRead.count({ where: { notificationId: adminOnly } })).toBe(0);
    const before = await countUnreadNotifications(view("admin"));
    expect(await markNotificationRead({ id: adminOnly, ...view("admin") })).toBe(true);
    expect(await countUnreadNotifications(view("admin"))).toBe(before - 1);
    expect(await countUnreadNotifications(view("founder"))).toBeGreaterThanOrEqual(1); // the founder has not read it
    await markAllNotificationsRead(view("founder"));
    expect(await countUnreadNotifications(view("founder"))).toBe(0);
  }, T);

  it("a resolved notification leaves the inbox (unless history is requested) and no longer counts as unread", async () => {
    await resolveNotification(key("publish"), "decided");
    expect((await listNotificationsForUser(view("admin"))).map((n) => n.title)).not.toContain("Videos await a decision");
    expect((await listNotificationsForUser({ ...view("admin"), includeResolved: true })).map((n) => n.title)).toContain("Videos await a decision");
  }, T);
});

describe("email delivery is optional, bounded and honest", () => {
  it("with the setting off, no email attempt is ever queued", async () => {
    const { id } = await raiseNotification({ kind: "PLAYLIST_QUALITY_FAILED", dedupeKey: key("mail-off"), title: "No email", body: "Body", contentFingerprint: "m0" });
    expect(await prisma.studioNotificationDelivery.count({ where: { notificationId: id } })).toBe(0);
  }, T);

  it("with the setting on, one pending attempt is queued per ELIGIBLE, ACTIVE recipient only", async () => {
    await prisma.siteSetting.create({ data: { key: "notifications.email.enabled", valueJson: true, updatedById: users.founder.id } });
    const { id } = await raiseNotification({ kind: "UNLISTED_REVIEW_PENDING", dedupeKey: key("mail-on"), title: "Decision needed", body: "Body", href: "/studio/notifications", contentFingerprint: "m1" });
    const deliveries = await prisma.studioNotificationDelivery.findMany({ where: { notificationId: id } });
    const recipients = new Set(deliveries.map((d) => d.recipientUserId));
    expect(recipients.has(users.founder.id)).toBe(true);
    expect(recipients.has(users.admin.id)).toBe(true);
    expect(recipients.has(users.editor.id)).toBe(false); // lacks RECORDING_PUBLISH
    expect(recipients.has(users.contributor.id)).toBe(false);
    expect(recipients.has(users.disabledAdmin.id)).toBe(false); // not ACTIVE
    expect(deliveries.every((d) => d.status === "PENDING" && d.attempts === 0)).toBe(true);
  }, T);

  it("a successful send is recorded DELIVERED only after the provider accepted it, with the recipient's address and a link", async () => {
    const provider = new RecordingProvider();
    const summary = await processEmailDeliveries({ provider, authUrl: "https://studio.example.test" });
    expect(summary.delivered).toBeGreaterThanOrEqual(2);
    expect(provider.sent.map((m) => m.toEmail)).toEqual(expect.arrayContaining([users.founder.email, users.admin.email]));
    expect(provider.sent.every((m) => m.subject.startsWith("[Music Madras Studio]") && m.text.includes("https://studio.example.test/studio/notifications"))).toBe(true);
    const delivered = await prisma.studioNotificationDelivery.findMany({ where: { notification: { dedupeKey: key("mail-on") } } });
    expect(delivered.every((d) => d.status === "DELIVERED" && d.attempts === 1)).toBe(true);
    expect((await processEmailDeliveries({ provider })).due).toBe(0); // nothing is sent twice
  }, T);

  it("failures are retried with backoff, then FAILED after the bound; only a scrubbed description is stored (never credentials or hosts); admins are told", async () => {
    await raiseNotification({ kind: "UNLISTED_REVIEW_PENDING", dedupeKey: key("mail-fail"), title: "Will fail", body: "Body", contentFingerprint: "f1" });
    const failing = new RecordingProvider(99);
    const t0 = new Date("2030-01-01T00:00:00Z");
    const first = await processEmailDeliveries({ provider: failing, now: t0, random: () => 0.5, batch: 200 });
    expect(first.retryScheduled).toBeGreaterThan(0);
    const scheduled = await prisma.studioNotificationDelivery.findFirstOrThrow({ where: { notification: { dedupeKey: key("mail-fail") }, status: "PENDING" } });
    expect(scheduled.attempts).toBe(1);
    expect(scheduled.nextAttemptAt!.getTime()).toBe(t0.getTime() + 60_000);
    expect(scheduled.reason).toBe("SEND_FAILED");
    expect((await processEmailDeliveries({ provider: failing, now: new Date(t0.getTime() + 1000) })).due).toBe(0); // not yet due: no hammering

    let now = new Date(t0.getTime() + 60_000);
    await processEmailDeliveries({ provider: failing, now, random: () => 0.5, batch: 200 });
    now = new Date(now.getTime() + 3_600_000);
    const last = await processEmailDeliveries({ provider: failing, now, random: () => 0.5, batch: 200 });
    expect(last.failed).toBeGreaterThan(0);
    const states = await prisma.studioNotificationDelivery.findMany({ where: { notification: { dedupeKey: key("mail-fail") } } });
    expect(states.every((d) => d.status === "FAILED" && d.attempts === EMAIL_MAX_ATTEMPTS && d.reason === "SEND_FAILED")).toBe(true);
    expect(JSON.stringify(states)).not.toMatch(/SECRET-PASSWORD-123|smtps:\/\/|smtp\.example\.test|mailer:/i);
    expect(states.every((d) => /^Error: 535 auth failed/.test(d.lastError ?? "") && d.lastErrorAt !== null && d.claimToken === null)).toBe(true); // a useful, non-sensitive reason is kept
    expect((await listNotificationsForUser(view("founder"))).map((n) => n.title)).toContain("Some notification emails could not be delivered");
  }, T);

  it("an unconfigured deployment SKIPS (never DELIVERED) and administrators are told exactly what is missing", async () => {
    await prisma.studioNotification.deleteMany({ where: { kind: "NOTIFICATION_DELIVERY_PROBLEM" } });
    await raiseNotification({ kind: "UNLISTED_REVIEW_PENDING", dedupeKey: key("mail-unconfigured"), title: "Cannot be emailed", body: "Body", contentFingerprint: "u1" });
    const before = await emailDeliveryCounts();
    const summary = await processEmailDeliveries({}); // no provider injected: the test environment has no real email delivery
    expect(summary.skipped).toBeGreaterThan(0);
    expect(summary.delivered).toBe(0);
    const rows = await prisma.studioNotificationDelivery.findMany({ where: { notification: { dedupeKey: key("mail-unconfigured") } } });
    expect(rows.every((d) => d.status === "SKIPPED" && d.reason === "EMAIL_NOT_CONFIGURED")).toBe(true);
    expect((await emailDeliveryCounts()).delivered).toBe(before.delivered);
    const problem = (await listNotificationsForUser(view("founder"))).find((n) => n.kind === "NOTIFICATION_DELIVERY_PROBLEM");
    expect(problem?.title).toMatch(/not configured/i);
    expect((await listNotificationsForUser(view("editor"))).some((n) => n.kind === "NOTIFICATION_DELIVERY_PROBLEM")).toBe(false); // only those who can fix it
  }, T);

  it("a notification resolved before its email is attempted is skipped, not sent", async () => {
    const { id } = await raiseNotification({ kind: "UNLISTED_REVIEW_PENDING", dedupeKey: key("mail-resolved"), title: "Resolved in time", body: "Body", contentFingerprint: "x1" });
    await resolveNotification(key("mail-resolved"), "decided");
    const provider = new RecordingProvider();
    await processEmailDeliveries({ provider });
    expect(provider.sent.some((m) => m.subject.includes("Resolved in time"))).toBe(false);
    const rows = await prisma.studioNotificationDelivery.findMany({ where: { notificationId: id } });
    expect(rows.every((d) => d.status === "SKIPPED" && d.reason === "RESOLVED")).toBe(true);
  }, T);
});
