import { getSiteOrigin } from "../../../../modules/config/siteOrigin";
import { serializeJsonLd } from "../../../../modules/seo/serializeJsonLd";
import type { Metadata } from "next";
import { after } from "next/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getPublicOrganisationPageData } from "../../../../modules/db/repositories/entityRelationshipsRepository";
import { EntityBreadcrumbs } from "../../../../components/museum/entity/EntityBreadcrumbs";
import { EntityHeader } from "../../../../components/museum/entity/EntityHeader";
import { EntitySection } from "../../../../components/museum/entity/EntitySection";
import { EntityEmptyState } from "../../../../components/museum/entity/EntityEmptyState";
import { RecordingCard } from "../../../../components/museum/RecordingCard";
import { trackPublicPageView } from "../../../../modules/analytics/trackPublicPageView";
import { createEntityViewEvent } from "../../../../modules/analytics/events/factories";

// Phase 6G-14 — the public /organisations/[slug] page, completing the
// public Museum layer for the Organisation entity. Built from
// getPublicOrganisationPageData's own Organisation-rooted traversal
// (Organisation -> Venue.organisationId -> Performance -> ...), reusing
// the shared resolveRelatedContent core exactly like every other entity
// page — no Prisma import here. Occasions/Sources/RightsInformation are
// aggregated across this Organisation's own derived content (never a
// direct Organisation-level attachment, which does not exist) and are
// rendered as plain identifying text, never links — no public route for
// any of the three exists.

const SITE_ORIGIN = getSiteOrigin();

function formatPerformanceDate(date: Date | null): string | null {
  return date ? date.toLocaleDateString("en-GB", { year: "numeric", month: "long", day: "numeric" }) : null;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const organisation = await getPublicOrganisationPageData(slug);
  if (!organisation) return {};

  const description =
    organisation.description ??
    `${organisation.name} — documented in the Music Madras archive of Chennai's Western Classical Music heritage.`;
  const title = `${organisation.name} — Music Madras`;
  const canonicalPath = `/organisations/${organisation.slug}`;

  return {
    metadataBase: new URL(SITE_ORIGIN),
    title,
    description,
    alternates: { canonical: canonicalPath },
    openGraph: { title, description, url: canonicalPath, type: "website" },
  };
}

