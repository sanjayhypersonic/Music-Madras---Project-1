import { describe, expect, it } from "vitest";
import robots from "../../app/robots";

// Phase 6G-11 — app/robots.ts has no database dependency (pure config), so
// it's safe to import directly in a DB-free unit test, unlike the page
// route modules under app/(museum)/**.

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

  it("references the sitemap using the AUTH_URL-based canonical origin", () => {
    const result = robots();
    expect(result.sitemap).toBe(`${process.env.AUTH_URL ?? "http://localhost:3000"}/sitemap.xml`);
  });
});
