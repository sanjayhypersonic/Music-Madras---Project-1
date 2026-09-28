import type { MetadataRoute } from "next";
import { listActiveComposers } from "../modules/db/repositories/composerRepository";
import { listActiveArtists } from "../modules/db/repositories/artistRepository";
import { listActiveChoirs } from "../modules/db/repositories/choirRepository";
import { listActiveConductors } from "../modules/db/repositories/conductorRepository";
import { listActiveVenues } from "../modules/db/repositories/venueRepository";
import { listActiveOrganisations } from "../modules/db/repositories/organisationRepository";
import { listPublishedCollections } from "../modules/db/repositories/collectionRepository";
import { listPublishedVideoPages } from "../modules/db/repositories/youtubeVideoPageRepository";
import {
  listPublicPerformanceSitemapEntries,
  listPublicProgrammeSitemapEntries,
  listPublicRecordingSitemapEntries,
  listPublicWorkSitemapEntries,
} from "../modules/db/repositories/sitemapRepository";

// Phase 6G-11 — the canonical, database-driven sitemap for the public
// Museum. No second visibility system: every entity list here is either
// an existing public-visibility repository function (listActive*,
// listPublishedCollections, listPublishedVideoPages) or a new function in
// sitemapRepository.ts that copies its where-clause verbatim from
// archiveSearchRepository.ts. Studio, API routes, drafts, archived
// content, and /archive query-string states are never included — the
// canonical bare entity URL is the only one ever listed.

const SITE_ORIGIN = process.env.AUTH_URL ?? "http://localhost:3000";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
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
  ] = await Promise.all([
    listActiveComposers(),
    listActiveArtists(),
    listActiveChoirs(),
    listActiveConductors(),
    listActiveVenues(),
    listActiveOrganisations(),
    listPublicWorkSitemapEntries(),
    listPublicProgrammeSitemapEntries(),
    listPublicPerformanceSitemapEntries(),
    listPublicRecordingSitemapEntries(),
    listPublishedCollections(),
    listPublishedVideoPages(Number.MAX_SAFE_INTEGER),
  ]);

  const staticEntries: MetadataRoute.Sitemap = [
    { url: `${SITE_ORIGIN}/`, lastModified: new Date() },
    { url: `${SITE_ORIGIN}/archive`, lastModified: new Date() },
    { url: `${SITE_ORIGIN}/collections`, lastModified: new Date() },
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
  ];
}
