import { describe, expect, it } from "vitest";
import { describeError, describeErrorLine, scrubMessage } from "../../modules/jobs/scrubError";
import { transportReason } from "../../modules/auth/email/emailProvider";
import { buildStudioLink, resolveStudioOrigin } from "../../modules/notifications/studioLink";
import { SEARCH_MAX_LENGTH, escapeLikePattern, likeNeedle, normaliseSearchText } from "../../modules/mmke/search/searchText";
import { describeRolesThatCan, can } from "../../modules/auth/policy";
import { decisionLabel, DECISION_LABEL } from "../../modules/mmke/videoReview/decisionLabels";
import { classifyReview } from "../../modules/mmke/videoReview/reviewQueue";

// Lifecycle hardening — small pure helpers: scrubbed failure details (F7/F10), validated absolute links (F20), search text (F20), role wording and
// decision labels (F18), and the review queue's handling of an archived page (F11). Synthetic values only.

describe("failure details are safe to store and show", () => {
  it.each([
    ["a postgres connection string", "connect failed: postgresql://app:SuperSecret123@db.internal.example:5432/prod", ["SuperSecret123", "db.internal.example", "postgresql://"]],
    ["an smtp url with credentials", "535 auth failed for smtps://mailer:SECRET-PASSWORD-123@smtp.example.test:465", ["SECRET-PASSWORD-123", "smtps://", "smtp.example.test"]],
    ["an e-mail address", "550 mailbox sanjay.paul@example.test rejected", ["sanjay.paul@example.test"]],
    ["a bearer token", "request failed with Authorization: Bearer abcDEF123456ghiJKL789012mnoPQR", ["abcDEF123456ghiJKL789012mnoPQR"]],
    ["a password pair", "login failed password=hunter2hunter2 for user", ["hunter2hunter2"]],
    ["an API key", "invalid api_key: sk-live-0123456789abcdefghijklmnop", ["sk-live-0123456789abcdefghijklmnop"]],
    ["a long opaque token", "token rejected: 9f8e7d6c5b4a39281706f5e4d3c2b1a0ffeeddccbbaa", ["9f8e7d6c5b4a39281706f5e4d3c2b1a0ffeeddccbbaa"]],
    ["an ip and port", "timeout connecting to 10.20.30.40:5432", ["10.20.30.40"]],
  ])("scrubs %s", (_name, message, forbidden) => {
    const scrubbed = scrubMessage(message);
    for (const f of forbidden) expect(scrubbed).not.toContain(f);
  });

  it("keeps one short line: a multi-line stack trace is cut to its first line, and a long message is bounded", () => {
    expect(scrubMessage("first line\n    at secretFunction (/srv/app/file.ts:1:1)")).toBe("first line");
    expect(scrubMessage("x ".repeat(500)).length).toBeLessThanOrEqual(240);
  });

  it("reports an error by class (and a database code) from a safe alphabet, never by arbitrary text", () => {
    const prismaLike = Object.assign(new Error("Unique constraint failed on the fields: (`dedupeKey`)"), { name: "PrismaClientKnownRequestError", code: "P2002" });
    expect(describeError(prismaLike).kind).toBe("PrismaClientKnownRequestError:P2002");
    const weird = Object.assign(new Error("boom"), { name: "<script>alert(1)</script>", code: "../../etc/passwd" });
    expect(describeError(weird).kind).toBe("Error");
    expect(describeError("a string").kind).toBe("UnknownError");
    expect(describeError(null).summary).toBe("A non-error value was thrown.");
  });

  it("keeps an error's short code-only reason (an SMTP error code and reply number) and nothing else about the transport", () => {
    const err = Object.assign(new Error("535 auth failed for smtps://u:p@h.test"), { reason: "EAUTH 535" });
    expect(describeError(err).summary).toContain("(EAUTH 535)");
    expect(describeError(err).summary).not.toContain("u:p@");
    const forged = Object.assign(new Error("x"), { reason: "see https://evil.example/ for details" });
    expect(describeError(forged).summary).not.toContain("evil.example"); // a reason that is not code-shaped is ignored
  });

  it("transportReason takes only code-shaped values from a transport error and never its message", () => {
    expect(transportReason(Object.assign(new Error("secret"), { code: "EAUTH", responseCode: 535 }))).toBe("EAUTH 535");
    expect(transportReason(Object.assign(new Error("secret"), { code: "ETIMEDOUT" }))).toBe("ETIMEDOUT");
    expect(transportReason(Object.assign(new Error("secret"), { responseCode: 550 }))).toBe("550");
    expect(transportReason(Object.assign(new Error("secret"), { code: "smtps://u:p@h", responseCode: 99999 }))).toBeNull();
    expect(transportReason("a string")).toBeNull();
    expect(transportReason(null)).toBeNull();
  });
  it("describeErrorLine is one bounded 'Kind: summary' line", () => {
    const line = describeErrorLine(new TypeError("smtps://u:p@h.test/x failed"));
    expect(line.startsWith("TypeError: ")).toBe(true);
    expect(line).not.toContain("u:p@");
    expect(line.length).toBeLessThanOrEqual(300);
  });
});

