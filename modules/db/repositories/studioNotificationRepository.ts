import { randomUUID } from "crypto";
import { can } from "../../auth/policy";
import type { StudioRoleName } from "../../auth/types";
import { EmailNotConfiguredError, getConfiguredEmailProvider, type EmailProvider } from "../../auth/email/emailProvider";
import { describeErrorLine } from "../../jobs/scrubError";
import { describeEmailDelivery } from "../../notifications/deliveryConfiguration";
import { NOTIFICATION_KINDS, NOTIFICATION_LIMITS, isNotificationKind, isSafeStudioHref, type NotificationKind } from "../../notifications/notificationKinds";
import { buildStudioLink, resolveStudioOrigin } from "../../notifications/studioLink";
import { prisma } from "../client";
import { isUniqueConstraintViolation } from "../isUniqueConstraintViolation";
import { loadResolvedSettings } from "./siteSettingRepository";
import type { NotificationSeverity, Prisma } from "@prisma/client";

// Phase 6K-1 — Studio notifications.
//
//  - IN-STUDIO is the reliable channel and is always on: a notification is a row people with the right permission see in their inbox.
//  - A notification describes ONE distinct condition and is identified by a unique `dedupeKey`. Raising it again is idempotent
//    (UNCHANGED) unless the condition materially changed (`contentFingerprint` differs) or it had been resolved and recurred, in which
//    case it is updated/reopened and becomes unread again. The same unchanged condition never notifies twice (SRE alerting guidance).
//  - EMAIL is optional (setting `notifications.email.enabled` AND a configured provider). Every attempt is recorded per recipient with
//    an honest status; delivery is bounded, backed off with jitter and never reported as DELIVERED unless the provider accepted it.
//    If email is requested but not configured the attempts are SKIPPED, and administrators get a notification saying exactly that.
//  - Visibility follows RBAC: a notification carries the StudioAction needed to see it.

export class NotificationInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotificationInputError";
  }
}

export type RaiseOutcome = "CREATED" | "REOPENED" | "UPDATED" | "UNCHANGED";

export interface RaiseNotificationInput {
  kind: NotificationKind;
  dedupeKey: string;
  title: string;
  body: string;
  href?: string | null;
  contentFingerprint?: string | null;
  severity?: NotificationSeverity;
}

const KIND_ACTIONS = [...new Set(Object.values(NOTIFICATION_KINDS).map((k) => k.audienceAction))];
const actionsForRole = (role: StudioRoleName) => KIND_ACTIONS.filter((action) => can(role, action));

function validate(input: RaiseNotificationInput) {
  if (!isNotificationKind(input.kind)) throw new NotificationInputError("Unknown notification kind.");
  const dedupeKey = input.dedupeKey.trim();
  const title = input.title.trim();
  const body = input.body.trim();
  if (!dedupeKey || dedupeKey.length > NOTIFICATION_LIMITS.dedupeKey) throw new NotificationInputError("A dedupe key of up to 200 characters is required.");
  if (!title || title.length > NOTIFICATION_LIMITS.title) throw new NotificationInputError("A title of up to 160 characters is required.");
  if (!body || body.length > NOTIFICATION_LIMITS.body) throw new NotificationInputError("A body of up to 2000 characters is required.");
  const href = input.href?.trim() || null;
  if (href !== null && !isSafeStudioHref(href)) throw new NotificationInputError("A notification can only link to a Studio page.");
  return { dedupeKey, title, body, href, fingerprint: input.contentFingerprint ?? null };
}

async function eligibleRecipients(tx: Prisma.TransactionClient, audienceAction: (typeof KIND_ACTIONS)[number]) {
  const users = await tx.studioUser.findMany({ where: { status: "ACTIVE" }, select: { id: true, role: true } });
  return users.filter((u) => can(u.role as StudioRoleName, audienceAction));
}

