// Phase 6J-1 — the public origin of this site (scheme + host, e.g.
// https://musicmadras.example), used for canonical URLs, Open Graph/JSON-LD
// urls, the sitemap, robots.txt and the links in Studio emails.
//
// The V1 audit found every public page falling back to http://localhost:3000
// when AUTH_URL was missing — and AUTH_URL is an AUTHENTICATION setting that
// also decides the session cookie's Secure flag, so reusing it for SEO meant a
// small auth misconfiguration silently poisoned every canonical URL and the
// whole sitemap. The public origin now has its own variable:
//
//   PUBLIC_SITE_URL   e.g. https://musicmadras.example   (required in production)
//
// Rules:
//   - production (at runtime): PUBLIC_SITE_URL must be set, absolute, https, and
//     not a localhost address — otherwise this THROWS, so a misconfigured
//     deployment fails loudly instead of emitting localhost URLs;
//   - during `next build` (NEXT_PHASE=phase-production-build) it never throws, so a
//     build is not blocked by a variable only the runtime needs — but if the
//     variable IS set it is validated and used;
//   - development/test: PUBLIC_SITE_URL if set, else AUTH_URL, else
//     http://localhost:3000.
// The value is normalised to an origin: any path, query or trailing slash is dropped.

export class SiteOriginNotConfiguredError extends Error {
  constructor(reason: string) {
    super(`PUBLIC_SITE_URL: ${reason}`);
    this.name = "SiteOriginNotConfiguredError";
  }
}

const LOCAL_FALLBACK = "http://localhost:3000";

function isLocalHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname.endsWith(".localhost");
}

/** Pure. Returns the origin, or the reason it is unacceptable. */
export function parsePublicSiteUrl(raw: string, options: { requireHttpsNonLocal: boolean }): { ok: true; origin: string } | { ok: false; reason: string } {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, reason: "must be an absolute URL such as https://musicmadras.example." };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, reason: "must start with https:// (or http:// in development)." };
  }
  if (options.requireHttpsNonLocal) {
    if (url.protocol !== "https:") return { ok: false, reason: "must use https:// in production." };
    if (isLocalHostname(url.hostname)) return { ok: false, reason: "must not be a localhost address in production." };
  }
  return { ok: true, origin: url.origin };
}

export function getSiteOrigin(env: Record<string, string | undefined> = process.env): string {
  const isProduction = env.NODE_ENV === "production";
  const isBuildPhase = env.NEXT_PHASE === "phase-production-build";
  const configured = env.PUBLIC_SITE_URL?.trim();

  if (configured) {
    const parsed = parsePublicSiteUrl(configured, { requireHttpsNonLocal: isProduction && !isBuildPhase });
    if (parsed.ok) return parsed.origin;
    if (isProduction && !isBuildPhase) throw new SiteOriginNotConfiguredError(parsed.reason);
    // Development/build with an unusable value: fall through to the local default rather than emit it.
  } else if (isProduction && !isBuildPhase) {
    throw new SiteOriginNotConfiguredError("is not set. Set it to the public https:// address of the site (for example https://musicmadras.example).");
  }

  if (!isProduction) {
    const auth = env.AUTH_URL?.trim();
    if (auth) {
      const parsed = parsePublicSiteUrl(auth, { requireHttpsNonLocal: false });
      if (parsed.ok) return parsed.origin;
    }
  }
  return LOCAL_FALLBACK;
}
