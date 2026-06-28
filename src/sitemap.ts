// Next.js 15 Metadata API - sitemap.ts Dynamic Generator Blueprint
// This file outlines the canonical URLs, update rates, and priority weighting
// for search crawlers, synchronized with the active production /public/sitemap.xml.

export interface SitemapItem {
  url: string;
  lastModified?: string | Date;
  changeFrequency?: 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never';
  priority?: number;
}

export default function sitemap(): SitemapItem[] {
  const currentDate = new Date('2026-06-28');

  return [
    {
      url: 'https://www.musicmadras.com/',
      lastModified: currentDate,
      changeFrequency: 'daily',
      priority: 1.0,
    },
    {
      url: 'https://www.musicmadras.com/?tab=Concert',
      lastModified: currentDate,
      changeFrequency: 'weekly',
      priority: 0.8,
    },
    {
      url: 'https://www.musicmadras.com/?tab=playlists',
      lastModified: currentDate,
      changeFrequency: 'weekly',
      priority: 0.8,
    },
    {
      url: 'https://www.musicmadras.com/?tab=tech-specs',
      lastModified: currentDate,
      changeFrequency: 'monthly',
      priority: 0.7,
    },
    {
      url: 'https://www.musicmadras.com/?tab=artist-program',
      lastModified: currentDate,
      changeFrequency: 'monthly',
      priority: 0.9,
    },
  ];
}