export async function raiseNotification(input: RaiseNotificationInput): Promise<{ id: string; outcome: RaiseOutcome }> {
  const clean = validate(input);
  const definition = NOTIFICATION_KINDS[input.kind];
  const severity = input.severity ?? definition.severity;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        const existing = await tx.studioNotification.findUnique({ where: { dedupeKey: clean.dedupeKey } });
        let id: string;
        let outcome: RaiseOutcome;
        if (!existing) {
          id = (
            await tx.studioNotification.create({
              data: { kind: input.kind, dedupeKey: clean.dedupeKey, severity, title: clean.title, body: clean.body, href: clean.href, audienceAction: definition.audienceAction, contentFingerprint: clean.fingerprint },
            })
          ).id;
          outcome = "CREATED";
        } else {
          if (existing.kind !== input.kind) throw new NotificationInputError("This dedupe key already belongs to a different kind of notification.");
          if (existing.status === "OPEN" && (existing.contentFingerprint ?? null) === clean.fingerprint) return { id: existing.id, outcome: "UNCHANGED" as const };
          outcome = existing.status === "RESOLVED" ? "REOPENED" : "UPDATED";
          id = existing.id;
          await tx.studioNotification.update({
            where: { id },
            data: { status: "OPEN", resolvedAt: null, resolvedReason: null, severity, title: clean.title, body: clean.body, href: clean.href, contentFingerprint: clean.fingerprint, occurrenceCount: { increment: 1 }, lastRaisedAt: new Date() },
          });
          await tx.studioNotificationRead.deleteMany({ where: { notificationId: id } }); // unread again for everyone
        }

        // Optional email channel: queue one PENDING attempt per eligible recipient. Nothing is sent here.
        if ((await loadResolvedSettings(tx)).get("notifications.email.enabled")) {
          if (existing) {
            // A new episode is delivered afresh — WITHOUT deleting anything. A delivery a worker is sending right now keeps its claim (the in-flight send
            // is recorded normally) and is marked to go back to PENDING afterwards so the newer text is sent too; every other delivery of this
            // notification becomes a fresh PENDING one.
            const nowAt = new Date();
            await tx.studioNotificationDelivery.updateMany({ where: { notificationId: id, claimedUntil: { gt: nowAt } }, data: { requeueAfterClaim: true } });
            await tx.studioNotificationDelivery.updateMany({
              where: { notificationId: id, OR: [{ claimedUntil: null }, { claimedUntil: { lte: nowAt } }] },
              data: { status: "PENDING", attempts: 0, nextAttemptAt: null, lastAttemptAt: null, reason: null, claimedUntil: null, claimToken: null, requeueAfterClaim: false, lastError: null, lastErrorAt: null },
            });
          }
          const recipients = await eligibleRecipients(tx, definition.audienceAction);
          if (recipients.length > 0) {
            await tx.studioNotificationDelivery.createMany({ data: recipients.map((r) => ({ notificationId: id, channel: "EMAIL" as const, recipientUserId: r.id, status: "PENDING" as const })), skipDuplicates: true });
          }
        }
        return { id, outcome };
      });
    } catch (err) {
      if (attempt === 0 && isUniqueConstraintViolation(err)) continue; // a concurrent raise created it first: take the update path
      throw err;
    }
  }
  throw new NotificationInputError("The notification could not be recorded.");
}

/**
 * Updates the wording of an OPEN notification WITHOUT announcing anything again: no unread reset, no new email, no occurrence counted. For when the
 * condition is unchanged (the same things are still missing) but the figures in its text have moved (for example "1 of 3 needed" instead of
 * "0 of 3"). Returns whether the text actually changed.
 */
export async function refreshOpenNotificationText(dedupeKey: string, text: { title: string; body: string }): Promise<boolean> {
  const title = text.title.trim().slice(0, NOTIFICATION_LIMITS.title);
  const body = text.body.trim().slice(0, NOTIFICATION_LIMITS.body);
  const moved = await prisma.studioNotification.updateMany({ where: { dedupeKey, status: "OPEN", NOT: { title, body } }, data: { title, body } });
  return moved.count === 1;
}

