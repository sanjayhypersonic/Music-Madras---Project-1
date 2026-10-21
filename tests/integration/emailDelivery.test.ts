import { randomUUID } from "crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// A real SmtpEmailProvider over a RECORDING transport stands in for the deployment's configured provider; the repository's own `getConfiguredEmailProvider`
// is replaced only so the scheduled route can be exercised without a mail server. No real mail is ever sent.
const transportLog = vi.hoisted(() => ({ sent: [] as Array<{ from: string; to: string; subject: string; text: string }>, failWith: null as Error | null, delayMs: 0 }));
vi.mock("../../modules/auth/email/emailProvider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../modules/auth/email/emailProvider")>();
  const transport = {
    async sendMail(message: { from: string; to: string; subject: string; text: string }) {
      if (transportLog.delayMs) await new Promise((resolve) => setTimeout(resolve, transportLog.delayMs));
      if (transportLog.failWith) throw transportLog.failWith;
      transportLog.sent.push(message);
      return { accepted: [message.to] };
    },
  };
  return { ...actual, getConfiguredEmailProvider: () => new actual.SmtpEmailProvider(transport, "Music Madras <studio@example.test>") };
});
// A controllable failure for one maintenance step, to prove steps are independent.
const failure = vi.hoisted(() => ({ reviewSweep: false }));
vi.mock("../../modules/db/repositories/unlistedReviewRepository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../modules/db/repositories/unlistedReviewRepository")>();
  return { ...actual, runUnlistedReviewSweep: (...args: Parameters<typeof actual.runUnlistedReviewSweep>) => (failure.reviewSweep ? Promise.reject(new Error("boom secret-internal-detail")) : actual.runUnlistedReviewSweep(...args)) };
});

import { GET, POST } from "../../app/api/cron/stewardship/route";
import { prisma } from "../../modules/db/client";
import { SmtpEmailProvider } from "../../modules/auth/email/emailProvider";
import { updateSiteSetting } from "../../modules/db/repositories/siteSettingRepository";
import { DELIVERY_STALL_MINUTES, emailDeliveryHealth, processEmailDeliveries, raiseNotification } from "../../modules/db/repositories/studioNotificationRepository";
import { runStewardshipJob } from "../../modules/jobs/stewardshipJob";

// F7 — email delivery through the existing provider and the secured scheduled entry point; honest statuses throughout. Isolated test DB.

const TAG = randomUUID().slice(0, 8);
const T = 60000;
const users = {} as Record<"admin1" | "admin2" | "editor", { id: string; email: string }>;
const KEYS: string[] = [];
let counter = 0;
const SECRET = `synthetic-cron-secret-${TAG}-0123456789abcdef`;

function transportProvider() {
  return new SmtpEmailProvider(
    {
      async sendMail(message) {
        if (transportLog.delayMs) await new Promise((resolve) => setTimeout(resolve, transportLog.delayMs));
        if (transportLog.failWith) throw transportLog.failWith;
        transportLog.sent.push(message);
        return { accepted: [message.to] };
      },
    },
    "Music Madras <studio@example.test>"
  );
}

async function raise(overrides: { title?: string; body?: string } = {}) {
  const key = `ed-${TAG}-${++counter}`;
  KEYS.push(key);
  const result = await raiseNotification({ kind: "UNLISTED_REVIEW_PENDING", dedupeKey: key, title: overrides.title ?? `Email subject ${TAG} ${counter}`, body: overrides.body ?? "Something needs a decision.", href: "/studio/catalogue/unlisted-review", contentFingerprint: `f${counter}` });
  return { id: result.id, key };
}
const deliveries = (notificationId: string) => prisma.studioNotificationDelivery.findMany({ where: { notificationId }, include: { recipient: { select: { email: true } } }, orderBy: { createdAt: "asc" } });
async function setEmailEnabled(enabled: boolean) {
  const row = await prisma.siteSetting.findUnique({ where: { key: "notifications.email.enabled" } });
  await updateSiteSetting({ key: "notifications.email.enabled", value: enabled, expectedVersion: row?.version ?? 0, actorId: users.admin1.id });
}
const req = (method: "GET" | "POST", authorization?: string) => new Request("https://studio.example.test/api/cron/stewardship", { method, headers: authorization ? { authorization } : {} });

