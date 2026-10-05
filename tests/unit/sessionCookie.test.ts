import { describe, expect, it } from "vitest";
import { shouldUseSecureCookies } from "../../modules/auth/sessionCookie";

// Phase 6J-5 — the session cookie is Secure in production even when AUTH_URL is missing or http.
describe("shouldUseSecureCookies", () => {
  it("is secure for an https AUTH_URL", () => {
    expect(shouldUseSecureCookies({ AUTH_URL: "https://www.example.org", NODE_ENV: "development" })).toBe(true);
  });

  it("is secure in production regardless of AUTH_URL (unset or http)", () => {
    expect(shouldUseSecureCookies({ NODE_ENV: "production" })).toBe(true);
    expect(shouldUseSecureCookies({ AUTH_URL: "http://localhost:3000", NODE_ENV: "production" })).toBe(true);
  });

  it("stays non-secure only for local development over http", () => {
    expect(shouldUseSecureCookies({ AUTH_URL: "http://localhost:3000", NODE_ENV: "development" })).toBe(false);
    expect(shouldUseSecureCookies({})).toBe(false);
  });
});
