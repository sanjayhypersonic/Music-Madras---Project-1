// Post-deploy SMOKE checks (launch readiness; docs/deployment-readiness-gate.md §3 and §4 "post-cut-over smoke test"). The anonymous, automatable part of the gate, as code,
// so it is run identically on staging, on a pre-promotion URL, and straight after cut-over, and its result is evidence rather than a recollection.
//
// It makes only read requests (GET) to public URLs, sends no credentials, and reports facts. What it cannot do is listed in the runbook as manual: Studio sign-in with a
// real account, email delivery to a real mailbox, cookie flags (they are only set by a real sign-in), and error-reporting delivery.
//
// `fetchFn` is injected so the checks are tested without a network. Every check returns ok/detail and never throws.

export interface SmokeResponse {
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}
export type SmokeFetch = (url: string) => Promise<SmokeResponse>;

export interface SmokeCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface SmokeOptions {
  /** Where to probe, e.g. https://staging.example or a pre-promotion URL. */
  baseUrl: string;
  /** The public origin the site is configured with (PUBLIC_SITE_URL). Defaults to baseUrl's origin. */
  expectedOrigin?: string;
  fetchFn: SmokeFetch;
}

const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)$/i;

const trimSlash = (s: string) => s.replace(/\/+$/, "");

async function attempt(name: string, work: () => Promise<{ ok: boolean; detail: string }>): Promise<SmokeCheck> {
  try {
    const r = await work();
    return { name, ok: r.ok, detail: r.detail };
  } catch (err) {
    return { name, ok: false, detail: `request failed (${err instanceof Error ? err.name : "unknown error"})` };
  }
}

export async function runSmokeChecks(options: SmokeOptions): Promise<SmokeCheck[]> {
  const base = trimSlash(options.baseUrl);
  const expectedOrigin = trimSlash(options.expectedOrigin ?? new URL(base).origin);
  const expectedHost = new URL(expectedOrigin).hostname;
  const expectingLocal = LOCAL.test(expectedHost);
  const get = (path: string) => options.fetchFn(`${base}${path}`);
  const checks: SmokeCheck[] = [];

  checks.push(
    await attempt("GET /api/health is 200 and says ok (the process is up and the production configuration was accepted)", async () => {
      const r = await get("/api/health");
      const body = await r.text();
      return { ok: r.status === 200 && /"status"\s*:\s*"ok"/.test(body), detail: `status ${r.status}` };
    })
  );

  checks.push(
    await attempt("GET /api/ready is 200 and says ready (the database answers and every migration this release needs is applied)", async () => {
      const r = await get("/api/ready");
      const body = await r.text();
      return { ok: r.status === 200 && /"status"\s*:\s*"ready"/.test(body), detail: `status ${r.status}` };
    })
  );

  checks.push(
    await attempt("GET / is 200 and names only the configured origin (no localhost in canonical or og:url)", async () => {
      const r = await get("/");
      const html = await r.text();
      const urls = [...html.matchAll(/<(?:link[^>]+rel="canonical"[^>]+href|meta[^>]+property="og:url"[^>]+content)="([^"]+)"/g)].map((m) => m[1]);
      const wrong = urls.filter((u) => !u.startsWith(expectedOrigin) || (!expectingLocal && /\/\/(localhost|127\.0\.0\.1)/i.test(u)));
      return { ok: r.status === 200 && wrong.length === 0, detail: `status ${r.status}, ${urls.length} origin reference(s), ${wrong.length} wrong` };
    })
  );

  checks.push(
    await attempt("GET /sitemap.xml is 200 and lists only the configured origin", async () => {
      const r = await get("/sitemap.xml");
      const xml = await r.text();
      const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
      const wrong = locs.filter((u) => !u.startsWith(expectedOrigin));
      return { ok: r.status === 200 && wrong.length === 0, detail: `status ${r.status}, ${locs.length} URL(s), ${wrong.length} on another origin` };
    })
  );

  checks.push(
    await attempt("GET /robots.txt is 200, points at this origin's sitemap and keeps /studio and /api out", async () => {
      const r = await get("/robots.txt");
      const text = await r.text();
      const ok = r.status === 200 && text.includes(`Sitemap: ${expectedOrigin}/sitemap.xml`) && /Disallow:\s*\/studio/.test(text) && /Disallow:\s*\/api/.test(text);
      return { ok, detail: `status ${r.status}` };
    })
  );

  checks.push(
    await attempt("GET /studio/signin is 200", async () => {
      const r = await get("/studio/signin");
      return { ok: r.status === 200, detail: `status ${r.status}` };
    })
  );

  checks.push(
    await attempt("an unknown URL is 404 (not a soft 200)", async () => {
      const r = await get(`/__smoke-unknown-${Date.now().toString(36)}`);
      return { ok: r.status === 404, detail: `status ${r.status}` };
    })
  );

  checks.push(
    await attempt("security headers are present on the public site (nosniff, framing denied, permissions policy; HSTS on https)", async () => {
      const r = await get("/");
      const missing: string[] = [];
      if ((r.headers.get("x-content-type-options") ?? "").toLowerCase() !== "nosniff") missing.push("X-Content-Type-Options");
      if (!/deny/i.test(r.headers.get("x-frame-options") ?? "") && !/frame-ancestors/i.test(r.headers.get("content-security-policy") ?? "")) missing.push("frame protection");
      if (!r.headers.get("permissions-policy")) missing.push("Permissions-Policy");
      if (base.startsWith("https://") && !r.headers.get("strict-transport-security")) missing.push("Strict-Transport-Security");
      return { ok: missing.length === 0, detail: missing.length === 0 ? "all present" : `missing: ${missing.join(", ")}` };
    })
  );

  checks.push(
    await attempt("public pages are not cached by a shared cache (Cache-Control private/no-store or max-age=0 on /)", async () => {
      const r = await get("/");
      const cc = r.headers.get("cache-control") ?? "";
      const ok = /no-store|private|max-age=0|no-cache/i.test(cc) && !/s-maxage=[1-9]/i.test(cc);
      return { ok, detail: cc ? `cache-control: ${cc}` : "no Cache-Control header" };
    })
  );

  return checks;
}

export function summariseSmoke(checks: readonly SmokeCheck[]): { passed: number; failed: number; ok: boolean } {
  const failed = checks.filter((c) => !c.ok).length;
  return { passed: checks.length - failed, failed, ok: failed === 0 };
}
