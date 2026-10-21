import { describe, expect, it } from "vitest";
import { can } from "../../modules/auth/policy";
import { describeEmailDelivery } from "../../modules/notifications/deliveryConfiguration";
import { NOTIFICATION_KINDS, isNotificationKind, isSafeStudioHref } from "../../modules/notifications/notificationKinds";
import { EMAIL_MAX_ATTEMPTS, nextAttemptDelayMs } from "../../modules/db/repositories/studioNotificationRepository";

// Phase 6K-1 — the pure rules of the notification system. Synthetic values only.

describe("notification links", () => {
  it("accepts only internal Studio paths", () => {
    for (const ok of ["/studio/notifications", "/studio/catalogue/videos/abc?x=1"]) expect(isSafeStudioHref(ok), ok).toBe(true);
    for (const bad of ["https://evil.example/studio/x", "//evil.example/studio/x", "/museum/x", "studio/x", "/studio/\\x", "/studio/x y", "/studio/<script>", "javascript:alert(1)", "/studio/" + "a".repeat(250)]) {
      expect(isSafeStudioHref(bad), bad).toBe(false);
    }
  });
});

describe("notification kinds", () => {
  it("each kind names who may see it, and only existing permissions are used (no contributor-visible kind)", () => {
    for (const [kind, definition] of Object.entries(NOTIFICATION_KINDS)) {
      expect(isNotificationKind(kind)).toBe(true);
      expect(can("FOUNDER", definition.audienceAction), kind).toBe(true);
      expect(can("CONTRIBUTOR", definition.audienceAction), kind).toBe(false);
    }
    expect(isNotificationKind("toString")).toBe(false);
    expect(isNotificationKind("NOPE")).toBe(false);
  });

  it("the publishing-decision kind needs the right to publish, and the delivery-problem kind needs the right to administer settings", () => {
    expect(can("EDITOR", NOTIFICATION_KINDS.UNLISTED_REVIEW_PENDING.audienceAction)).toBe(false);
    expect(can("ADMINISTRATOR", NOTIFICATION_KINDS.UNLISTED_REVIEW_PENDING.audienceAction)).toBe(true);
    expect(can("ADMINISTRATOR", NOTIFICATION_KINDS.NOTIFICATION_DELIVERY_PROBLEM.audienceAction)).toBe(false);
    expect(can("SUPER_ADMINISTRATOR", NOTIFICATION_KINDS.NOTIFICATION_DELIVERY_PROBLEM.audienceAction)).toBe(true);
  });
});

describe("retry backoff", () => {
  it("grows exponentially, is capped, and is jittered within ±20%", () => {
    const mid = () => 0.5; // jitter factor 1.0
    expect(nextAttemptDelayMs(1, mid)).toBe(60_000);
    expect(nextAttemptDelayMs(2, mid)).toBe(120_000);
    expect(nextAttemptDelayMs(3, mid)).toBe(240_000);
    expect(nextAttemptDelayMs(20, mid)).toBe(3_600_000); // capped
    expect(nextAttemptDelayMs(2, () => 0)).toBe(96_000);
    expect(nextAttemptDelayMs(2, () => 1)).toBe(144_000);
  });

  it("delivery is bounded", () => {
    expect(EMAIL_MAX_ATTEMPTS).toBeGreaterThanOrEqual(1);
    expect(EMAIL_MAX_ATTEMPTS).toBeLessThanOrEqual(5);
  });
});

describe("what administrators are told about email delivery", () => {
  it("smtp with its settings is CONFIGURED; smtp without them, or an unsupported provider, is NOT_CONFIGURED", () => {
    expect(describeEmailDelivery({ EMAIL_PROVIDER: "smtp", SMTP_URL: "smtps://user:hunter2@smtp.example.test:465", EMAIL_FROM: "A <a@example.test>" }).state).toBe("CONFIGURED");
    expect(describeEmailDelivery({ EMAIL_PROVIDER: "smtp", EMAIL_FROM: "a@example.test" }).state).toBe("NOT_CONFIGURED");
    expect(describeEmailDelivery({ EMAIL_PROVIDER: "carrier-pigeon" }).state).toBe("NOT_CONFIGURED");
  });

  it("console delivery is development-only: CONSOLE_ONLY outside production, NOT_CONFIGURED in production", () => {
    expect(describeEmailDelivery({ NODE_ENV: "development" }).state).toBe("CONSOLE_ONLY");
    expect(describeEmailDelivery({ NODE_ENV: "production" }).state).toBe("NOT_CONFIGURED");
    expect(describeEmailDelivery({ NODE_ENV: "production", EMAIL_PROVIDER: "console" }).state).toBe("NOT_CONFIGURED");
  });

  it("never echoes an environment value", () => {
    const env = { EMAIL_PROVIDER: "smtp", SMTP_URL: "smtps://user:hunter2@smtp.example.test:465", EMAIL_FROM: "Secret Sender <s@example.test>" };
    const detail = JSON.stringify(describeEmailDelivery(env));
    expect(detail).not.toMatch(/hunter2|smtp\.example|Secret Sender|s@example/);
  });
});
