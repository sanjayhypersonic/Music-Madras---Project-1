import type { Metadata } from "next";
import { after } from "next/server";
import Image from "next/image";
import Link from "next/link";
import { listPublishedVideoPages } from "../../modules/db/repositories/youtubeVideoPageRepository";
import { listPublishedCollections } from "../../modules/db/repositories/collectionRepository";
import { ARCHIVE_CATEGORIES, CONTINUE_EXPLORING_LINKS } from "../../modules/mmke/homepage/archiveCategories";
import { RecordingCard } from "../../components/museum/RecordingCard";
import { trackPublicPageView } from "../../modules/analytics/trackPublicPageView";

// Phase 6G-3 — the real Museum homepage. "Archive at the foundation,
// discovery at the surface": every fact rendered here comes from MMKE
// repositories (listPublishedVideoPages, listPublishedCollections), never
// from a hardcoded array or the legacy GAIS prototype. Server Component —
// no client-side data fetching, only ThemeToggle (already client) is
// interactive.

const SITE_ORIGIN = process.env.AUTH_URL ?? "http://localhost:3000";
const RECENT_RECORDINGS_LIMIT = 6;

// Plain dynamic SSR, matching /videos/[slug] (no generateStaticParams, no
// revalidate, no ISR): a newly published recording or collection must
// appear without requiring a redeploy, so this is never statically cached
// at build time despite having no per-request input of its own.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_ORIGIN),
  title: "Music Madras — Preserving Chennai's Musical Heritage",
  description:
    "Music Madras is a growing digital archive documenting Chennai's Western Classical Music heritage — its composers, performers, choirs, venues, performances and recordings.",
  alternates: { canonical: "/" },
  openGraph: {
    title: "Music Madras — Preserving Chennai's Musical Heritage",
    description: "A growing digital archive documenting Chennai's Western Classical Music heritage.",
    type: "website",
  },
};

export default async function MuseumHomePage() {
  const [recentRecordings, collections] = await Promise.all([
    listPublishedVideoPages(RECENT_RECORDINGS_LIMIT),
    listPublishedCollections(),
  ]);

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
        <h1 id="hero-heading">Preserving Chennai&rsquo;s Musical Heritage</h1>
        <p className="museum-hero__lede">
          Music Madras documents and preserves Chennai&rsquo;s Western Classical Music tradition — its composers,
          performers, choirs, conductors, venues and recordings — so the city&rsquo;s concert life remains
          discoverable for generations to come.
        </p>
        <Link href="/archive" className="museum-button">
          Explore the Archive
        </Link>
      </section>

      <section id="archive" className="museum-section" aria-labelledby="archive-heading">
        <h2 id="archive-heading">Explore the Archive</h2>
        <p className="museum-section__intro">
          Music Madras is built around a knowledge base connecting the people, works and places behind every
          performance. Explore any category below, or search the full archive.
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
        <h2 id="discover-heading">Discover Music Madras</h2>
        <p className="museum-section__intro">
          Every recording shown here has been published to the public archive under Music Madras&rsquo;s editorial
          visibility rules — never raw, unreviewed synchronization data.
        </p>
        {recentRecordings.length > 0 ? (
          <ul className="museum-recording-grid">
            {recentRecordings.map(({ page, youtubeVideo }) => (
              <li key={page.id}>
                <RecordingCard page={page} video={youtubeVideo} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="museum-empty-state">
            No recordings have been published to the public archive yet. As performances are catalogued and
            approved, they will appear here.
          </p>
        )}
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

      <section id="story" className="museum-section" aria-labelledby="story-heading">
        <h2 id="story-heading">What Music Madras Preserves</h2>
        <p>
          Music Madras exists to document more than a video library. Behind every recording is a performance — a
          programme, a venue, an ensemble, and the people who brought it to life. Over time, the archive will connect
          composers to the musical works they wrote, works to the programmes and performances that featured them, and
          performances to the recordings and places where they took place.
        </p>
        <p>
          Chennai&rsquo;s Western Classical Music tradition has been carried for decades by choirs, ensembles,
          soloists and conductors performing in churches, halls and schools across the city. Music Madras is building
          the record of that tradition — performance by performance, recording by recording.
        </p>
      </section>

      <section className="museum-section" aria-labelledby="continue-heading">
        <h2 id="continue-heading">Continue Exploring</h2>
        <ul className="museum-pathways">
          {CONTINUE_EXPLORING_LINKS.map((link) => (
            <li key={link.label}>
              <Link href={link.href}>{link.label}</Link>
            </li>
          ))}
        </ul>
        <Link href="#discover" className="museum-button">
          See Published Recordings
        </Link>
      </section>
    </>
  );
}
