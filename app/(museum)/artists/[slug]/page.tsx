import type { Metadata } from "next";
import { after } from "next/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getArtistEntityPageData } from "../../../../modules/db/repositories/entityRelationshipsRepository";
import { EntityBreadcrumbs } from "../../../../components/museum/entity/EntityBreadcrumbs";
import { EntityHeader } from "../../../../components/museum/entity/EntityHeader";
import { EntitySection } from "../../../../components/museum/entity/EntitySection";
import { EntityEmptyState } from "../../../../components/museum/entity/EntityEmptyState";
import { RecordingCard } from "../../../../components/museum/RecordingCard";
import { trackPublicPageView } from "../../../../modules/analytics/trackPublicPageView";
import { createEntityViewEvent } from "../../../../modules/analytics/events/factories";

// Phase 6G-9 — the public /artists/[slug] page, completing the
// participant side of the archive graph. Reuses the generic
// EntityPageData contract exactly like Composer/Venue (getComposerEntityPageData/
// getVenueEntityPageData) via getArtistEntityPageData — no Prisma import
// here, matching every other public entity page's pattern exactly.

const SITE_ORIGIN = process.env.AUTH_URL ?? "http://localhost:3000";

function formatPerformanceDate(date: Date | null): string | null {
  return date ? date.toLocaleDateString("en-GB", { year: "numeric", month: "long", day: "numeric" }) : null;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const artist = await getArtistEntityPageData(slug);
  if (!artist) return {};

  const description =
    artist.description ??
    `${artist.name} — an artist documented in the Music Madras archive of Chennai's Western Classical Music heritage.`;
  const title = `${artist.name} — Music Madras`;

  return {
    metadataBase: new URL(SITE_ORIGIN),
    title,
    description,
    alternates: { canonical: `/artists/${artist.slug}` },
    openGraph: { title, description, type: "profile" },
  };
}

export default async function ArtistPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const artist = await getArtistEntityPageData(slug);
  if (!artist) {
    notFound();
  }

  after(() =>
    trackPublicPageView({ path: `/artists/${artist.slug}` }, createEntityViewEvent({ entityType: "Artist", entityId: artist.id }))
  );

  return (
    <article>
      <EntityBreadcrumbs
        items={[
          { label: "Music Madras", href: "/" },
          { label: "Archive", href: "/archive" },
          { label: "Artists" },
          { label: artist.name },
        ]}
      />

      <EntityHeader eyebrow="Artist" name={artist.name} subtitle={artist.secondaryDetail} description={artist.description} />

      <EntitySection id="programmes" heading="Programmes">
        {artist.relatedProgrammes.length > 0 ? (
          <ul className="museum-related-list">
            {artist.relatedProgrammes.map((programme) => (
              <li key={programme.id}>
                <Link href={`/programmes/${programme.slug}`}>{programme.title}</Link>
              </li>
            ))}
          </ul>
        ) : (
          <EntityEmptyState>No programmes featuring this artist have been catalogued yet.</EntityEmptyState>
        )}
      </EntitySection>

      <EntitySection id="performances" heading="Performances">
        {artist.relatedPerformances.length > 0 ? (
          <ul className="museum-related-list">
            {artist.relatedPerformances.map((performance) => {
              const participants = [
                ...performance.conductors.map((c) => ({ ...c, href: `/conductors/${c.slug}` })),
                ...performance.choirs.map((c) => ({ ...c, href: `/choirs/${c.slug}` })),
                ...performance.artists.filter((a) => a.slug !== artist.slug).map((a) => ({ ...a, href: `/artists/${a.slug}` })),
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
          <EntityEmptyState>No performances have been catalogued for this artist yet.</EntityEmptyState>
        )}
      </EntitySection>

      <EntitySection id="recordings" heading="Recordings">
        {artist.relatedRecordings.length > 0 ? (
          <ul className="museum-related-list">
            {artist.relatedRecordings.map((recording) => (
              <li key={recording.id}>
                <Link href={`/recordings/${recording.slug}`}>{recording.title ?? "Untitled recording"}</Link>
              </li>
            ))}
          </ul>
        ) : (
          <EntityEmptyState>No recordings have been published for this artist yet.</EntityEmptyState>
        )}
      </EntitySection>

      <p className="museum-group-heading">MusicMadras Media</p>

      <EntitySection
        id="discover"
        heading="MusicMadras Videos"
        intro="Recordings published to the public archive under Music Madras's editorial visibility rules — never raw, unreviewed synchronization data."
      >
        {artist.relatedVideos.length > 0 ? (
          <ul className="museum-recording-grid">
            {artist.relatedVideos.map((video) => (
              <li key={video.slug}>
                <RecordingCard page={{ slug: video.slug }} video={{ title: video.title, thumbnailUrl: video.thumbnailUrl }} />
              </li>
            ))}
          </ul>
        ) : (
          <EntityEmptyState>No recordings featuring this artist have been published to the public archive yet.</EntityEmptyState>
        )}
      </EntitySection>

      {artist.relatedCollections.length > 0 && (
        <EntitySection id="collections" heading="Collections">
          <ul className="museum-category-grid">
            {artist.relatedCollections.map((c) => (
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
            "@type": "Person",
            name: artist.name,
            url: `${SITE_ORIGIN}/artists/${artist.slug}`,
          }),
        }}
      />
    </article>
  );
}
