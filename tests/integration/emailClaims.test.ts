import { randomUUID } from "crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../modules/db/client";
import { SmtpEmailProvider } from "../../modules/auth/email/emailProvider";
import { updateSiteSetting } from "../../modules/db/repositories/siteSettingRepository";
import { EMAIL_CLAIM_LEASE_MS, emailDeliveryHealth, processEmailDeliveries, raiseNotification, resolveNotification } from "../../modules/db/repositories/studioNotificationRepository";

// Phase 6K lifecycle hardening, F7 — email delivery reliability: a delivery is CLAIMED for a lease before it is sent, so an overlapping worker (even one
// that starts later) does not send it too; failures are never silent and never store anything sensitive; re-raising a notification cannot delete or
// invalidate a claim; an accepted send whose outcome cannot be written is reported and (honestly) may be sent again — delivery is at-least-once.
// A recording transport stands in for the mail service: nothing is ever sent, no provider is configured, no real mail leaves the machine.

const TAG = randomUUID().slice(0, 8);
const T = 60000;
const users = {} as Record<"a" | "b", { id: string; email: string }>;
const KEYS: string[] = [];
let counter = 0;
const sent: Array<{ to: string; subject: string; text: string }> = [];
const control = { delayMs: 0, failWith: null as Error | null };

function provider() {
  return new SmtpEmailProvider(
    {
      async sendMail(message) {
        if (control.delayMs) await new Promise((resolve) => setTimeout(resolve, control.delayMs));
        if (control.failWith) throw control.failWith;
        sent.push({ to: message.to, subject: message.subject, text: message.text });
        return { accepted: [message.to] };
      },
    },
    "Music Madras <studio@example.test>"
  );
}

/** Raises a notification and returns it with ONLY this file's two people as recipients (anyone else in the database is set aside, so counts are exact). */
async function raise(title?: string, fingerprint?: string, key?: string) {
  const dedupeKey = key ?? `ec-${TAG}-${++counter}`;
  if (!KEYS.includes(dedupeKey)) KEYS.push(dedupeKey);
  const result = await raiseNotification({ kind: "UNLISTED_REVIEW_PENDING", dedupeKey, title: title ?? `Claims ${TAG} ${counter}`, body: "Something needs a decision.", href: "/studio/catalogue/unlisted-review", contentFingerprint: fingerprint ?? `f${counter}` });
  await prisma.studioNotificationDelivery.updateMany({ where: { notificationId: result.id, recipientUserId: { notIn: [users.a.id, users.b.id] } }, data: { status: "SKIPPED", reason: "NOT_ELIGIBLE" } });
  return { id: result.id, key: dedupeKey };
}
const deliveries = (notificationId: string) => prisma.studioNotificationDelivery.findMany({ where: { notificationId, recipientUserId: { in: [users.a.id, users.b.id] } }, orderBy: { recipientUserId: "asc" } });
const mailTo = (email: string, titlePart: string) => sent.filter((m) => m.to === email && m.subject.includes(titlePart));
async function setEmailEnabled(enabled: boolean) {
  const row = await prisma.siteSetting.findUnique({ where: { key: "notifications.email.enabled" } });
  await updateSiteSetting({ key: "notifications.email.enabled", value: enabled, expectedVersion: row?.version ?? 0, actorId: users.a.id });
}

beforeAll(async () => {
  for (const who of ["a", "b"] as const) {
    const email = `x6kc-${who}-${TAG}@musicmadras.test`;
    users[who] = { id: (await prisma.studioUser.create({ data: { id: randomUUID(), email, name: `Claims ${who}`, role: "ADMINISTRATOR", status: "ACTIVE" } })).id, email };
  }
  await setEmailEnabled(true);
}, T);

afterEach(() => {
  sent.length = 0;
  control.delayMs = 0;
  control.failWith = null;
  vi.restoreAllMocks();
});

