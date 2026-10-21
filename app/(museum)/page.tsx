import { getSiteOrigin } from "../../modules/config/siteOrigin";
import type { Metadata } from "next";
import { after } from "next/server";
import Image from "next/image";
import Link from "next/link";
import { getHomepageFeatured } from "../../modules/db/repositories/featuredVideoRepository";
import { resolveEditorialBlocks } from "../../modules/db/repositories/editorialContentRepository";
import { listPublishedCollections } from "../../modules/db/repositories/collectionRepository";
import { ARCHIVE_CATEGORIES, CONTINUE_EXPLORING_LINKS } from "../../modules/mmke/homepage/archiveCategories";
import { RecordingCard } from "../../components/museum/RecordingCard";
import { EditorialBlockBody } from "../../components/museum/EditorialBlockBody";
import { trackPublicPageView } from "../../modules/analytics/trackPublicPageView";

// Phase 6G-3 — the real Museum homepage. "Archive at the foundation,
// discovery at the surface": every fact rendered here comes from MMKE
// repositories, never from a hardcoded array or the legacy GAIS prototype.
// Server Component — no client-side data fetching.
//
// Phase 6K-3 — the words on this page are editorial blocks (published snapshots, with the transitional built-in wording only until a block
// is first published), the featured videos come from the shared exposure rule via the hybrid pinned + automatic selection (the number of
// slots and the ranking are settings), and nothing visibility-related is decided here. What remains in this file is structure: section
// headings that name real routes, and brand/UI labels (listed in the exception register).

const SITE_ORIGIN = getSiteOrigin();
const HOME_BLOCKS = ["museum-home-intro", "museum-home-story", "museum-site-seo"] as const;

// Plain dynamic SSR, matching /videos/[slug] (no generateStaticParams, no
// revalidate, no ISR): a newly published video or collection must
// appear without requiring a redeploy, so this is never statically cached
// at build time despite having no per-request input of its own.
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const seo = (await resolveEditorialBlocks(["museum-site-seo"])).get("museum-site-seo");
  return {
    metadataBase: new URL(SITE_ORIGIN),
    ...(seo?.seoTitle ? { title: seo.seoTitle } : {}),
    ...(seo?.seoDescription ? { description: seo.seoDescription } : {}),
    alternates: { canonical: "/" },
    openGraph: {
      ...(seo?.seoTitle ? { title: seo.seoTitle } : {}),
      ...(seo?.seoDescription ? { description: seo.seoDescription } : {}),
      type: "website",
    },
  };
}

export default async function MuseumHomePage() {
  const [featured, collections, blocks] = await Promise.all([getHomepageFeatured(), listPublishedCollections(), resolveEditorialBlocks(HOME_BLOCKS)]);
  const intro = blocks.get("museum-home-intro");
  const story = blocks.get("museum-home-story");

  after(() => trackPublicPageView({ path: "/" }));

  return (
    <>
      <section className="museum-hero" aria-labelledby="hero-heading">
        <Image
          src="/music-madras-logo.webp"
          alt="Music Madras — Live Classical Concerts, Chennai"
          width={104}
          height={104}
          className="museum-hero__logo"
          priority
        />
        <p className="museum-eyebrow">The Music Madras Archive</p>
        <h1 id="hero-heading">{intro?.title ?? "Music Madras"}</h1>
        {intro?.body && (
          <div className="museum-hero__lede">
            <EditorialBlockBody body={intro.body} headingOffset={1} />
          </div>
        )}
        <Link href="/archive" className="museum-button">
          Explore the Archive
        </Link>
      </section>

      <section id="archive" className="museum-section" aria-labelledby="archive-heading">
        <h2 id="archive-heading">Explore the Archive</h2>
        <p className="museum-section__intro">
          Music Madras connects the people, works and places behind every performance. Explore any category
          below, or search the full archive.
        </p>
        <ul className="museum-category-grid">
          {ARCHIVE_CATEGORIES.map((category) => (
            <li key={category.key} className="museum-category-card">
              <Link href={category.href}>
                <h3>{category.label}</h3>
                <p>{category.description}</p>
              </Link>
            </li>
          ))}
        </ul>
        <p>
          <Link href="/archive" className="museum-button">
            Search the full archive →
          </Link>
        </p>
      </section>

      <section id="discover" className="museum-section" aria-labelledby="discover-heading">
        <h2 id="discover-heading">Featured videos</h2>
        {featured.length > 0 ? (
          <ul className="museum-recording-grid">
            {featured.map(({ page, youtubeVideo }) => (
              <li key={page.id}>
                <RecordingCard page={page} video={youtubeVideo} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="museum-empty-state">No videos have been published to the Museum yet.</p>
        )}
        <p>
          <Link href="/videos" className="museum-button">
            Browse all videos →
          </Link>
        </p>
      </section>

      {collections.length > 0 && (
        <section id="collections" className="museum-section" aria-labelledby="collections-heading">
          <h2 id="collections-heading">Collections</h2>
          <p className="museum-section__intro">Curated groupings of recordings and works from across the archive.</p>
          <ul className="museum-category-grid">
            {collections.map((collection) => (
              <li key={collection.id} className="museum-category-card">
                <Link href={`/collections/${collection.slug}`}>
                  <h3>{collection.title}</h3>
                  {collection.description && <p>{collection.description}</p>}
                </Link>
              </li>
            ))}
          </ul>
          <p>
            <Link href="/collections" className="museum-button">
              Browse all collections →
            </Link>
          </p>
        </section>
      )}

      {story && (
        <section id="story" className="museum-section" aria-labelledby="story-heading">
          <h2 id="story-heading">{story.title}</h2>
          <EditorialBlockBody body={story.body} headingOffset={1} />
        </section>
      )}

      <section className="museum-section" aria-labelledby="continue-heading">
        <h2 id="continue-heading">Continue Exploring</h2>
        <ul className="museum-pathways">
          {CONTINUE_EXPLORING_LINKS.map((link) => (
            <li key={link.label}>
              <Link href={link.href}>{link.label}</Link>
            </li>
          ))}
        </ul>
        <Link href="/videos" className="museum-button">
          Browse all videos
        </Link>
      </section>
    </>
  );
}
