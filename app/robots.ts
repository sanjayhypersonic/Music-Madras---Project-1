import type { MetadataRoute } from "next";

// Phase 6G-11 — allows the public Museum to be crawled while keeping
// Studio and API routes out, referencing the same canonical/base URL
// convention every public page already uses (process.env.AUTH_URL).

const SITE_ORIGIN = process.env.AUTH_URL ?? "http://localhost:3000";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/studio", "/api"],
    },
    sitemap: `${SITE_ORIGIN}/sitemap.xml`,
  };
}