afterAll(async () => {
  await prisma.studioNotification.deleteMany({ where: { OR: [{ dedupeKey: { in: KEYS } }, { dedupeKey: { startsWith: "notification-delivery:" } }] } });
  await prisma.siteSetting.deleteMany({ where: { key: "notifications.email.enabled" } });
  await prisma.auditLogEntry.deleteMany({ where: { actorId: { in: [users.a.id, users.b.id] } } });
  await prisma.studioUser.deleteMany({ where: { id: { in: [users.a.id, users.b.id] } } });
}, T);

describe("a delivery is claimed for a lease before it is sent", () => {
  it("a worker that starts AFTER another has claimed a delivery does not send it too (the claim lasts for the lease, not just the instant)", async () => {
    const { id } = await raise(`Later ${TAG}`);
    control.delayMs = 150;
    const first = processEmailDeliveries({ provider: provider() });
    // Wait (bounded) until the first worker holds a claim and is mid-send.
    let claimed = (await deliveries(id)).filter((d) => d.claimToken !== null);
    for (let i = 0; i < 100 && claimed.length === 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      claimed = (await deliveries(id)).filter((d) => d.claimToken !== null);
    }
    expect(claimed.length).toBe(1);
    expect(claimed[0].claimedUntil!.getTime()).toBeGreaterThan(Date.now() + EMAIL_CLAIM_LEASE_MS - 10_000);
    const health = await emailDeliveryHealth();
    expect(health.inFlight).toBeGreaterThanOrEqual(1); // visible as in flight, not as stalled

    const second = await processEmailDeliveries({ provider: provider() });
    await first;
    for (const who of ["a", "b"] as const) expect(mailTo(users[who].email, `Later ${TAG}`), who).toHaveLength(1); // never doubled
    expect(second.delivered + (await deliveries(id)).filter((d) => d.status === "DELIVERED").length).toBeGreaterThanOrEqual(2);
    expect((await deliveries(id)).every((d) => d.status === "DELIVERED" && d.claimToken === null && d.claimedUntil === null && d.attempts === 1)).toBe(true);
  }, T);

  it("a delivery under a live claim is left to its worker; one whose claim has expired (a crashed worker) is taken again", async () => {
    const { id } = await raise(`Expiry ${TAG}`);
    const [a, b] = await deliveries(id);
    await prisma.studioNotificationDelivery.update({ where: { id: a.id }, data: { attempts: 1, claimToken: "someone-else", claimedUntil: new Date(Date.now() + 120_000) } });
    await prisma.studioNotificationDelivery.update({ where: { id: b.id }, data: { attempts: 1, claimToken: "a-dead-worker", claimedUntil: new Date(Date.now() - 1000) } });
    const summary = await processEmailDeliveries({ provider: provider() });
    const after = await deliveries(id);
    const liveOne = after.find((d) => d.id === a.id)!;
    const retaken = after.find((d) => d.id === b.id)!;
    expect(liveOne).toMatchObject({ status: "PENDING", claimToken: "someone-else", attempts: 1 }); // untouched
    expect(retaken).toMatchObject({ status: "DELIVERED", claimToken: null, claimedUntil: null, attempts: 2 });
    const retakenEmail = retaken.recipientUserId === users.a.id ? users.a.email : users.b.email;
    expect(sent.filter((m) => m.subject.includes(`Expiry ${TAG}`)).map((m) => m.to)).toEqual([retakenEmail]); // only the delivery nobody held was sent
    expect(summary.delivered).toBeGreaterThanOrEqual(1);
  }, T);

  it("two workers started at the same moment still send each delivery once", async () => {
    const { id } = await raise(`Same moment ${TAG}`);
    control.delayMs = 40;
    await Promise.all([processEmailDeliveries({ provider: provider() }), processEmailDeliveries({ provider: provider() }), processEmailDeliveries({ provider: provider() })]);
    for (const who of ["a", "b"] as const) expect(mailTo(users[who].email, `Same moment ${TAG}`), who).toHaveLength(1);
    expect((await deliveries(id)).every((d) => d.status === "DELIVERED")).toBe(true);
  }, T);
});

