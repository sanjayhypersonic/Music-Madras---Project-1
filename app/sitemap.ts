import type { MetadataRoute } from "next";
import { getSiteOrigin } from "../modules/config/siteOrigin";
import { listPublishedCollections } from "../modules/db/repositories/collectionRepository";
import { listPublishedVideoPages } from "../modules/db/repositories/youtubeVideoPageRepository";
import { listPublicLearningGuides } from "../modules/db/repositories/learningGuideRepository";
import { listPublishedPlaylistPages } from "../modules/db/repositories/playlistPageRepository";
import {
  listPublicArtistSitemapEntries,
  listPublicChoirSitemapEntries,
  listPublicComposerSitemapEntries,
  listPublicConductorSitemapEntries,
  listPublicOrganisationSitemapEntries,
  listPublicVenueSitemapEntries,
  listPublicPerformanceSitemapEntries,
  listPublicProgrammeSitemapEntries,
  listPublicRecordingSitemapEntries,
  listPublicWorkSitemapEntries,
} from "../modules/db/repositories/sitemapRepository";

// Phase 6G-11 — the canonical, database-driven sitemap for the public
// Museum. No second visibility system: every entity list here is either
// an existing public-visibility repository function
// (listPublishedCollections, listPublishedVideoPages) or a sitemapRepository.ts
// function built on the same eligibility fragments as the entity pages and
// archive search (Phase 6J-1). Studio, API routes, drafts, archived
// content, and /archive query-string states are never included — the
// canonical bare entity URL is the only one ever listed.

// Phase 6J-1: rendered per request (never frozen at build time), so newly published
// content appears in the sitemap without a redeploy and a draft/archived/unpublished
// entity disappears from it as soon as it stops being public. The origin is the
// dedicated PUBLIC_SITE_URL (modules/config/siteOrigin.ts), which fails loudly in
// production when missing instead of emitting localhost URLs.
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const SITE_ORIGIN = getSiteOrigin();
  const [
    composers,
    artists,
    choirs,
    conductors,
    venues,
    organisations,
    works,
    programmes,
    performances,
    recordings,
    collections,
    videoPages,
    learningGuides,
    playlistPages,
  ] = await Promise.all([
    listPublicComposerSitemapEntries(),
    listPublicArtistSitemapEntries(),
    listPublicChoirSitemapEntries(),
    listPublicConductorSitemapEntries(),
    listPublicVenueSitemapEntries(),
    listPublicOrganisationSitemapEntries(),
    listPublicWorkSitemapEntries(),
    listPublicProgrammeSitemapEntries(),
    listPublicPerformanceSitemapEntries(),
    listPublicRecordingSitemapEntries(),
    listPublishedCollections(),
    listPublishedVideoPages(Number.MAX_SAFE_INTEGER),
    listPublicLearningGuides(),
    listPublishedPlaylistPages(1000),
  ]);

  const staticEntries: MetadataRoute.Sitemap = [
    { url: `${SITE_ORIGIN}/`, lastModified: new Date() },
    { url: `${SITE_ORIGIN}/archive`, lastModified: new Date() },
    { url: `${SITE_ORIGIN}/videos`, lastModified: new Date() },
    { url: `${SITE_ORIGIN}/collections`, lastModified: new Date() },
    { url: `${SITE_ORIGIN}/learning`, lastModified: new Date() },
  ];

  return [
    ...staticEntries,
    ...composers.map((c) => ({ url: `${SITE_ORIGIN}/composers/${c.slug}`, lastModified: c.updatedAt })),
    ...artists.map((a) => ({ url: `${SITE_ORIGIN}/artists/${a.slug}`, lastModified: a.updatedAt })),
    ...choirs.map((c) => ({ url: `${SITE_ORIGIN}/choirs/${c.slug}`, lastModified: c.updatedAt })),
    ...conductors.map((c) => ({ url: `${SITE_ORIGIN}/conductors/${c.slug}`, lastModified: c.updatedAt })),
    ...venues.map((v) => ({ url: `${SITE_ORIGIN}/venues/${v.slug}`, lastModified: v.updatedAt })),
    ...organisations.map((o) => ({ url: `${SITE_ORIGIN}/organisations/${o.slug}`, lastModified: o.updatedAt })),
    ...works.map((w) => ({ url: `${SITE_ORIGIN}/works/${w.slug}`, lastModified: w.updatedAt })),
    ...programmes.map((p) => ({ url: `${SITE_ORIGIN}/programmes/${p.slug}`, lastModified: p.updatedAt })),
    ...performances.map((p) => ({ url: `${SITE_ORIGIN}/performances/${p.slug}`, lastModified: p.updatedAt })),
    ...recordings.map((r) => ({ url: `${SITE_ORIGIN}/recordings/${r.slug}`, lastModified: r.updatedAt })),
    ...collections.map((c) => ({ url: `${SITE_ORIGIN}/collections/${c.slug}`, lastModified: c.updatedAt })),
    ...videoPages.map(({ page }) => ({ url: `${SITE_ORIGIN}/videos/${page.slug}`, lastModified: page.updatedAt })),
    ...learningGuides.map((g) => ({ url: `${SITE_ORIGIN}/learning/${g.slug}`, lastModified: g.updatedAt })),
    ...(playlistPages.length > 0 ? [{ url: `${SITE_ORIGIN}/playlists`, lastModified: new Date() }] : []),
    // The time the current published version went live — never the time of the last draft edit.
    ...playlistPages.map((p) => ({ url: `${SITE_ORIGIN}/playlists/${p.slug}`, lastModified: p.lastModified })),
  ];
}
