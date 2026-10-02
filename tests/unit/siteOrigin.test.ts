import { describe, expect, it } from "vitest";
import { SiteOriginNotConfiguredError, getSiteOrigin, parsePublicSiteUrl } from "../../modules/config/siteOrigin";

// Phase 6J-1 — the public origin must never silently become localhost in
// production (canonicals, sitemap, robots, OpenGraph and email links).

describe("parsePublicSiteUrl", () => {
  it("normalises to an origin (drops path, query and trailing slash)", () => {
    expect(parsePublicSiteUrl("https://musicmadras.example/", { requireHttpsNonLocal: true })).toEqual({ ok: true, origin: "https://musicmadras.example" });
    expect(parsePublicSiteUrl("https://musicmadras.example/archive?x=1", { requireHttpsNonLocal: true })).toEqual({ ok: true, origin: "https://musicmadras.example" });
  });

  it("rejects non-URLs and non-http(s) schemes", () => {
    expect(parsePublicSiteUrl("not a url", { requireHttpsNonLocal: false }).ok).toBe(false);
    expect(parsePublicSiteUrl("ftp://musicmadras.example", { requireHttpsNonLocal: false }).ok).toBe(false);
  });

  it("in production mode rejects http and localhost addresses", () => {
    expect(parsePublicSiteUrl("http://musicmadras.example", { requireHttpsNonLocal: true }).ok).toBe(false);
    expect(parsePublicSiteUrl("https://localhost:3000", { requireHttpsNonLocal: true }).ok).toBe(false);
    expect(parsePublicSiteUrl("https://127.0.0.1", { requireHttpsNonLocal: true }).ok).toBe(false);
    expect(parsePublicSiteUrl("http://localhost:3000", { requireHttpsNonLocal: false })).toEqual({ ok: true, origin: "http://localhost:3000" });
  });
});

describe("getSiteOrigin", () => {
  it("production at runtime FAILS LOUDLY when PUBLIC_SITE_URL is missing — it never falls back to AUTH_URL or localhost", () => {
    expect(() => getSiteOrigin({ NODE_ENV: "production" })).toThrow(SiteOriginNotConfiguredError);
    expect(() => getSiteOrigin({ NODE_ENV: "production", AUTH_URL: "https://musicmadras.example" })).toThrow(SiteOriginNotConfiguredError);
    expect(() => getSiteOrigin({ NODE_ENV: "production", PUBLIC_SITE_URL: "   " })).toThrow(SiteOriginNotConfiguredError);
  });

  it("production at runtime also refuses an http or localhost PUBLIC_SITE_URL", () => {
    expect(() => getSiteOrigin({ NODE_ENV: "production", PUBLIC_SITE_URL: "http://musicmadras.example" })).toThrow(SiteOriginNotConfiguredError);
    expect(() => getSiteOrigin({ NODE_ENV: "production", PUBLIC_SITE_URL: "https://localhost" })).toThrow(SiteOriginNotConfiguredError);
  });

  it("production uses a valid PUBLIC_SITE_URL, normalised", () => {
    expect(getSiteOrigin({ NODE_ENV: "production", PUBLIC_SITE_URL: "https://musicmadras.example/" })).toBe("https://musicmadras.example");
  });

  it("during `next build` a missing variable does not block the build", () => {
    expect(getSiteOrigin({ NODE_ENV: "production", NEXT_PHASE: "phase-production-build" })).toBe("http://localhost:3000");
    expect(getSiteOrigin({ NODE_ENV: "production", NEXT_PHASE: "phase-production-build", PUBLIC_SITE_URL: "https://musicmadras.example" })).toBe("https://musicmadras.example");
  });

  it("development prefers PUBLIC_SITE_URL, then AUTH_URL, then localhost", () => {
    expect(getSiteOrigin({ NODE_ENV: "development", PUBLIC_SITE_URL: "http://localhost:4000" })).toBe("http://localhost:4000");
    expect(getSiteOrigin({ NODE_ENV: "development", AUTH_URL: "http://localhost:3100/" })).toBe("http://localhost:3100");
    expect(getSiteOrigin({ NODE_ENV: "development" })).toBe("http://localhost:3000");
    expect(getSiteOrigin({})).toBe("http://localhost:3000");
  });
});
