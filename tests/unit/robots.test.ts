import { afterEach, describe, expect, it, vi } from "vitest";
import robots from "../../app/robots";

// Phase 6G-11 — app/robots.ts has no database dependency (pure config), so
// it's safe to import directly in a DB-free unit test, unlike the page
// route modules under app/(museum)/**.
//
// Phase 6J-1: the Sitemap line uses the dedicated PUBLIC_SITE_URL origin and
// fails loudly in production when it is missing.

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("robots", () => {
  it("disallows /studio and /api", () => {
    const result = robots();
    const rules = Array.isArray(result.rules) ? result.rules[0] : result.rules;
    expect(rules.disallow).toContain("/studio");
    expect(rules.disallow).toContain("/api");
  });

  it("allows public routes", () => {
    const result = robots();
    const rules = Array.isArray(result.rules) ? result.rules[0] : result.rules;
    expect(rules.allow).toBe("/");
  });

  it("references the sitemap on the configured public origin", () => {
    vi.stubEnv("PUBLIC_SITE_URL", "http://localhost:4321/");
    expect(robots().sitemap).toBe("http://localhost:4321/sitemap.xml");
  });

  it("in production uses PUBLIC_SITE_URL, never localhost and never AUTH_URL", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PUBLIC_SITE_URL", "https://musicmadras.example");
    vi.stubEnv("AUTH_URL", "http://localhost:3000");
    expect(robots().sitemap).toBe("https://musicmadras.example/sitemap.xml");
  });

  it("in production FAILS LOUDLY when the public origin is missing, instead of pointing crawlers at localhost", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PUBLIC_SITE_URL", "");
    vi.stubEnv("AUTH_URL", "https://auth.example");
    expect(() => robots()).toThrow(/PUBLIC_SITE_URL/);
  });
});