describe("links in notification e-mails are absolute and validated", () => {
  it("accepts an https origin (any path-less form) and loopback http for local development", () => {
    expect(resolveStudioOrigin("https://studio.example.org")).toBe("https://studio.example.org");
    expect(resolveStudioOrigin("https://studio.example.org/")).toBe("https://studio.example.org");
    expect(resolveStudioOrigin("  https://studio.example.org:8443  ")).toBe("https://studio.example.org:8443");
    expect(resolveStudioOrigin("http://localhost:3000")).toBe("http://localhost:3000");
    expect(resolveStudioOrigin("http://127.0.0.1:3000/")).toBe("http://127.0.0.1:3000");
  });

  it.each([
    ["missing", undefined],
    ["null", null],
    ["empty", ""],
    ["blank", "   "],
    ["no scheme", "studio.example.org"],
    ["plain http on a real host", "http://studio.example.org"],
    ["a non-web scheme", "javascript:alert(1)"],
    ["credentials in the URL", "https://user:pass@studio.example.org"],
    ["a query string", "https://studio.example.org/?next=/evil"],
    ["a fragment", "https://studio.example.org/#x"],
    ["a path that is not an origin", "https://studio.example.org/studio"],
    ["a relative path", "/studio/notifications"],
    ["garbage", "http//::"],
  ])("refuses %s: no origin, so no link", (_name, value) => {
    expect(resolveStudioOrigin(value as string | null | undefined)).toBeNull();
  });

  it("builds a link only from a valid origin and a Studio path; otherwise null (the e-mail then carries no link)", () => {
    expect(buildStudioLink("https://studio.example.org", "/studio/notifications")).toBe("https://studio.example.org/studio/notifications");
    expect(buildStudioLink(null, "/studio/notifications")).toBeNull();
    expect(buildStudioLink("https://studio.example.org", null)).toBeNull();
    expect(buildStudioLink("https://studio.example.org", "https://evil.example/x")).toBeNull();
    expect(buildStudioLink("https://studio.example.org", "//evil.example/x")).toBeNull();
    expect(buildStudioLink("https://studio.example.org", "/museum/page")).toBeNull(); // not a Studio path
  });
});

