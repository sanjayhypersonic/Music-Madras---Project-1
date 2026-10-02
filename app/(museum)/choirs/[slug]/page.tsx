import { getSiteOrigin } from "../../../../modules/config/siteOrigin";
import { serializeJsonLd } from "../../../../modules/seo/serializeJsonLd";
import type { Metadata } from "next";
import { after } from "next/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getChoirEntityPageData } from "../../../../modules/db/repositories/entityRelationshipsRepository";
import { EntityBreadcrumbs } from "../../../../components/museum/entity/EntityBreadcrumbs";
import { EntityHeader } from "../../../../components/museum/entity/EntityHeader";
import { EntitySection } from "../../../../components/museum/entity/EntitySection";
import { EntityEmptyState } from "../../../../components/museum/entity/EntityEmptyState";
import { RecordingCard } from "../../../../components/museum/RecordingCard";
import { trackPublicPageView } from "../../../../modules/analytics/trackPublicPageView";
import { createEntityViewEvent } from "../../../../modules/analytics/events/factories";

// Phase 6G-9 — the public /choirs/[slug] page. Reuses the generic
// EntityPageData contract exactly like Composer/Venue/Artist via
// getChoirEntityPageData — no Prisma import here.

const SITE_ORIGIN = getSiteOrigin();

function formatPerformanceDate(date: Date | null): string | null {
  return date ? date.toLocaleDateString("en-GB", { year: "numeric", month: "long", day: "numeric" }) : null;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const choir = await getChoirEntityPageData(slug);
  if (!choir) return {};

  const description =
    choir.description ??
    `${choir.name} — a choir documented in the Music Madras archive of Chennai's Western Classical Music heritage.`;
  const title = `${choir.name} — Music Madras`;

  return {
    metadataBase: new URL(SITE_ORIGIN),
    title,
    description,
    alternates: { canonical: `/choirs/${choir.slug}` },
    openGraph: { title, description, type: "profile" },
  };
}

export default async function ChoirPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const choir = await getChoirEntityPageData(slug);
  if (!choir) {
    notFound();
  }

  after(() =>
    trackPublicPageView({ path: `/choirs/${choir.slug}` }, createEntityViewEvent({ entityType: "Choir", entityId: choir.id }))
  );

  const subtitle = choir.secondaryDetail ? `Directed by ${choir.secondaryDetail}` : null;

  return (
    <article>
      <EntityBreadcrumbs
        items={[
          { label: "Music Madras", href: "/" },
          { label: "Archive", href: "/archive" },
          { label: "Choirs" },
          { label: choir.name },
        ]}
      />

      <EntityHeader eyebrow="Choir" name={choir.name} subtitle={subtitle} description={choir.description} />

      <EntitySection id="programmes" heading="Programmes">
        {choir.relatedProgrammes.length > 0 ? (
          <ul className="museum-related-list">
            {choir.relatedProgrammes.map((programme) => (
              <li key={programme.id}>
                <Link href={`/programmes/${programme.slug}`}>{programme.title}</Link>
              </li>
            ))}
          </ul>
        ) : (
          <EntityEmptyState>No programmes featuring this choir have been catalogued yet.</EntityEmptyState>
        )}
      </EntitySection>

      <EntitySection id="performances" heading="Performances">
        {choir.relatedPerformances.length > 0 ? (
          <ul className="museum-related-list">
            {choir.relatedPerformances.map((performance) => {
              const participants = [
                ...performance.conductors.map((c) => ({ ...c, href: `/conductors/${c.slug}` })),
                ...performance.choirs.filter((c) => c.slug !== choir.slug).map((c) => ({ ...c, href: `/choirs/${c.slug}` })),
                ...performance.artists.map((a) => ({ ...a, href: `/artists/${a.slug}` })),
              ];
              return (
                <li key={performance.id}>
                  <Link href={`/performances/${performance.slug}`}>
                    {formatPerformanceDate(performance.performanceDate) ?? "Date unknown"}
                  </Link>
                  {performance.venueName && (
                    <>
                      {" — "}
                      {performance.venueSlug ? (
                        <Link href={`/venues/${performance.venueSlug}`}>{performance.venueName}</Link>
                      ) : (
                        performance.venueName
                      )}
                    </>
                  )}
                  {participants.length > 0 && (
                    <span className="museum-performance-participants">
                      {" · "}
                      {participants.map((person, index) => (
                        <span key={person.slug}>
                          {index > 0 && ", "}
                          <Link href={person.href}>{person.name}</Link>
                        </span>
                      ))}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <EntityEmptyState>No performances have been catalogued for this choir yet.</EntityEmptyState>
        )}
      </EntitySection>

      <EntitySection id="recordings" heading="Recordings">
        {choir.relatedRecordings.length > 0 ? (
          <ul className="museum-related-list">
            {choir.relatedRecordings.map((recording) => (
              <li key={recording.id}>
                <Link href={`/recordings/${recording.slug}`}>{recording.title ?? "Untitled recording"}</Link>
              </li>
            ))}
          </ul>
        ) : (
          <EntityEmptyState>No recordings have been published for this choir yet.</EntityEmptyState>
        )}
      </EntitySection>

      <p className="museum-group-heading">Music Madras Media</p>

      <EntitySection
        id="discover"
        heading="Music Madras Videos"
        intro="Recordings from the Music Madras archive."
      >
        {choir.relatedVideos.length > 0 ? (
          <ul className="museum-recording-grid">
            {choir.relatedVideos.map((video) => (
              <li key={video.slug}>
                <RecordingCard page={{ slug: video.slug }} video={{ title: video.title, thumbnailUrl: video.thumbnailUrl }} />
              </li>
            ))}
          </ul>
        ) : (
          <EntityEmptyState>No recordings featuring this choir have been published to the public archive yet.</EntityEmptyState>
        )}
      </EntitySection>

      {choir.relatedCollections.length > 0 && (
        <EntitySection id="collections" heading="Collections">
          <ul className="museum-category-grid">
            {choir.relatedCollections.map((c) => (
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
            "@type": "MusicGroup",
            name: choir.name,
            url: `${SITE_ORIGIN}/choirs/${choir.slug}`,
          }),
        }}
      />
    </article>
  );
}