describe("a send is never silent when it fails", () => {
  it("logs a scrubbed description, stores it on the delivery, counts it, releases the claim, and keeps credentials and addresses out of everything", async () => {
    const { id } = await raise(`Failing ${TAG}`);
    control.failWith = Object.assign(new Error(`535 auth failed for smtps://mailer:SECRET-PASSWORD-123@smtp.example.test:465 (recipient ${users.a.email})`), { code: "EAUTH", responseCode: 535 });
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const summary = await processEmailDeliveries({ provider: provider(), random: () => 0.5 });
    expect(summary.retryScheduled).toBeGreaterThanOrEqual(2);
    expect(log).toHaveBeenCalled();
    const logged = log.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(logged).toMatch(/failed on attempt 1 of 3/);
    for (const rows of [await deliveries(id)]) {
      for (const row of rows) {
        expect(row).toMatchObject({ status: "PENDING", attempts: 1, reason: "SEND_FAILED", claimToken: null, claimedUntil: null });
        expect(row.lastError).toBe("EmailDeliveryError: The email could not be delivered. (EAUTH 535)"); // the transport's own codes, never its message
        expect(row.lastErrorAt).not.toBeNull();
        expect(row.nextAttemptAt).not.toBeNull();
      }
    }
    const everything = JSON.stringify(await deliveries(id)) + logged;
    for (const secret of ["SECRET-PASSWORD-123", "smtps://", "smtp.example.test", users.a.email, users.b.email]) expect(everything).not.toContain(secret);
  }, T);

  it("after the last attempt the delivery is FAILED with the reason kept, and administrators are told", async () => {
    const { id } = await raise(`Exhausted ${TAG}`);
    control.failWith = Object.assign(new Error("550 mailbox unavailable for someone@example.test"), { code: "EENVELOPE", responseCode: 550 });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    let now = new Date();
    for (let attempt = 1; attempt <= 3; attempt++) {
      await processEmailDeliveries({ provider: provider(), now, random: () => 0.5, batch: 500 });
      now = new Date(now.getTime() + 3 * 3_600_000);
    }
    const rows = await deliveries(id);
    expect(rows.every((r) => r.status === "FAILED" && r.attempts === 3 && r.lastError === "EmailDeliveryError: The email could not be delivered. (EENVELOPE 550)" && r.claimToken === null)).toBe(true);
    expect(JSON.stringify(rows)).not.toContain("someone@example.test");
    expect((await prisma.studioNotification.findUniqueOrThrow({ where: { dedupeKey: "notification-delivery:email-send-failed" } })).status).toBe("OPEN");
  }, T);
});