/** Marks a condition as cleared. Returns false when there was nothing open to resolve. */
export async function resolveNotification(dedupeKey: string, reason: string): Promise<boolean> {
  const moved = await prisma.studioNotification.updateMany({ where: { dedupeKey, status: "OPEN" }, data: { status: "RESOLVED", resolvedAt: new Date(), resolvedReason: reason.slice(0, 200) } });
  return moved.count === 1;
}

export interface NotificationView {
  id: string;
  kind: string;
  severity: NotificationSeverity;
  title: string;
  body: string;
  href: string | null;
  status: "OPEN" | "RESOLVED";
  occurrenceCount: number;
  lastRaisedAt: Date;
  resolvedAt: Date | null;
  resolvedReason: string | null;
  read: boolean;
}

export async function listNotificationsForUser(input: { userId: string; role: StudioRoleName; includeResolved?: boolean; limit?: number }): Promise<NotificationView[]> {
  const actions = actionsForRole(input.role);
  if (actions.length === 0) return [];
  const rows = await prisma.studioNotification.findMany({
    where: { audienceAction: { in: actions }, ...(input.includeResolved ? {} : { status: "OPEN" }) },
    orderBy: [{ status: "asc" }, { lastRaisedAt: "desc" }],
    take: Math.min(input.limit ?? 100, 200),
    include: { reads: { where: { userId: input.userId }, select: { userId: true } } },
  });
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    severity: row.severity,
    title: row.title,
    body: row.body,
    href: row.href,
    status: row.status,
    occurrenceCount: row.occurrenceCount,
    lastRaisedAt: row.lastRaisedAt,
    resolvedAt: row.resolvedAt,
    resolvedReason: row.resolvedReason,
    read: row.reads.length > 0,
  }));
}

export async function countUnreadNotifications(input: { userId: string; role: StudioRoleName }): Promise<number> {
  const actions = actionsForRole(input.role);
  if (actions.length === 0) return 0;
  return prisma.studioNotification.count({ where: { status: "OPEN", audienceAction: { in: actions }, reads: { none: { userId: input.userId } } } });
}

/** Marks one notification read — only if the person is allowed to see it. */
export async function markNotificationRead(input: { id: string; userId: string; role: StudioRoleName }): Promise<boolean> {
  const actions = actionsForRole(input.role);
  const visible = await prisma.studioNotification.findFirst({ where: { id: input.id, audienceAction: { in: actions } }, select: { id: true } });
  if (!visible) return false;
  await prisma.studioNotificationRead.upsert({ where: { notificationId_userId: { notificationId: input.id, userId: input.userId } }, create: { notificationId: input.id, userId: input.userId }, update: {} });
  return true;
}

export async function markAllNotificationsRead(input: { userId: string; role: StudioRoleName }): Promise<number> {
  const actions = actionsForRole(input.role);
  if (actions.length === 0) return 0;
  const unread = await prisma.studioNotification.findMany({ where: { status: "OPEN", audienceAction: { in: actions }, reads: { none: { userId: input.userId } } }, select: { id: true } });
  if (unread.length === 0) return 0;
  await prisma.studioNotificationRead.createMany({ data: unread.map((n) => ({ notificationId: n.id, userId: input.userId })), skipDuplicates: true });
  return unread.length;
}

// ---------------------------------------------------------------------------------------------------- email delivery

export const EMAIL_MAX_ATTEMPTS = 3;
const BACKOFF_BASE_SECONDS = 60;
const BACKOFF_CAP_SECONDS = 3600;

/** Exponential backoff with jitter (±20%), capped. Pure. */
export function nextAttemptDelayMs(attemptsSoFar: number, random: () => number = Math.random): number {
  const base = Math.min(BACKOFF_CAP_SECONDS, BACKOFF_BASE_SECONDS * 2 ** Math.max(0, attemptsSoFar - 1));
  return Math.round(base * (0.8 + 0.4 * random()) * 1000);
}

