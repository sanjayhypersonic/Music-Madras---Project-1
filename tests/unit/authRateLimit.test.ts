import { describe, expect, it } from "vitest";
import {
  RESET_REQUEST_MAX,
  SIGN_IN_MAX_FAILURES,
  attemptKey,
  isResetRequestLimited,
  isSignInLockedOut,
  normaliseEmail,
} from "../../modules/auth/authRateLimit";

describe("auth rate-limit policy", () => {
  it("locks sign-in out at exactly the configured number of failures", () => {
    expect(SIGN_IN_MAX_FAILURES).toBe(5);
    expect(isSignInLockedOut(SIGN_IN_MAX_FAILURES - 1)).toBe(false);
    expect(isSignInLockedOut(SIGN_IN_MAX_FAILURES)).toBe(true);
    expect(isSignInLockedOut(SIGN_IN_MAX_FAILURES + 10)).toBe(true);
  });

  it("limits reset requests at exactly the configured number", () => {
    expect(isResetRequestLimited(RESET_REQUEST_MAX - 1)).toBe(false);
    expect(isResetRequestLimited(RESET_REQUEST_MAX)).toBe(true);
  });

  it("keys attempts by a hash of the normalised email — never the address — so case and spacing cannot dodge the limit", () => {
    expect(normaliseEmail("  Person@Example.ORG ")).toBe("person@example.org");
    const key = attemptKey("Person@Example.org");
    expect(key).toBe(attemptKey("  person@example.org "));
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(key).not.toContain("person");
    expect(key).not.toBe(attemptKey("other@example.org"));
  });
});
