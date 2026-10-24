import { describe, expect, it } from "vitest";
import { runSmokeChecks, summariseSmoke, type SmokeFetch, type SmokeResponse } from "../../modules/ops/smokeChecks";

// The anonymous post-deploy smoke checks, against a fake site (no network): a healthy deployment passes every check, and each failure mode of the gate is detected.

const ORIGIN = "https://museum.example";
const GOOD_HEADERS: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "content-security-policy": "frame-ancestors 'none'",
  "permissions-policy": "camera=()",
  "strict-transport-security": "max-age=31536000",
  "cache-control": "private, no-cache, no-store, max-age=0, must-revalidate",
};

function response(status: number, body: string, headers: Record<string, string> = GOOD_HEADERS): SmokeResponse {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return { status, headers: { get: (n) => lower[n.toLowerCase()] ?? null }, text: async () => body };
}

type Routes = Record<string, SmokeResponse | (() => Promise<SmokeResponse>)>;

function healthySite(overrides: Routes = {}): SmokeFetch {
  const routes: Routes = {
    "/api/health": response(200, '{"status":"ok"}'),
    "/api/ready": response(200, '{"status":"ready"}'),
    "/": response(200, `<html><head><link rel="canonical" href="${ORIGIN}/"/><meta property="og:url" content="${ORIGIN}/"/></head></html>`),
    "/sitemap.xml": response(200, `<urlset><url><loc>${ORIGIN}/recordings/a</loc></url><url><loc>${ORIGIN}/works/b</loc></url></urlset>`),
    "/robots.txt": response(200, `User-Agent: *\nAllow: /\nDisallow: /studio\nDisallow: /api\nSitemap: ${ORIGIN}/sitemap.xml`),
    "/studio/signin": response(200, "sign in"),
    ...overrides,
  };
  return async (url) => {
    const p = new URL(url).pathname;
    const hit = routes[p];
    if (hit) return typeof hit === "function" ? hit() : hit;
    return response(404, "not found");
  };
}

const failing = (checks: Awaited<ReturnType<typeof runSmokeChecks>>) => checks.filter((c) => !c.ok).map((c) => c.name.split(" ").slice(0, 3).join(" "));
const run = (fetchFn: SmokeFetch, expectedOrigin = ORIGIN) => runSmokeChecks({ baseUrl: ORIGIN, expectedOrigin, fetchFn });

describe("a healthy deployment", () => {
  it("passes every check", async () => {
    const checks = await run(healthySite());
    expect(failing(checks)).toEqual([]);
    expect(summariseSmoke(checks)).toEqual({ passed: checks.length, failed: 0, ok: true });
    expect(checks.length).toBeGreaterThanOrEqual(9);
  });
});

describe("each way a deployment can be wrong is detected", () => {
  it("liveness: the process answers but reports a problem", async () => {
    expect(failing(await run(healthySite({ "/api/health": response(500, "boom") })))).toEqual(["GET /api/health is"]);
  });
  it("readiness: the database or schema is not ready, even though /api/health is fine", async () => {
    const checks = await run(healthySite({ "/api/ready": response(503, '{"status":"not-ready"}') }));
    expect(failing(checks)).toEqual(["GET /api/ready is"]);
    expect(summariseSmoke(checks).ok).toBe(false);
  });
  it("a sitemap, canonical or og:url pointing at localhost or another origin", async () => {
    const wrongSitemap = healthySite({ "/sitemap.xml": response(200, "<urlset><url><loc>http://localhost:3000/recordings/a</loc></url></urlset>") });
    expect(failing(await run(wrongSitemap))).toEqual(["GET /sitemap.xml is"]);
    const wrongCanonical = healthySite({ "/": response(200, '<link rel="canonical" href="http://localhost:3000/"/>') });
    expect(failing(await run(wrongCanonical))).toEqual(["GET / is"]);
  });
  it("robots.txt that does not keep /studio and /api out, or names another sitemap", async () => {
    expect(failing(await run(healthySite({ "/robots.txt": response(200, "User-Agent: *\nAllow: /") })))).toEqual(["GET /robots.txt is"]);
  });
  it("Studio sign-in page down", async () => {
    expect(failing(await run(healthySite({ "/studio/signin": response(500, "x") })))).toEqual(["GET /studio/signin is"]);
  });
  it("an unknown URL that answers 200 (a soft 404)", async () => {
    const soft: SmokeFetch = async (url) => (new URL(url).pathname.startsWith("/__smoke-unknown-") ? response(200, "hello") : healthySite()(url));
    expect(failing(await run(soft))).toEqual(["an unknown URL"]);
  });
  it("missing security headers, including HSTS on https", async () => {
    const bare = { ...GOOD_HEADERS };
    delete bare["strict-transport-security"];
    delete bare["permissions-policy"];
    const checks = await run(healthySite({ "/": response(200, `<link rel="canonical" href="${ORIGIN}/"/>`, bare) }));
    expect(failing(checks)).toEqual(["security headers are"]);
    expect(checks.find((c) => c.detail.startsWith("missing"))!.detail).toMatch(/Permissions-Policy.*Strict-Transport-Security|Strict-Transport-Security/);
  });
  it("a shared cache allowed to hold public pages (a CDN would then outlive a hold or an unpublish)", async () => {
    const cached = { ...GOOD_HEADERS, "cache-control": "public, s-maxage=31536000, stale-while-revalidate" };
    expect(failing(await run(healthySite({ "/": response(200, `<link rel="canonical" href="${ORIGIN}/"/>`, cached) })))).toEqual(["public pages are"]);
  });
  it("a request that throws is a failed check, never an exception", async () => {
    const down: SmokeFetch = async () => {
      throw new TypeError("fetch failed: connect ECONNREFUSED 10.0.0.5:443");
    };
    const checks = await run(down);
    expect(checks.every((c) => !c.ok)).toBe(true);
    expect(checks.every((c) => !/10\.0\.0\.5|ECONNREFUSED/.test(c.detail))).toBe(true); // the failure's class only, not its message
  });
  it("a local base URL is allowed to name itself (staging on localhost), but not a different origin", async () => {
    const local = "http://localhost:3112";
    const site: SmokeFetch = async (url) => {
      const p = new URL(url).pathname;
      if (p === "/") return response(200, `<link rel="canonical" href="${local}/"/>`, { ...GOOD_HEADERS, "strict-transport-security": "" });
      if (p === "/sitemap.xml") return response(200, `<loc>${local}/x</loc>`);
      if (p === "/robots.txt") return response(200, `Disallow: /studio\nDisallow: /api\nSitemap: ${local}/sitemap.xml`);
      if (p === "/api/health") return response(200, '{"status":"ok"}');
      if (p === "/api/ready") return response(200, '{"status":"ready"}');
      if (p === "/studio/signin") return response(200, "x");
      return response(404, "nf");
    };
    expect(failing(await runSmokeChecks({ baseUrl: local, fetchFn: site }))).toEqual([]);
  });
});
