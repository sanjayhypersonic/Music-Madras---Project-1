import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { after } from "next/server";
import Link from "next/link";
import { getSiteOrigin } from "../../../modules/config/siteOrigin";
import { serializeJsonLd } from "../../../modules/seo/serializeJsonLd";
import { trackPublicPageView } from "../../../modules/analytics/trackPublicPageView";
import { loadResolvedSettings } from "../../../modules/db/repositories/siteSettingRepository";
import { getPublishedEditorialBlock } from "../../../modules/db/repositories/editorialContentRepository";
import { normaliseVideoSearch, normaliseVideoSort, searchPublicVideoCatalogue, type VideoCatalogueSort } from "../../../modules/db/repositories/videoCatalogueRepository";
import { parseArchivePage } from "../../../modules/mmke/archiveSearch/archiveUrlState";
import { EditorialBlockBody } from "../../../components/museum/EditorialBlockBody";
import { RecordingCard } from "../../../components/museum/RecordingCard";
import { EntityBreadcrumbs } from "../../../components/museum/entity/EntityBreadcrumbs";
import { EntityEmptyState } from "../../../components/museum/entity/EntityEmptyState";

// Phase 6K-3 — the public Videos catalogue: every video the Museum may LIST (the DISCOVERY surface of the shared exposure rule), paginated and
// searchable, newest or most viewed first. Server-rendered and URL-addressable. Page size comes from settings; the introduction is an
// editorial block (published snapshot only); nothing here decides visibility — the repository's query does, from the same rule as the homepage,
// sitemap and video pages. SEO: each page number is its own canonical URL; a search or non-default sort is noindex and canonicalises to /videos.

export const dynamic = "force-dynamic";

const SITE_ORIGIN = getSiteOrigin();
const INTRO_BLOCK = "museum-videos-intro";

interface VideosSearchParams {
  q?: string;
  sort?: string;
  page?: string;
}

function hrefFor(params: { q?: string; sort?: VideoCatalogueSort; page?: number }): string {
  const search = new URLSearchParams();
  if (params.q) search.set("q", params.q);
  if (params.sort && params.sort !== "newest") search.set("sort", params.sort);
  if (params.page && params.page > 1) search.set("page", String(params.page));
  const qs = search.toString();
  return qs ? `/videos?${qs}` : "/videos";
}

export async function generateMetadata({ searchParams }: { searchParams: Promise<VideosSearchParams> }): Promise<Metadata> {
  const { q, sort, page } = await searchParams;
  const query = normaliseVideoSearch(q);
  const variant = Boolean(query) || normaliseVideoSort(sort) !== "newest";
  const pageNumber = parseArchivePage(page);
  const title = pageNumber > 1 && !variant ? `Videos (page ${pageNumber}) — Music Madras` : "Videos — Music Madras";
  const intro = await getPublishedEditorialBlock(INTRO_BLOCK);
  const description = intro?.seoDescription ?? undefined;
  return {
    metadataBase: new URL(SITE_ORIGIN),
    title,
    ...(description ? { description } : {}),
    alternates: { canonical: variant ? "/videos" : hrefFor({ page: pageNumber }) },
    robots: variant ? { index: false, follow: true } : { index: true, follow: true },
  };
}

export default async function VideosPage({ searchParams }: { searchParams: Promise<VideosSearchParams> }) {
  const raw = await searchParams;
  const query = normaliseVideoSearch(raw.q);
  const sort = normaliseVideoSort(raw.sort);
  const requestedPage = parseArchivePage(raw.page);

  const [settings, intro] = await Promise.all([loadResolvedSettings(), getPublishedEditorialBlock(INTRO_BLOCK)]);
  const result = await searchPublicVideoCatalogue({ q: query, sort, page: requestedPage, pageSize: settings.get("catalogue.videos.pageSize") });
  if (result.total > 0 && requestedPage > result.totalPages) notFound();

  after(() => trackPublicPageView({ path: "/videos" }));

  return (
    <article>
      <EntityBreadcrumbs items={[{ label: "Music Madras", href: "/" }, { label: "Videos" }]} />
      <header className="museum-entity-header">
        <p className="museum-eyebrow">Videos</p>
        <h1>{query ? `Videos matching “${query}”` : "Videos"}</h1>
        {intro && !query && (
          <div className="museum-entity-header__description">
            <EditorialBlockBody body={intro.body} headingOffset={1} />
          </div>
        )}
      </header>

      <form method="get" action="/videos" className="museum-search-form" role="search">
        <label htmlFor="video-search-input" className="museum-visually-hidden">
          Search videos
        </label>
        <input id="video-search-input" className="museum-search-input" type="search" name="q" defaultValue={query ?? ""} maxLength={100} placeholder="Search video titles and descriptions" />
        {sort !== "newest" && <input type="hidden" name="sort" value={sort} />}
        <button type="submit" className="museum-button">
          Search
        </button>
        {query && (
          <Link href={hrefFor({ sort })} className="museum-button">
            Clear
          </Link>
        )}
      </form>

      <ul className="museum-filter-pills" aria-label="Order">
        {(
          [
            ["newest", "Newest"],
            ["mostViewed", "Most viewed"],
          ] as const
        ).map(([value, label]) => (
          <li key={value}>
            <Link href={hrefFor({ q: query, sort: value })} className={sort === value ? "museum-filter-pill--active" : ""} aria-current={sort === value ? "true" : undefined}>
              {label}
            </Link>
          </li>
        ))}
      </ul>

      {result.total === 0 ? (
        <EntityEmptyState>{query ? `No videos match “${query}”.` : "No videos have been published to the Museum yet."}</EntityEmptyState>
      ) : (
        <>
          <p className="museum-meta">
            {result.total} {result.total === 1 ? "video" : "videos"}
            {query ? ` matching “${query}”` : ""}
          </p>
          <ul className="museum-recording-grid">
            {result.items.map(({ page, youtubeVideo }) => (
              <li key={page.id}>
                <RecordingCard page={page} video={youtubeVideo} />
              </li>
            ))}
          </ul>
          {result.totalPages > 1 && (
            <nav className="museum-pagination" aria-label="Video pages">
              {result.page > 1 ? (
                <Link href={hrefFor({ q: query, sort, page: result.page - 1 })} className="museum-button" rel="prev">
                  ← Previous
                </Link>
              ) : (
                <span />
              )}
              <span className="museum-pagination__status">
                Page {result.page} of {result.totalPages}
              </span>
              {result.page < result.totalPages ? (
                <Link href={hrefFor({ q: query, sort, page: result.page + 1 })} className="museum-button" rel="next">
                  Next →
                </Link>
              ) : (
                <span />
              )}
            </nav>
          )}
        </>
      )}

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd({ "@context": "https://schema.org", "@type": "CollectionPage", name: "Music Madras Videos", url: `${SITE_ORIGIN}/videos` }) }}
      />
    </article>
  );
}