/**
 * How long a worker's claim on a delivery lasts. A send that has not been recorded within this is presumed dead (a crashed worker) and the delivery
 * may be taken again. It is a technical bound, longer than any single send should take.
 */
export const EMAIL_CLAIM_LEASE_MS = 5 * 60_000;

/** How many times the outcome of an accepted send is written before giving up and logging it (see recordDelivered). */
const RECORD_ATTEMPTS = 3;

export interface EmailProcessingSummary {
  due: number;
  delivered: number;
  retryScheduled: number;
  failed: number;
  skipped: number;
  /** Deliveries another worker claimed first (they were left to it). */
  contended: number;
  /** Sends the mail service ACCEPTED whose outcome could not be written to the database. They will be sent again when their claim expires: delivery is at-least-once. */
  unrecorded: number;
}

export interface ProcessEmailOptions {
  now?: Date;
  /** Injectable for tests. When omitted, the deployment's configured provider is used and an unconfigured deployment skips honestly. */
  provider?: EmailProvider;
  random?: () => number;
  batch?: number;
  /** The Studio's origin for links in the e-mail (default: AUTH_URL). Only a valid https (or loopback http) origin is used; otherwise the e-mail has no link. */
  authUrl?: string | null;
  /** Tests only: called before each attempt to write an accepted send's outcome; may throw to simulate the database failing at that moment. */
  beforeRecordOutcome?: (attempt: number) => Promise<void>;
  /** Tests only: pause between attempts to write an outcome (default: a short real delay). */
  recordRetryDelayMs?: number;
}

const NOT_CONFIGURED_KEY = "notification-delivery:email-not-configured";
const SEND_FAILED_KEY = "notification-delivery:email-send-failed";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Writes the outcome of a send the mail service ACCEPTED. The write is retried a few times; if the database still cannot be reached the accepted
 * send is logged loudly and reported as `unrecorded`, and the delivery stays claimed until its claim expires, after which it is sent again. That is the
 * honest limit of at-least-once delivery: a message can reach a person twice when the database fails between "the mail service said yes" and "we wrote it
 * down". Exactly-once delivery is not claimed anywhere.
 */
async function recordDelivered(deliveryId: string, token: string, now: Date, options: ProcessEmailOptions): Promise<"DELIVERED" | "REQUEUED" | "CLAIM_LOST" | "UNRECORDED"> {
  for (let attempt = 1; attempt <= RECORD_ATTEMPTS; attempt++) {
    try {
      await options.beforeRecordOutcome?.(attempt);
      return await prisma.$transaction(async (tx) => {
        const row = await tx.studioNotificationDelivery.findUnique({ where: { id: deliveryId } });
        if (!row || row.claimToken !== token) return "CLAIM_LOST" as const; // the row is gone, or another worker took it after this claim expired
        const base = { claimedUntil: null, claimToken: null, requeueAfterClaim: false, lastError: null, lastErrorAt: null, nextAttemptAt: null, reason: null, lastAttemptAt: now };
        if (row.requeueAfterClaim) {
          // The notification was raised again while this was being sent: what was sent is recorded, and the delivery goes back to PENDING for the new text.
          await tx.studioNotificationDelivery.update({ where: { id: deliveryId }, data: { ...base, status: "PENDING", attempts: 0 } });
          return "REQUEUED" as const;
        }
        await tx.studioNotificationDelivery.update({ where: { id: deliveryId }, data: { ...base, status: "DELIVERED" } });
        return "DELIVERED" as const;
      });
    } catch (err) {
      if (attempt === RECORD_ATTEMPTS) {
        console.error(`Notification email delivery ${deliveryId} was ACCEPTED by the mail service but its outcome could not be recorded (${describeErrorLine(err)}). It will be sent again when its claim expires.`);
        return "UNRECORDED";
      }
      await sleep((options.recordRetryDelayMs ?? 50) * attempt);
    }
  }
  return "UNRECORDED";
}

