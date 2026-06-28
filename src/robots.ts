// Next.js 15 Metadata API - robots.ts Configuration
// This file serves as a reference blueprint for future Next.js transitions,
// and matches the current active search rules deployed in /public/robots.txt.

export interface Robots {
  rules: {
    userAgent?: string | string[];
    allow?: string | string[];
    disallow?: string | string[];
    crawlDelay?: number;
  } | Array<{
    userAgent: string | string[];
    allow?: string | string[];
    disallow?: string | string[];
    crawlDelay?: number;
  }>;
  sitemap?: string | string[];
  host?: string;
}

export default function robots(): Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
    },
    sitemap: 'https://www.musicmadras.com/sitemap.xml',
    host: 'https://www.musicmadras.com',
  };
}
