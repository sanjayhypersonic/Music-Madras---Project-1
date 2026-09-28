import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getVenueEntityPageData } from "../../../../modules/db/repositories/entityRelationshipsRepository";
import type { EntityPageData } from "../../../../modules/mmke/entityPage/entityPageContract";
import { EntityBreadcrumbs } from "../../../../components/museum/entity/EntityBreadcrumbs";
import { EntityHeader } from "../../../../components/museum/entity/EntityHeader";
import { EntitySection } from "../../../../components/museum/entity/EntitySection";
import { EntityEmptyState } from "../../../../components/museum/entity/EntityEmptyState";
import { RecordingCard } from "../../../../components/museum/RecordingCard";

// Phase 6G-6 — the public /venues/[slug] page, wiring up
// getVenueEntityPageData (Phase 6G-4A, previously unwired to any route)
// exactly as it already was — no changes to its relationship resolution,
// only new fields it now also returns (venueDetails, relatedComposers,
// and works-performed-here via the existing relatedWorks slot).

const SITE_ORIGIN = process.env.AUTH_URL ?? "http://localhost:3000";

function formatPerformanceDate(date: Date | null): string | null {
  return date ? date.toLocaleDateString("en-GB", { year: "numeric", month: "long", day: "numeric" }) : null;
}

function formatLocation(venue: EntityPageData): string | null {
  const parts = [venue.venueDetails?.address, venue.venueDetails?.city, venue.venueDetails?.country].filter(
    (part): part is string => Boolean(part)
  );
  return parts.length > 0 ? parts.join(", ") : null;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const venue = await getVenueEntityPageData(slug);
  if (!venue) return {};

  const location = formatLocation(venue);
  const description = location
    ? `${venue.name}, ${location} — documented in the Music Madras archive of Chennai's Western Classical Music heritage.`
    : `${venue.name} — documented in the Music Madras archive of Chennai's Western Classical Music heritage.`;
  const title = `${venue.name} — Music Madras`;

  return {
    metadataBase: new URL(SITE_ORIGIN),
    title,
    description,
    alternates: { canonical: `/venues/${venue.slug}` },
    openGraph: { title, description, type: "website" },
  };
}

export default async function VenuePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const venue = await getVenueEntityPageData(slug);
  if (!venue) {
    notFound();
  }

  const location = formatLocation(venue);
  const subtitleParts = [venue.venueDetails?.type, location].filter((part): part is string => Boolean(part));
  const subtitle = subtitleParts.length > 0 ? subtitleParts.join(" — ") : null;

  return (
    <article>
      <EntityBreadcrumbs
        items={[
          { label: "Music Madras", href: "/" },
          { label: "Archive", href: "/archive" },
          { label: "Venues" },
          { label: venue.name },
        ]}
      />

      <EntityHeader eyebrow="Venue" name={venue.name} subtitle={subtitle} description={venue.description} />

      {venue.venueDetails?.organisation && (
        <EntitySection id="organisation" heading="Operated By">
          <p className="museum-meta">
            <Link href={`/organisations/${venue.venueDetails.organisation.slug}`}>{venue.venueDetails.organisation.name}</Link>
          </p>
        </EntitySection>
      )}

      <EntitySection id="works" heading="Musical Works Performed Here">
        {venue.relatedWorks && venue.relatedWorks.length > 0 ? (
          <ul className="museum-related-list">
            {venue.relatedWorks.map((work) => (
              <li key={work.id}>
                <Link href={`/works/${work.slug}`}>{work.title}</Link>
              </li>
            ))}
          </ul>
        ) : (
          <EntityEmptyState>No musical works have been catalogued at this venue yet.</EntityEmptyState>
        )}
      </EntitySection>

      <EntitySection id="performances" heading="Performances">
        {venue.relatedPerformances.length > 0 ? (
          <ul className="museum-related-list">
            {venue.relatedPerformances.map((performance) => {
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
          <EntityEmptyState>No performances have been catalogued at this venue yet.</EntityEmptyState>
        )}
      </EntitySection>

      <EntitySection id="recordings" heading="Recordings">
        {venue.relatedRecordings.length > 0 ? (
          <ul className="museum-related-list">
            {venue.relatedRecordings.map((recording) => (
              <li key={recording.id}>
                <Link href={`/recordings/${recording.slug}`}>{recording.title ?? "Untitled recording"}</Link>
              </li>
            ))}
          </ul>
        ) : (
          <EntityEmptyState>No recordings from this venue have been published yet.</EntityEmptyState>
        )}
      </EntitySection>

      {venue.relatedComposers && venue.relatedComposers.length > 0 && (
        <EntitySection id="composers" heading="Composers Performed Here">
          <ul className="museum-pathways">
            {venue.relatedComposers.map((composer) => (
              <li key={composer.id}>
                <Link href={`/composers/${composer.slug}`}>{composer.name}</Link>
              </li>
            ))}
          </ul>
        </EntitySection>
      )}

      {(venue.relatedParticipants.artists.length > 0 ||
        venue.relatedParticipants.choirs.length > 0 ||
        venue.relatedParticipants.conductors.length > 0) && (
        <EntitySection id="related" heading="Related People">
          <ul className="museum-pathways">
            {venue.relatedParticipants.conductors.map((conductor) => (
              <li key={conductor.slug}>
                <Link href={`/conductors/${conductor.slug}`}>{conductor.name}</Link>
              </li>
            ))}
            {venue.relatedParticipants.choirs.map((choir) => (
              <li key={choir.slug}>
                <Link href={`/choirs/${choir.slug}`}>{choir.name}</Link>
              </li>
            ))}
            {venue.relatedParticipants.artists.map((artist) => (
              <li key={artist.slug}>
                <Link href={`/artists/${artist.slug}`}>{artist.name}</Link>
              </li>
            ))}
          </ul>
        </EntitySection>
      )}

      <p className="museum-group-heading">MusicMadras Media</p>

      <EntitySection
        id="discover"
        heading="MusicMadras Videos"
        intro="Recordings published to the public archive under Music Madras's editorial visibility rules — never raw, unreviewed synchronization data."
      >
        {venue.relatedVideos.length > 0 ? (
          <ul className="museum-recording-grid">
            {venue.relatedVideos.map((video) => (
              <li key={video.slug}>
                <RecordingCard page={{ slug: video.slug }} video={{ title: video.title, thumbnailUrl: video.thumbnailUrl }} />
              </li>
            ))}
          </ul>
        ) : (
          <EntityEmptyState>No recordings from this venue have been published to the public archive yet.</EntityEmptyState>
        )}
      </EntitySection>

      {venue.relatedCollections.length > 0 && (
        <EntitySection id="collections" heading="Collections">
          <ul className="museum-category-grid">
            {venue.relatedCollections.map((c) => (
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
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Place",
            name: venue.name,
            url: `${SITE_ORIGIN}/venues/${venue.slug}`,
            ...(location ? { address: location } : {}),
          }),
        }}
      />
    </article>
  );
}