/** Records a failed send: a retry with backoff, or FAILED once the attempts are used up. The claim is released. The reason is stored (scrubbed) and logged. */
async function recordFailure(deliveryId: string, token: string, attempts: number, err: unknown, now: Date, options: ProcessEmailOptions): Promise<"RETRY" | "FAILED" | "REQUEUED" | "CLAIM_LOST"> {
  const line = describeErrorLine(err);
  console.error(`Notification email delivery ${deliveryId} failed on attempt ${attempts} of ${EMAIL_MAX_ATTEMPTS}: ${line}`);
  return prisma.$transaction(async (tx) => {
    const row = await tx.studioNotificationDelivery.findUnique({ where: { id: deliveryId } });
    if (!row || row.claimToken !== token) return "CLAIM_LOST" as const;
    const release = { claimedUntil: null, claimToken: null, requeueAfterClaim: false, lastAttemptAt: now, lastError: line, lastErrorAt: now };
    if (row.requeueAfterClaim) {
      await tx.studioNotificationDelivery.update({ where: { id: deliveryId }, data: { ...release, status: "PENDING", attempts: 0, nextAttemptAt: null, reason: null } });
      return "REQUEUED" as const;
    }
    if (attempts >= EMAIL_MAX_ATTEMPTS) {
      await tx.studioNotificationDelivery.update({ where: { id: deliveryId }, data: { ...release, status: "FAILED", nextAttemptAt: null, reason: "SEND_FAILED" } });
      return "FAILED" as const;
    }
    await tx.studioNotificationDelivery.update({ where: { id: deliveryId }, data: { ...release, status: "PENDING", nextAttemptAt: new Date(now.getTime() + nextAttemptDelayMs(attempts, options.random)), reason: "SEND_FAILED" } });
    return "RETRY" as const;
  });
}

