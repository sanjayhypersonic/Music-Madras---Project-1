import type { MetadataRoute } from "next";
import { getSiteOrigin } from "../modules/config/siteOrigin";

// Phase 6G-11 — allows the public Museum to be crawled while keeping
// Studio and API routes out.
//
// Phase 6J-1: the Sitemap line uses the dedicated public origin
// (PUBLIC_SITE_URL — modules/config/siteOrigin.ts), not AUTH_URL, and this
// route is rendered per request, never frozen at build time, so it always
// reflects the deployed environment (and fails loudly in production if the
// origin is not configured, rather than pointing crawlers at localhost).

export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/studio", "/api"],
    },
    sitemap: `${getSiteOrigin()}/sitemap.xml`,
  };
}