describe("re-raising a notification never deletes or invalidates a delivery that is being sent", () => {
  it("an in-flight delivery keeps its claim and its row; its send is recorded; it then goes back to PENDING and the newer text is sent too", async () => {
    const { id, key } = await raise(`Episode one ${TAG}`, "episode-1");
    control.delayMs = 200;
    const run = processEmailDeliveries({ provider: provider() });
    await new Promise((resolve) => setTimeout(resolve, 80));
    const before = await deliveries(id);
    const inFlight = before.find((d) => d.claimToken !== null)!;
    expect(inFlight).toBeDefined();

    await raise(`Episode two ${TAG}`, "episode-2", key); // a new episode while a send is in flight
    const during = await deliveries(id);
    expect(during.map((d) => d.id).sort()).toEqual(before.map((d) => d.id).sort()); // nothing deleted
    const keptClaim = during.find((d) => d.id === inFlight.id)!;
    expect(keptClaim).toMatchObject({ claimToken: inFlight.claimToken, requeueAfterClaim: true }); // the claim is intact, and the delivery is marked to go again
    const other = during.find((d) => d.id !== inFlight.id)!;
    expect(other).toMatchObject({ status: "PENDING", attempts: 0, claimToken: null }); // a delivery nobody holds simply starts afresh

    await run;
    const afterFirstRun = await deliveries(id);
    const requeued = afterFirstRun.find((d) => d.id === inFlight.id)!;
    expect(requeued).toMatchObject({ status: "PENDING", attempts: 0, claimToken: null, requeueAfterClaim: false }); // recorded, then ready for the new text
    const inFlightRecipient = requeued.recipientUserId === users.a.id ? users.a : users.b;
    expect(mailTo(inFlightRecipient.email, `Episode one ${TAG}`)).toHaveLength(1); // what was in flight carried the text it was claimed with
    const otherRecipient = inFlightRecipient === users.a ? users.b : users.a;
    expect(mailTo(otherRecipient.email, `Episode two ${TAG}`)).toHaveLength(1); // a worker sends the notification as it is NOW

    control.delayMs = 0;
    await processEmailDeliveries({ provider: provider() });
    expect(mailTo(inFlightRecipient.email, `Episode two ${TAG}`)).toHaveLength(1); // and the in-flight recipient gets the newer text afterwards
    expect((await deliveries(id)).every((d) => d.status === "DELIVERED")).toBe(true);
  }, T);

  it("a reopened notification (resolved, then raised again) delivers afresh without losing the earlier delivery history rows", async () => {
    const { id, key } = await raise(`Reopen ${TAG}`, "r1");
    await processEmailDeliveries({ provider: provider() });
    const first = (await deliveries(id)).map((d) => d.id).sort();
    expect((await deliveries(id)).every((d) => d.status === "DELIVERED")).toBe(true);
    await resolveNotification(key, "done");
    await raise(`Reopen ${TAG}`, "r2", key);
    expect((await deliveries(id)).map((d) => d.id).sort()).toEqual(first); // the same rows, reset: nothing deleted
    expect((await deliveries(id)).every((d) => d.status === "PENDING" && d.attempts === 0)).toBe(true);
    await processEmailDeliveries({ provider: provider() });
    for (const who of ["a", "b"] as const) expect(mailTo(users[who].email, `Reopen ${TAG}`), who).toHaveLength(2); // once per episode
  }, T);

  it("a notification resolved after the batch was loaded is not sent (the worker re-reads it after claiming)", async () => {
    const { id, key } = await raise(`Resolved late ${TAG}`);
    control.delayMs = 120;
    const run = processEmailDeliveries({ provider: provider() });
    await new Promise((resolve) => setTimeout(resolve, 50)); // one is in flight, the other not yet claimed
    await resolveNotification(key, "no longer applies");
    await run;
    const rows = await deliveries(id);
    expect(rows.filter((d) => d.status === "DELIVERED")).toHaveLength(1);
    expect(rows.filter((d) => d.status === "SKIPPED" && d.reason === "RESOLVED")).toHaveLength(1);
    expect(sent.filter((m) => m.subject.includes(`Resolved late ${TAG}`))).toHaveLength(1);
  }, T);
});