export default async function OrganisationPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const organisation = await getPublicOrganisationPageData(slug);
  if (!organisation) {
    notFound();
  }

  after(() =>
    trackPublicPageView(
      { path: `/organisations/${organisation.slug}` },
      createEntityViewEvent({ entityType: "Organisation", entityId: organisation.id })
    )
  );

  const { artists, choirs, conductors } = organisation.relatedParticipants;
  const relatedPeople = [
    ...conductors.map((c) => ({ ...c, href: `/conductors/${c.slug}` })),
    ...choirs.map((c) => ({ ...c, href: `/choirs/${c.slug}` })),
    ...artists.map((a) => ({ ...a, href: `/artists/${a.slug}` })),
  ];

  return (
    <article>
      <EntityBreadcrumbs
        items={[
          { label: "Music Madras", href: "/" },
          { label: "Archive", href: "/archive" },
          { label: "Organisations" },
          { label: organisation.name },
        ]}
      />

      <EntityHeader eyebrow="Organisation" name={organisation.name} subtitle={null} description={organisation.description} />

      <EntitySection id="venues" heading="Venues">
        {organisation.venues.length > 0 ? (
          <ul className="museum-related-list">
            {organisation.venues.map((venue) => (
              <li key={venue.id}>
                <Link href={`/venues/${venue.slug}`}>{venue.name}</Link>
              </li>
            ))}
          </ul>
        ) : (
          <EntityEmptyState>No venues have been catalogued for this organisation yet.</EntityEmptyState>
        )}
      </EntitySection>

      <EntitySection id="programmes" heading="Programmes">
        {organisation.programmes.length > 0 ? (
          <ul className="museum-related-list">
            {organisation.programmes.map((programme) => (
              <li key={programme.id}>
                <Link href={`/programmes/${programme.slug}`}>{programme.title}</Link>
              </li>
            ))}
          </ul>
        ) : (
          <EntityEmptyState>No programmes have been catalogued for this organisation yet.</EntityEmptyState>
        )}
      </EntitySection>

      <EntitySection id="performances" heading="Performances">
        {organisation.performances.length > 0 ? (
          <ul className="museum-related-list">
            {organisation.performances.map((performance) => {
              const participants = [
                ...performance.conductors.map((c) => ({ ...c, href: `/conductors/${c.slug}` })),
                ...performance.choirs.map((c) => ({ ...c, href: `/choirs/${c.slug}` })),
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
                      {performance.venueSlug ? <Link href={`/venues/${performance.venueSlug}`}>{performance.venueName}</Link> : performance.venueName}
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
          <EntityEmptyState>No performances have been catalogued for this organisation yet.</EntityEmptyState>
        )}
      </EntitySection>

      <EntitySection id="recordings" heading="Recordings">
        {organisation.recordings.length > 0 ? (
          <ul className="museum-related-list">
            {organisation.recordings.map((recording) => (
              <li key={recording.id}>
                <Link href={`/recordings/${recording.slug}`}>{recording.title ?? "Untitled recording"}</Link>
              </li>
            ))}
          </ul>
        ) : (
          <EntityEmptyState>No recordings have been published for this organisation yet.</EntityEmptyState>
        )}
      </EntitySection>

      {relatedPeople.length > 0 && (
        <EntitySection id="related" heading="Related People">
          <ul className="museum-pathways">
            {relatedPeople.map((person) => (
              <li key={person.slug}>
                <Link href={person.href}>{person.name}</Link>
              </li>
            ))}
          </ul>
        </EntitySection>
      )}

      {organisation.occasions.length > 0 && (
        <EntitySection id="occasions" heading="Occasions">
          <ul className="museum-pathways">
            {organisation.occasions.map((occasion) => (
              <li key={occasion.id}>{occasion.name}</li>
            ))}
          </ul>
        </EntitySection>
      )}

      <p className="museum-group-heading">Music Madras Media</p>

      <EntitySection
        id="discover"
        heading="Music Madras Videos"
        intro="Recordings from the Music Madras archive."
      >
        {organisation.videos.length > 0 ? (
          <ul className="museum-recording-grid">
            {organisation.videos.map((video) => (
              <li key={video.slug}>
                <RecordingCard page={{ slug: video.slug }} video={{ title: video.title, thumbnailUrl: video.thumbnailUrl }} />
              </li>
            ))}
          </ul>
        ) : (
          <EntityEmptyState>No recordings from this organisation have been published to the public archive yet.</EntityEmptyState>
        )}
      </EntitySection>

      {organisation.collections.length > 0 && (
        <EntitySection id="collections" heading="Collections">
          <ul className="museum-category-grid">
            {organisation.collections.map((c) => (
              <li key={c.id} className="museum-category-card">
                <h3>
                  <Link href={`/collections/${c.slug}`}>{c.title}</Link>
                </h3>
              </li>
            ))}
          </ul>
        </EntitySection>
      )}

      {organisation.sources.length > 0 && (
        <EntitySection id="sources" heading="Sources">
          <ul className="museum-pathways">
            {organisation.sources.map((source) => (
              <li key={source.id}>{source.title ?? source.url ?? source.publisher ?? "Untitled source"}</li>
            ))}
          </ul>
        </EntitySection>
      )}

      {organisation.rights.length > 0 && (
        <EntitySection id="rights" heading="Rights Information">
          <ul className="museum-pathways">
            {organisation.rights.map((rights) => (
              <li key={rights.id}>{rights.holder ?? rights.licenseType ?? "Untitled rights information"}</li>
            ))}
          </ul>
        </EntitySection>
      )}

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: serializeJsonLd({
            "@context": "https://schema.org",
            "@type": "Organization",
            name: organisation.name,
            url: `${SITE_ORIGIN}/organisations/${organisation.slug}`,
            ...(organisation.description ? { description: organisation.description } : {}),
          }),
        }}
      />
    </article>
  );
}