beforeAll(async () => {
  for (const [who, role] of [["admin1", "ADMINISTRATOR"], ["admin2", "ADMINISTRATOR"], ["editor", "EDITOR"]] as const) {
    const email = `x6kf7-${who}-${TAG}@musicmadras.test`;
    users[who] = { id: (await prisma.studioUser.create({ data: { id: randomUUID(), email, name: `Email ${who}`, role, status: "ACTIVE" } })).id, email };
  }
  await setEmailEnabled(true);
}, T);

afterEach(() => {
  transportLog.sent.length = 0;
  transportLog.failWith = null;
  transportLog.delayMs = 0;
  failure.reviewSweep = false;
  vi.unstubAllEnvs();
});

afterAll(async () => {
  await prisma.studioNotification.deleteMany({ where: { OR: [{ dedupeKey: { in: KEYS } }, { dedupeKey: { startsWith: "notification-delivery:" } }, { dedupeKey: "unlisted-review" }, { dedupeKey: "carried-over-approvals" }] } });
  await prisma.siteSetting.deleteMany({ where: { key: "notifications.email.enabled" } });
  await prisma.auditLogEntry.deleteMany({ where: { actorId: { in: Object.values(users).map((u) => u.id) } } });
  await prisma.studioUser.deleteMany({ where: { id: { in: Object.values(users).map((u) => u.id) } } });
}, T);

describe("a queued email is not a sent email", () => {
  it("raising a notification only QUEUES one email per eligible person; nothing is sent, and Studio can tell when nothing is picking them up", async () => {
    const { id } = await raise();
    const rows = await deliveries(id);
    const emails = rows.map((r) => r.recipient.email);
    expect(emails).toEqual(expect.arrayContaining([users.admin1.email, users.admin2.email]));
    expect(emails).not.toContain(users.editor.email); // the editor may not see this kind
    expect(new Set(emails).size).toBe(emails.length); // one queued email per person
    expect(rows.every((r) => r.status === "PENDING" && r.attempts === 0 && r.lastAttemptAt === null)).toBe(true);
    expect(transportLog.sent).toHaveLength(0);

    const now = new Date();
    const soon = await emailDeliveryHealth(now);
    expect(soon).toMatchObject({ stalled: false });
    expect(soon.pending).toBeGreaterThanOrEqual(2);
    const later = await emailDeliveryHealth(new Date(now.getTime() + (DELIVERY_STALL_MINUTES + 1) * 60_000));
    expect(later.stalled).toBe(true); // waiting longer than a scheduled run would allow
    expect(later.oldestPendingAt).not.toBeNull();
  }, T);
});