describe("an accepted send whose outcome cannot be recorded (the honest at-least-once limit)", () => {
  it("is reported as unrecorded, stays claimed (so it is not hammered), is NOT claimed as delivered, and is sent again once its claim expires", async () => {
    const { id } = await raise(`Unrecorded ${TAG}`);
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const t0 = new Date();
    const summary = await processEmailDeliveries({ provider: provider(), now: t0, recordRetryDelayMs: 1, beforeRecordOutcome: async () => { throw new Error("the database went away"); } });
    expect(summary.unrecorded).toBe(2);
    expect(summary.delivered).toBe(0);
    for (const who of ["a", "b"] as const) expect(mailTo(users[who].email, `Unrecorded ${TAG}`), who).toHaveLength(1);
    expect(log.mock.calls.map((c) => c.join(" ")).join("\n")).toMatch(/was ACCEPTED by the mail service but its outcome could not be recorded/);
    let rows = await deliveries(id);
    expect(rows.every((r) => r.status === "PENDING" && r.claimToken !== null && r.attempts === 1)).toBe(true); // never marked DELIVERED

    // Before the claim expires nothing is sent again.
    await processEmailDeliveries({ provider: provider(), now: new Date(t0.getTime() + 60_000) });
    expect(sent.filter((m) => m.subject.includes(`Unrecorded ${TAG}`))).toHaveLength(2);

    // After it expires the delivery is retaken: the person receives it a second time. This is the documented limit of at-least-once delivery.
    await processEmailDeliveries({ provider: provider(), now: new Date(t0.getTime() + EMAIL_CLAIM_LEASE_MS + 60_000) });
    for (const who of ["a", "b"] as const) expect(mailTo(users[who].email, `Unrecorded ${TAG}`), who).toHaveLength(2);
    rows = await deliveries(id);
    expect(rows.every((r) => r.status === "DELIVERED" && r.attempts === 2 && r.claimToken === null)).toBe(true);
  }, T);

  it("a transient failure to record is retried and succeeds: delivered exactly once, no duplicate", async () => {
    const { id } = await raise(`Transient ${TAG}`);
    let calls = 0;
    const summary = await processEmailDeliveries({ provider: provider(), recordRetryDelayMs: 1, beforeRecordOutcome: async (attempt) => { calls += 1; if (attempt === 1) throw new Error("momentary"); } });
    expect(summary.unrecorded).toBe(0);
    expect(calls).toBeGreaterThanOrEqual(3); // each of the two deliveries needed a second attempt
    for (const who of ["a", "b"] as const) expect(mailTo(users[who].email, `Transient ${TAG}`), who).toHaveLength(1);
    expect((await deliveries(id)).every((d) => d.status === "DELIVERED")).toBe(true);
  }, T);

  it("if the row was taken by another worker after this claim expired, this worker's outcome is not written over theirs", async () => {
    const { id } = await raise(`Claim lost ${TAG}`);
    const stolen = new SmtpEmailProvider(
      {
        async sendMail(message) {
          // While this worker is "sending", another worker takes the row over (as it would after an expired lease).
          await prisma.studioNotificationDelivery.updateMany({ where: { notificationId: id, recipientUserId: { in: [users.a.id, users.b.id] }, claimToken: { not: null } }, data: { claimToken: "another-worker" } });
          sent.push({ to: message.to, subject: message.subject, text: message.text });
          return { accepted: [message.to] };
        },
      },
      "Music Madras <studio@example.test>"
    );
    const summary = await processEmailDeliveries({ provider: stolen });
    expect(summary.unrecorded).toBeGreaterThanOrEqual(1);
    const rows = await deliveries(id);
    expect(rows.some((r) => r.claimToken === "another-worker" && r.status === "PENDING")).toBe(true);
  }, T);
});

describe("links in e-mails are absolute and validated; no valid origin means no link", () => {
  async function bodyFor(authUrl: string | null | undefined) {
    const { id } = await raise(`Links ${TAG} ${counter}`);
    await processEmailDeliveries({ provider: provider(), authUrl });
    expect((await deliveries(id)).every((d) => d.status === "DELIVERED")).toBe(true);
    const mail = sent.find((m) => m.subject.includes(`Links ${TAG}`))!;
    sent.length = 0;
    return mail.text;
  }

  it("builds an absolute link from a valid https origin (trailing slash or not) and from loopback http", async () => {
    expect(await bodyFor("https://studio.example.test")).toContain("Open in Studio: https://studio.example.test/studio/catalogue/unlisted-review");
    expect(await bodyFor("https://studio.example.test/")).toContain("Open in Studio: https://studio.example.test/studio/catalogue/unlisted-review");
    expect(await bodyFor("http://localhost:3000")).toContain("Open in Studio: http://localhost:3000/studio/catalogue/unlisted-review");
  }, T);

  it("with no origin, or one that is not valid, the e-mail has NO link at all and says where to look (never a relative or malformed one)", async () => {
    for (const bad of [null, "", "studio.example.test", "http://studio.example.test", "javascript:alert(1)", "https://user:pw@studio.example.test", "https://studio.example.test/path?x=1"]) {
      const text = await bodyFor(bad);
      expect(text, String(bad)).not.toMatch(/https?:\/\//);
      expect(text, String(bad)).not.toContain("Open in Studio:");
      expect(text, String(bad)).toContain("Open Studio and go to Notifications to see this.");
    }
  }, T);
});
