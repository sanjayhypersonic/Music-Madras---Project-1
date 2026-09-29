import type { Metadata } from "next";
import { after } from "next/server";
import Link from "next/link";
import { listPublicLearningGuidesPage } from "../../../modules/db/repositories/learningGuideRepository";
import { EntityBreadcrumbs } from "../../../components/museum/entity/EntityBreadcrumbs";
import { EntitySection } from "../../../components/museum/entity/EntitySection";
import { EntityEmptyState } from "../../../components/museum/entity/EntityEmptyState";
import { trackPublicPageView } from "../../../modules/analytics/trackPublicPageView";

// Phase 6G-17 — the public /learning index, mirroring /collections
// exactly: a simple, published-only, non-archived, paginated browse
// listing. Deliberately NOT the /archive search system (brief: "do not
// turn the page into a generic blog feed") — no query parameter, no
// full-text matching. Server-rendered, using listPublicLearningGuidesPage
// — the same status === "PUBLISHED" && archivedAt === null predicate
// every other public LearningGuide read already uses.

const SITE_ORIGIN = process.env.AUTH_URL ?? "http://localhost:3000";

interface LearningIndexSearchParams {
  page?: string;
}

function parsePage(raw: string | undefined): number {
  const parsed = raw ? parseInt(raw, 10) : 1;
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 1;
}

function buildLearningHref(page: number): string {
  return page > 1 ? `/learning?page=${page}` : "/learning";
}

export async function generateMetadata(): Promise<Metadata> {
  const title = "Learning Guides — Music Madras";
  const description =
    "Structured educational guides connecting Musical Works and Recordings from the Music Madras archive of Chennai's Western Classical Music heritage.";

  return {
    metadataBase: new URL(SITE_ORIGIN),
    title,
    description,
    alternates: { canonical: "/learning" },
    openGraph: { title, description, url: "/learning", type: "website" },
  };
}

export default async function LearningIndexPage({ searchParams }: { searchParams: Promise<LearningIndexSearchParams> }) {
  const { page: rawPage } = await searchParams;
  const requestedPage = parsePage(rawPage);
  const result = await listPublicLearningGuidesPage(requestedPage);
  const totalPages = Math.max(1, Math.ceil(result.total / result.pageSize));

  after(() => trackPublicPageView({ path: "/learning" }));

  return (
    <article>
      <EntityBreadcrumbs items={[{ label: "Music Madras", href: "/" }, { label: "Learning Guides" }]} />

      <header className="museum-entity-header">
        <p className="museum-eyebrow">Learning</p>
        <h1>MusicMadras Learning Guides</h1>
        <p className="museum-entity-header__description">
          Structured educational guides connecting Musical Works and Recordings in the archive — every guide is
          written editorially in Studio, never generated automatically.
        </p>
      </header>

      <EntitySection id="guides" heading="Browse Learning Guides">
        {result.total === 0 ? (
          <EntityEmptyState>No learning guides have been published yet.</EntityEmptyState>
        ) : (
          <>
            <p className="museum-meta">
              {result.total} guide{result.total === 1 ? "" : "s"}
            </p>
            <ul className="museum-category-grid">
              {result.items.map((guide) => (
                <li key={guide.id} className="museum-category-card">
                  <h3>
                    <Link href={`/learning/${guide.slug}`}>{guide.title}</Link>
                  </h3>
                  {guide.excerpt && <p>{guide.excerpt}</p>}
                  {(guide.difficultyLevel || guide.estimatedReadingTimeMinutes) && (
                    <p className="museum-meta">
                      {guide.difficultyLevel ?? ""}
                      {guide.difficultyLevel && guide.estimatedReadingTimeMinutes ? " · " : ""}
                      {guide.estimatedReadingTimeMinutes ? `${guide.estimatedReadingTimeMinutes} min read` : ""}
                    </p>
                  )}
                </li>
              ))}
            </ul>
            {totalPages > 1 && (
              <nav className="museum-pagination" aria-label="Learning guides pages">
                {result.page > 1 ? (
                  <Link href={buildLearningHref(result.page - 1)} className="museum-button">
                    ← Previous
                  </Link>
                ) : (
                  <span />
                )}
                <span className="museum-pagination__status">
                  Page {result.page} of {totalPages}
                </span>
                {result.page < totalPages ? (
                  <Link href={buildLearningHref(result.page + 1)} className="museum-button">
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
            name: "Music Madras Learning Guides",
            description:
              "Structured educational guides connecting Musical Works and Recordings from the Music Madras archive of Chennai's Western Classical Music heritage.",
            url: `${SITE_ORIGIN}/learning`,
          }),
        }}
      />
    </article>
  );
}