export async function processEmailDeliveries(options: ProcessEmailOptions = {}): Promise<EmailProcessingSummary> {
  const now = options.now ?? new Date();
  const summary: EmailProcessingSummary = { due: 0, delivered: 0, retryScheduled: 0, failed: 0, skipped: 0, contended: 0, unrecorded: 0 };
  // Due: waiting, not backing off, and not currently claimed by a worker (a claim that has expired is a crashed worker's, and is retaken).
  const due = await prisma.studioNotificationDelivery.findMany({
    where: {
      channel: "EMAIL",
      status: "PENDING",
      AND: [{ OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] }, { OR: [{ claimedUntil: null }, { claimedUntil: { lte: now } }] }],
    },
    orderBy: { createdAt: "asc" },
    take: options.batch ?? 50,
    include: { notification: true, recipient: true },
  });
  summary.due = due.length;
  if (due.length === 0) return summary;

  // If email notifications were switched off after these were queued, they must not be sent: say so honestly instead of leaving them pending.
  if (!(await loadResolvedSettings()).get("notifications.email.enabled")) {
    await prisma.studioNotificationDelivery.updateMany({ where: { id: { in: due.map((d) => d.id) }, status: "PENDING" }, data: { status: "SKIPPED", reason: "EMAIL_DISABLED", lastAttemptAt: now } });
    summary.skipped = due.length;
    return summary;
  }

  let provider: EmailProvider | null = options.provider ?? null;
  let notConfiguredReason: string | null = null;
  if (!provider) {
    const status = describeEmailDelivery();
    if (status.state === "CONFIGURED") {
      try {
        provider = getConfiguredEmailProvider();
      } catch (err) {
        notConfiguredReason = err instanceof EmailNotConfiguredError ? err.message : "Email delivery could not be set up.";
      }
    } else {
      notConfiguredReason = status.detail;
    }
  }

  if (!provider) {
    // Honest: nothing was sent. Record SKIPPED and make the missing configuration visible to administrators.
    await prisma.studioNotificationDelivery.updateMany({ where: { id: { in: due.map((d) => d.id) } }, data: { status: "SKIPPED", reason: "EMAIL_NOT_CONFIGURED", lastAttemptAt: now } });
    summary.skipped = due.length;
    await raiseNotification({
      kind: "NOTIFICATION_DELIVERY_PROBLEM",
      dedupeKey: NOT_CONFIGURED_KEY,
      title: "Email notifications are switched on but email delivery is not configured",
      body: `${notConfiguredReason ?? "Email delivery is not configured."} Notifications are still shown in the Studio inbox; ${due.length} email${due.length === 1 ? " was" : "s were"} not sent.`,
      href: "/studio/notifications",
      contentFingerprint: "email-not-configured",
    });
    return summary;
  }
  await resolveNotification(NOT_CONFIGURED_KEY, "Email delivery is configured");

  // Links in the e-mail are absolute and built from a validated origin only; with no valid origin the e-mail carries no link at all.
  const origin = resolveStudioOrigin(options.authUrl !== undefined ? options.authUrl : process.env.AUTH_URL);
  for (const delivery of due) {
    const { notification, recipient } = delivery;
    if (notification.status !== "OPEN") {
      await prisma.studioNotificationDelivery.updateMany({ where: { id: delivery.id, status: "PENDING", claimToken: null }, data: { status: "SKIPPED", reason: "RESOLVED", lastAttemptAt: now } });
      summary.skipped += 1;
      continue;
    }
    const action = KIND_ACTIONS.find((a) => a === notification.audienceAction);
    if (recipient.status !== "ACTIVE" || !action || !can(recipient.role as StudioRoleName, action)) {
      await prisma.studioNotificationDelivery.updateMany({ where: { id: delivery.id, status: "PENDING", claimToken: null }, data: { status: "SKIPPED", reason: "NOT_ELIGIBLE", lastAttemptAt: now } });
      summary.skipped += 1;
      continue;
    }
    // CLAIM the delivery before sending: a conditional update that only one concurrent worker can win, and that holds for a LEASE. While the claim is
    // live no other worker takes the delivery — including one that starts after this claim was made, which the earlier attempts-only check did not
    // stop. The claim also counts the attempt, so a crash between claiming and recording leaves a delivery that becomes retryable when the lease
    // expires, never a lost one. The token proves which worker may record the outcome.
    const token = randomUUID();
    const claimed = await prisma.studioNotificationDelivery.updateMany({
      where: { id: delivery.id, status: "PENDING", attempts: delivery.attempts, OR: [{ claimedUntil: null }, { claimedUntil: { lte: now } }] },
      data: { attempts: { increment: 1 }, lastAttemptAt: now, claimedUntil: new Date(now.getTime() + EMAIL_CLAIM_LEASE_MS), claimToken: token },
    });
    if (claimed.count !== 1) {
      summary.contended += 1;
      continue;
    }
    const attempts = delivery.attempts + 1;
    // What is sent is the notification as it is NOW, read after the claim: it may have been raised again (new text) or resolved since this batch was
    // loaded, and an e-mail must never carry text that no longer describes the condition.
    const live = await prisma.studioNotification.findUnique({ where: { id: notification.id } });
    if (!live || live.status !== "OPEN") {
      await prisma.studioNotificationDelivery.updateMany({ where: { id: delivery.id, claimToken: token }, data: { status: "SKIPPED", reason: "RESOLVED", claimedUntil: null, claimToken: null, lastAttemptAt: now } });
      summary.skipped += 1;
      continue;
    }
    const link = buildStudioLink(origin, live.href);
    const where = live.href ? (link ? `\n\nOpen in Studio: ${link}` : "\n\nOpen Studio and go to Notifications to see this.") : "";
    try {
      await provider.sendStudioNotificationEmail({ toEmail: recipient.email, subject: `[Music Madras Studio] ${live.title}`, text: `${live.title}\n\n${live.body}${where}` });
    } catch (err) {
      // Never silent: logged (scrubbed), stored on the delivery, counted, and — after the last attempt — raised to administrators below.
      const outcome = await recordFailure(delivery.id, token, attempts, err, now, options);
      if (outcome === "FAILED") summary.failed += 1;
      else if (outcome === "RETRY") summary.retryScheduled += 1;
      continue;
    }
    // DELIVERED means exactly this: the mail service ACCEPTED the message for delivery. It is never recorded before that, and it does not say the
    // message reached an inbox or was read.
    const recorded = await recordDelivered(delivery.id, token, now, options);
    if (recorded === "UNRECORDED" || recorded === "CLAIM_LOST") summary.unrecorded += 1; // sent, but the outcome is not ours to write
    else summary.delivered += 1;
  }
  if (summary.failed > 0) {
    await raiseNotification({
      kind: "NOTIFICATION_DELIVERY_PROBLEM",
      dedupeKey: SEND_FAILED_KEY,
      title: "Some notification emails could not be delivered",
      body: `${summary.failed} email${summary.failed === 1 ? "" : "s"} failed after ${EMAIL_MAX_ATTEMPTS} attempts. The notifications themselves are still in the Studio inbox. Check the email service the deployment is configured to use.`,
      href: "/studio/notifications",
      contentFingerprint: `failed-${summary.failed}`,
    });
  }
  return summary;
}