describe("search text is bounded and wildcards are literal", () => {
  it("escapes % _ and \\ so they match themselves", () => {
    expect(escapeLikePattern("100%")).toBe("100\\%");
    expect(escapeLikePattern("a_b")).toBe("a\\_b");
    expect(escapeLikePattern("a\\b")).toBe("a\\\\b");
    expect(escapeLikePattern("plain")).toBe("plain");
  });

  it("normalises whitespace, trims, and treats empty input as no search", () => {
    expect(normaliseSearchText("  a   b \n c ")).toBe("a b c");
    expect(normaliseSearchText("")).toBeUndefined();
    expect(normaliseSearchText("   ")).toBeUndefined();
    expect(normaliseSearchText(undefined)).toBeUndefined();
    expect(normaliseSearchText(null)).toBeUndefined();
  });

  it("bounds the length (by character, never splitting one) and ignores the rest", () => {
    expect(normaliseSearchText("a".repeat(500))).toHaveLength(SEARCH_MAX_LENGTH);
    const astral = "𝄞".repeat(300); // outside the BMP: two UTF-16 units each
    expect([...normaliseSearchText(astral)!]).toHaveLength(SEARCH_MAX_LENGTH);
    expect(likeNeedle("_".repeat(300))).toBe("\\_".repeat(SEARCH_MAX_LENGTH));
  });

  it("likeNeedle is bounded, normalised and escaped in one step", () => {
    expect(likeNeedle("  50%  off ")).toBe("50\\% off");
    expect(likeNeedle(undefined)).toBe("");
  });
});

describe("role wording is derived from the policy", () => {
  it("names exactly the roles that hold the permission, from the most junior to the most senior", () => {
    expect(describeRolesThatCan("RECORDING_PUBLISH")).toBe("Administrators, Super Administrators and Founders");
    expect(describeRolesThatCan("SETTINGS_MANAGE")).toBe("Super Administrators and Founders");
    expect(describeRolesThatCan("CATALOGUE_WRITE")).toBe("Editors, Reviewers, Administrators, Super Administrators and Founders");
  });

  it("matches can() for every role (it cannot drift from the policy)", () => {
    const roles = ["FOUNDER", "SUPER_ADMINISTRATOR", "ADMINISTRATOR", "EDITOR", "REVIEWER", "CONTRIBUTOR"] as const;
    const wording = describeRolesThatCan("RECORDING_PUBLISH");
    for (const role of roles) {
      const plural = { FOUNDER: "Founders", SUPER_ADMINISTRATOR: "Super Administrators", ADMINISTRATOR: "Administrators", EDITOR: "Editors", REVIEWER: "Reviewers", CONTRIBUTOR: "Contributors" }[role];
      expect(wording.includes(plural), role).toBe(can(role, "RECORDING_PUBLISH"));
    }
  });
});

describe("the review history names each event as itself", () => {
  it("gives hold-set, hold-cleared, request-info and decline their own labels", () => {
    expect(decisionLabel("HOLD_SET")).toBe("Hold recorded");
    expect(decisionLabel("HOLD_CLEARED")).toBe("Hold cleared");
    expect(decisionLabel("REQUEST_INFO")).toBe("Asked for more information");
    expect(decisionLabel("DECLINE")).toBe("Declined");
    expect(new Set(Object.values(DECISION_LABEL)).size).toBe(Object.keys(DECISION_LABEL).length); // no two kinds share a label
  });
});

describe("an archived page is nothing to decide until it is restored", () => {
  const now = new Date("2026-01-01T00:00:00Z");
  const review = { state: "APPROVED" as const, proposalFingerprint: "f", deferUntil: null, holdReason: null };
  it("is not awaiting a decision whatever the review says (an archived page cannot be approved)", () => {
    for (const r of [null, review, { ...review, state: "PENDING" as const }, { ...review, state: "DEFERRED" as const, deferUntil: new Date("2025-01-01") }]) {
      expect(classifyReview({ review: r, fingerprint: "f", now, hasActivePageApproval: false, pageArchived: true })).toEqual({ class: "ARCHIVED_PAGE", awaitingDecision: false });
    }
  });
  it("an approval that ended for a restored page needs a FRESH decision", () => {
    expect(classifyReview({ review, fingerprint: "f", now, hasActivePageApproval: false, pageArchived: false })).toEqual({ class: "NEEDS_DECISION", awaitingDecision: true });
  });
});