describe("delivery through the provider", () => {
  it("sends each queued email through the configured provider exactly once, marks DELIVERED only after the mail service accepted it, and never repeats", async () => {
    vi.stubEnv("AUTH_URL", "https://studio.example.test");
    const { id } = await raise({ title: `Please decide ${TAG}`, body: "Two videos are waiting." });
    expect(transportLog.sent).toHaveLength(0);

    const summary = await processEmailDeliveries({ provider: transportProvider() });
    expect(summary).toMatchObject({ failed: 0 });
    const queued = await deliveries(id);
    const mine = transportLog.sent.filter((m) => m.subject.includes(`Please decide ${TAG}`));
    expect(mine.map((m) => m.to)).toEqual(expect.arrayContaining([users.admin1.email, users.admin2.email]));
    expect(mine.map((m) => m.to)).not.toContain(users.editor.email);
    expect(mine).toHaveLength(queued.length); // exactly one per queued recipient
    expect(new Set(mine.map((m) => m.to)).size).toBe(mine.length);
    for (const m of mine) {
      expect(m.subject).toBe(`[Music Madras Studio] Please decide ${TAG}`);
      expect(m.text).toContain("Two videos are waiting.");
      expect(m.text).toContain("Open in Studio: https://studio.example.test/studio/catalogue/unlisted-review");
      expect(m.from).toBe("Music Madras <studio@example.test>");
    }
    const rows = await deliveries(id);
    expect(rows.every((r) => r.status === "DELIVERED" && r.attempts === 1 && r.lastAttemptAt !== null && r.nextAttemptAt === null)).toBe(true);

    transportLog.sent.length = 0;
    await processEmailDeliveries({ provider: transportProvider() });
    expect(transportLog.sent.filter((m) => m.subject.includes(`Please decide ${TAG}`))).toHaveLength(0); // nothing is sent twice
  }, T);

  it("a rejecting mail service never produces DELIVERED: retries back off, then FAILED, an administrator is told — and no transport error text or credentials are stored", async () => {
    const { id } = await raise();
    transportLog.failWith = new Error("535 auth failed for smtps://mailer:SECRET-PASSWORD-123@smtp.example.test");
    const t0 = new Date();
    await processEmailDeliveries({ provider: transportProvider(), now: t0, random: () => 0.5, batch: 200 });
    let rows = await deliveries(id);
    expect(rows.every((r) => r.status === "PENDING" && r.attempts === 1 && r.nextAttemptAt !== null && r.nextAttemptAt > t0)).toBe(true);
    expect((await processEmailDeliveries({ provider: transportProvider(), now: new Date(t0.getTime() + 1000) })).due).toBe(0); // backing off: no hammering

    let now = t0;
    for (let attempt = 2; attempt <= 3; attempt++) {
      now = new Date(now.getTime() + 3 * 3_600_000);
      await processEmailDeliveries({ provider: transportProvider(), now, random: () => 0.5, batch: 200 });
    }
    rows = await deliveries(id);
    expect(rows.every((r) => r.status === "FAILED" && r.attempts === 3 && r.reason === "SEND_FAILED")).toBe(true);
    expect(transportLog.sent).toHaveLength(0);
    const problem = await prisma.studioNotification.findUniqueOrThrow({ where: { dedupeKey: "notification-delivery:email-send-failed" } });
    expect(problem).toMatchObject({ kind: "NOTIFICATION_DELIVERY_PROBLEM", audienceAction: "SETTINGS_MANAGE", status: "OPEN" });
    const stored = JSON.stringify({ rows, problem });
    expect(stored).not.toContain("SECRET-PASSWORD-123");
    expect(stored).not.toContain("smtps://");
  }, T);

  it("two workers at the same moment send each email once (the delivery is claimed before it is sent)", async () => {
    const { id } = await raise({ title: `Race ${TAG}` });
    const recipients = (await deliveries(id)).length;
    expect(recipients).toBeGreaterThanOrEqual(2);
    transportLog.delayMs = 60;
    const [a, b] = await Promise.all([processEmailDeliveries({ provider: transportProvider() }), processEmailDeliveries({ provider: transportProvider() })]);
    const mine = transportLog.sent.filter((m) => m.subject.includes(`Race ${TAG}`));
    expect(mine).toHaveLength(recipients); // one per recipient — never doubled
    expect(new Set(mine.map((m) => m.to)).size).toBe(recipients);
    expect(a.delivered + b.delivered).toBeGreaterThanOrEqual(recipients); // (the two summaries may also count other queued emails)
    expect((await deliveries(id)).every((r) => r.status === "DELIVERED" && r.attempts === 1)).toBe(true);
  }, T);

  it("with no email service configured nothing is claimed to be sent: SKIPPED, and administrators see why", async () => {
    const { id } = await raise();
    const summary = await processEmailDeliveries({}); // no provider injected; the test environment has no configured delivery
    expect(summary.skipped).toBeGreaterThanOrEqual(2);
    expect((await deliveries(id)).every((r) => r.status === "SKIPPED" && r.reason === "EMAIL_NOT_CONFIGURED")).toBe(true);
    expect(transportLog.sent).toHaveLength(0);
    expect((await prisma.studioNotification.findUniqueOrThrow({ where: { dedupeKey: "notification-delivery:email-not-configured" } })).status).toBe("OPEN");
  }, T);

  it("if email is switched off after emails were queued they are not sent: SKIPPED as disabled", async () => {
    const { id } = await raise();
    await setEmailEnabled(false);
    try {
      await processEmailDeliveries({ provider: transportProvider() });
      expect((await deliveries(id)).every((r) => r.status === "SKIPPED" && r.reason === "EMAIL_DISABLED")).toBe(true);
      expect(transportLog.sent).toHaveLength(0);
    } finally {
      await setEmailEnabled(true);
    }
  }, T);
});