export interface DeliveryCounts {
  pending: number;
  delivered: number;
  failed: number;
  skipped: number;
}

export interface DeliveryHealth {
  /** Emails being sent right now by a worker that holds a live claim (not counted as waiting, and never as stalled). */
  inFlight: number;
  /** Emails still waiting to be sent. */
  pending: number;
  /** When the oldest waiting email was queued, if any. */
  oldestPendingAt: Date | null;
  /** The last time the delivery job tried to send anything. */
  lastAttemptAt: Date | null;
  /** Emails have been waiting longer than a scheduled run would allow: the delivery job is probably not running. */
  stalled: boolean;
}

/** How long a queued email may wait before Studio tells an administrator that nothing is picking it up. A reporting threshold, not a delivery rule. */
export const DELIVERY_STALL_MINUTES = 30;

/** Derived from the delivery rows themselves (no extra state): what is waiting, and whether anything is processing it. */
export async function emailDeliveryHealth(now: Date = new Date()): Promise<DeliveryHealth> {
  const unclaimed = { OR: [{ claimedUntil: null }, { claimedUntil: { lte: now } }] };
  const pending = await prisma.studioNotificationDelivery.aggregate({ where: { channel: "EMAIL", status: "PENDING", ...unclaimed }, _count: { _all: true }, _min: { createdAt: true } });
  const inFlight = await prisma.studioNotificationDelivery.count({ where: { channel: "EMAIL", status: "PENDING", claimedUntil: { gt: now } } });
  const attempted = await prisma.studioNotificationDelivery.aggregate({ where: { channel: "EMAIL", lastAttemptAt: { not: null } }, _max: { lastAttemptAt: true } });
  const oldestPendingAt = pending._min.createdAt ?? null;
  return {
    inFlight,
    pending: pending._count._all,
    oldestPendingAt,
    lastAttemptAt: attempted._max.lastAttemptAt ?? null,
    stalled: oldestPendingAt !== null && now.getTime() - oldestPendingAt.getTime() > DELIVERY_STALL_MINUTES * 60_000,
  };
}

export async function emailDeliveryCounts(): Promise<DeliveryCounts> {
  const groups = await prisma.studioNotificationDelivery.groupBy({ by: ["status"], where: { channel: "EMAIL" }, _count: { _all: true } });
  const count = (status: string) => groups.find((g) => g.status === status)?._count._all ?? 0;
  return { pending: count("PENDING"), delivered: count("DELIVERED"), failed: count("FAILED"), skipped: count("SKIPPED") };
}
