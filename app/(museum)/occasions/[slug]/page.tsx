import { getSiteOrigin } from "../../../../modules/config/siteOrigin";
import { serializeJsonLd } from "../../../../modules/seo/serializeJsonLd";
import type { Metadata } from "next";
import { after } from "next/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getPublicOccasionPageData } from "../../../../modules/db/repositories/occasionPageRepository";
import { EntityBreadcrumbs } from "../../../../components/museum/entity/EntityBreadcrumbs";
import { EntityHeader } from "../../../../components/museum/entity/EntityHeader";
import { EntitySection } from "../../../../components/museum/entity/EntitySection";
import { trackPublicPageView } from "../../../../modules/analytics/trackPublicPageView";
import { createEntityViewEvent } from "../../../../modules/analytics/events/factories";

// The public /occasions/[slug] page: what the archive holds for one Occasion (a service, a festival, a season). Built from getPublicOccasionPageData,
// which returns null (a 404) unless the Occasion is active and something PUBLIC is attached to it, so the page is never empty and never reveals a
// draft. No Prisma import here, like every other entity page. Sections that have nothing to show are left out rather than rendered as empty states:
// an Occasion page exists only because it has content.

const SITE_ORIGIN = getSiteOrigin();

function formatPerformanceDate(date: Date | null): string | null {
  return date ? date.toLocaleDateString("en-GB", { year: "numeric", month: "long", day: "numeric" }) : null;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const occasion = await getPublicOccasionPageData(slug);
  if (!occasion) return {};

  const description = occasion.description ?? `${occasion.name} — performances, recordings and collections in the Music Madras archive of Chennai's Western Classical Music heritage.`;
  const title = `${occasion.name} — Music Madras`;
  const canonicalPath = `/occasions/${occasion.slug}`;

  return {
    metadataBase: new URL(SITE_ORIGIN),
    title,
    description,
    alternates: { canonical: canonicalPath },
    openGraph: { title, description, url: canonicalPath, type: "website" },
  };
}

export default async function OccasionPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const occasion = await getPublicOccasionPageData(slug);
  if (!occasion) notFound();

  after(() => trackPublicPageView({ path: `/occasions/${occasion.slug}` }, createEntityViewEvent({ entityType: "Occasion", entityId: occasion.id })));

  return (
    <article>
      <EntityBreadcrumbs items={[{ label: "Music Madras", href: "/" }, { label: "Archive", href: "/archive" }, { label: "Occasions" }, { label: occasion.name }]} />

      <EntityHeader eyebrow="Occasion" name={occasion.name} subtitle={null} description={occasion.description} />

      {occasion.recordings.length > 0 && (
        <EntitySection id="recordings" heading="Recordings">
          <ul className="museum-related-list">
            {occasion.recordings.map((recording) => (
              <li key={recording.id}>
                <Link href={`/recordings/${recording.slug}`}>{recording.title ?? "Untitled recording"}</Link>
              </li>
            ))}
          </ul>
        </EntitySection>
      )}

      {occasion.performances.length > 0 && (
        <EntitySection id="performances" heading="Performances">
          <ul className="museum-related-list">
            {occasion.performances.map((performance) => (
              <li key={performance.id}>
                <Link href={`/performances/${performance.slug}`}>{formatPerformanceDate(performance.performanceDate) ?? "Date unknown"}</Link>
                {" — "}
                <Link href={`/venues/${performance.venueSlug}`}>{performance.venueName}</Link>
                {" · "}
                {performance.programmeTitle}
              </li>
            ))}
          </ul>
        </EntitySection>
      )}

      {occasion.programmes.length > 0 && (
        <EntitySection id="programmes" heading="Programmes">
          <ul className="museum-related-list">
            {occasion.programmes.map((programme) => (
              <li key={programme.id}>
                <Link href={`/programmes/${programme.slug}`}>{programme.title}</Link>
              </li>
            ))}
          </ul>
        </EntitySection>
      )}

      {occasion.collections.length > 0 && (
        <EntitySection id="collections" heading="Collections">
          <ul className="museum-category-grid">
            {occasion.collections.map((c) => (
              <li key={c.id} className="museum-category-card">
                <h3>
                  <Link href={`/collections/${c.slug}`}>{c.title}</Link>
                </h3>
              </li>
            ))}
          </ul>
        </EntitySection>
      )}

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: serializeJsonLd({
            "@context": "https://schema.org",
            "@type": "CollectionPage",
            name: occasion.name,
            url: `${SITE_ORIGIN}/occasions/${occasion.slug}`,
            ...(occasion.description ? { description: occasion.description } : {}),
          }),
        }}
      />
    </article>
  );
}