describe("the secured scheduled entry point", () => {
  function configured() {
    vi.stubEnv("CRON_SECRET", SECRET);
    vi.stubEnv("EMAIL_PROVIDER", "smtp");
    vi.stubEnv("SMTP_URL", "smtps://mailer:placeholder@smtp.example.test:465");
    vi.stubEnv("EMAIL_FROM", "Music Madras <studio@example.test>");
    vi.stubEnv("AUTH_URL", "https://studio.example.test");
  }

  it("refuses without the secret (401) and when the secret is not configured or too short (503): nothing runs, nothing is sent", async () => {
    configured();
    const { id } = await raise({ title: `Guarded ${TAG}` });
    for (const method of [GET, POST]) {
      expect((await method(req("GET"))).status).toBe(401);
      expect((await method(req("GET", "Bearer wrong-wrong-wrong-wrong-wrong-wrong-wrong"))).status).toBe(401);
      expect((await method(req("GET", SECRET))).status).toBe(401); // not a Bearer credential
    }
    vi.stubEnv("CRON_SECRET", "");
    expect((await GET(req("GET", `Bearer ${SECRET}`))).status).toBe(503);
    vi.stubEnv("CRON_SECRET", "too-short");
    expect((await GET(req("GET", "Bearer too-short"))).status).toBe(503);
    expect(transportLog.sent).toHaveLength(0);
    expect((await deliveries(id)).every((r) => r.status === "PENDING" && r.attempts === 0)).toBe(true); // untouched
  }, T);

  it("with the secret it runs the job: queued emails go through the provider, the response is counts only and is never cached", async () => {
    configured();
    const { id } = await raise({ title: `Scheduled ${TAG}` });
    for (const method of [GET, POST]) {
      const response = await method(req(method === GET ? "GET" : "POST", `Bearer ${SECRET}`));
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      const body = await response.json();
      expect(body).toMatchObject({ ok: true });
      expect(body.steps.map((s: { name: string; status: string }) => [s.name, s.status])).toEqual([["lifecycleInvariants", "SUCCEEDED"], ["metadataReview", "SUCCEEDED"], ["unlistedReview", "SUCCEEDED"], ["playlistChecks", "SUCCEEDED"], ["emailDelivery", "SUCCEEDED"]]);
      const text = JSON.stringify(body);
      for (const secretish of [users.admin1.email, users.admin2.email, `Scheduled ${TAG}`, SECRET, "smtp"]) expect(text).not.toContain(secretish);
      const emailStep = body.steps.find((s: { name: string }) => s.name === "emailDelivery");
      expect(Object.keys(emailStep.counts).sort()).toEqual(["contended", "delivered", "due", "failed", "retryScheduled", "skipped", "unrecorded"]);
    }
    const mine = transportLog.sent.filter((m) => m.subject.includes(`Scheduled ${TAG}`));
    expect(mine).toHaveLength((await deliveries(id)).length); // sent once per recipient across the two calls
    expect((await deliveries(id)).every((r) => r.status === "DELIVERED")).toBe(true);
  }, T);

  it("one failing step does not stop the others, and its error text never reaches the caller", async () => {
    configured();
    const { id } = await raise({ title: `Resilient ${TAG}` });
    failure.reviewSweep = true;
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const response = await GET(req("GET", `Bearer ${SECRET}`));
      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body.ok).toBe(false);
      expect(body.status).toBe("PARTIAL");
      expect(body.steps.map((s: { name: string; status: string }) => [s.name, s.status])).toEqual([["lifecycleInvariants", "SUCCEEDED"], ["metadataReview", "SUCCEEDED"], ["unlistedReview", "FAILED"], ["playlistChecks", "SUCCEEDED"], ["emailDelivery", "SUCCEEDED"]]);
      expect(JSON.stringify(body)).not.toMatch(/boom|secret-internal-detail/);
      expect(errorLog).toHaveBeenCalled(); // the operator log has it
    } finally {
      errorLog.mockRestore();
    }
    expect((await deliveries(id)).every((r) => r.status === "DELIVERED")).toBe(true); // email delivery still ran
  }, T);
});

describe("the job itself", () => {
  it("runs every maintenance step in one call with an injected provider", async () => {
    const { id } = await raise({ title: `Job ${TAG}` });
    const result = await runStewardshipJob({ emailProvider: transportProvider() });
    expect(result.ok).toBe(true);
    expect(result.steps.map((s) => [s.name, s.status])).toEqual([["lifecycleInvariants", "SUCCEEDED"], ["metadataReview", "SUCCEEDED"], ["unlistedReview", "SUCCEEDED"], ["playlistChecks", "SUCCEEDED"], ["emailDelivery", "SUCCEEDED"]]);
    expect(Number(result.steps.find((s) => s.name === "emailDelivery")!.counts!.delivered)).toBeGreaterThanOrEqual(2);
    expect((await deliveries(id)).every((r) => r.status === "DELIVERED")).toBe(true);
  }, T);
});
