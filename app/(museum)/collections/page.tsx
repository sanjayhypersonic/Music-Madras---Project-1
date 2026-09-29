import type { Metadata } from "next";
import { after } from "next/server";
import Link from "next/link";
import { listPublicCollectionsPage } from "../../../modules/db/repositories/collectionRepository";
import { EntityBreadcrumbs } from "../../../components/museum/entity/EntityBreadcrumbs";
import { EntitySection } from "../../../components/museum/entity/EntitySection";
import { EntityEmptyState } from "../../../components/museum/entity/EntityEmptyState";
import { trackPublicPageView } from "../../../modules/analytics/trackPublicPageView";

// Phase 6G-10 — the public /collections index: a simple, published-only,
// non-archived, paginated browse listing. This is deliberately NOT a
// second search system (brief: "do not create a second generic search
// system for Collections") — no query parameter, no full-text matching.
// The existing /archive search continues to cover Composer/Work/
// Recording/Venue/Programme/Performance/Artist/Choir/Conductor only;
// Collection is intentionally excluded from it in this phase. Server-
// rendered, using listPublicCollectionsPage — the same published+
// non-archived predicate every other public Collection read already uses.

const SITE_ORIGIN = process.env.AUTH_URL ?? "http://localhost:3000";

interface CollectionsIndexSearchParams {
  page?: string;
}

function parsePage(raw: string | undefined): number {
  const parsed = raw ? parseInt(raw, 10) : 1;
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 1;
}

function buildCollectionsHref(page: number): string {
  return page > 1 ? `/collections?page=${page}` : "/collections";
}

export async function generateMetadata(): Promise<Metadata> {
  const title = "Collections — Music Madras";
  const description =
    "Browse curated MusicMadras Collections of recordings and musical works from the Music Madras archive of Chennai's Western Classical Music heritage.";

  return {
    metadataBase: new URL(SITE_ORIGIN),
    title,
    description,
    alternates: { canonical: "/collections" },
    openGraph: { title, description, url: "/collections", type: "website" },
  };
}

export default async function CollectionsIndexPage({
  searchParams,
}: {
  searchParams: Promise<CollectionsIndexSearchParams>;
}) {
  const { page: rawPage } = await searchParams;
  const requestedPage = parsePage(rawPage);
  const result = await listPublicCollectionsPage(requestedPage);
  const totalPages = Math.max(1, Math.ceil(result.total / result.pageSize));

  after(() => trackPublicPageView({ path: "/collections" }));

  return (
    <article>
      <EntityBreadcrumbs items={[{ label: "Music Madras", href: "/" }, { label: "Archive", href: "/archive" }, { label: "Collections" }]} />

      <header className="museum-entity-header">
        <p className="museum-eyebrow">Collections</p>
        <h1>MusicMadras Collections</h1>
        <p className="museum-entity-header__description">
          Curated groupings of recordings and musical works from the Music Madras archive — every Collection is
          assembled editorially in Studio, never inferred from YouTube playlists or metadata.
        </p>
      </header>

      <EntitySection id="collections" heading="Browse Collections">
        {result.total === 0 ? (
          <EntityEmptyState>No collections have been published yet.</EntityEmptyState>
        ) : (
          <>
            <p className="museum-meta">
              {result.total} collection{result.total === 1 ? "" : "s"}
            </p>
            <ul className="museum-category-grid">
              {result.items.map((collection) => (
                <li key={collection.id} className="museum-category-card">
                  <h3>
                    <Link href={`/collections/${collection.slug}`}>{collection.title}</Link>
                  </h3>
                  {collection.description && <p>{collection.description}</p>}
                  <p className="museum-meta">
                    {collection.recordingCount} recording{collection.recordingCount === 1 ? "" : "s"}
                    {collection.workCount > 0
                      ? ` · ${collection.workCount} work${collection.workCount === 1 ? "" : "s"}`
                      : ""}
                  </p>
                </li>
              ))}
            </ul>
            {totalPages > 1 && (
              <nav className="museum-pagination" aria-label="Collections pages">
                {result.page > 1 ? (
                  <Link href={buildCollectionsHref(result.page - 1)} className="museum-button">
                    ← Previous
                  </Link>
                ) : (
                  <span />
                )}
                <span className="museum-pagination__status">
                  Page {result.page} of {totalPages}
                </span>
                {result.page < totalPages ? (
                  <Link href={buildCollectionsHref(result.page + 1)} className="museum-button">
                    Next →
                  </Link>
                ) : (
                  <span />
                )}
              </nav>
            )}
          </>
        )}
      </EntitySection>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "CollectionPage",
            name: "Music Madras Collections",
            description:
              "Curated groupings of recordings and musical works from the Music Madras archive of Chennai's Western Classical Music heritage.",
            url: `${SITE_ORIGIN}/collections`,
          }),
        }}
      />
    </article>
  );
}
