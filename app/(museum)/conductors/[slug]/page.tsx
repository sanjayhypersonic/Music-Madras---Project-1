import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getConductorEntityPageData } from "../../../../modules/db/repositories/entityRelationshipsRepository";
import { EntityBreadcrumbs } from "../../../../components/museum/entity/EntityBreadcrumbs";
import { EntityHeader } from "../../../../components/museum/entity/EntityHeader";
import { EntitySection } from "../../../../components/museum/entity/EntitySection";
import { EntityEmptyState } from "../../../../components/museum/entity/EntityEmptyState";
import { RelatedItemList } from "../../../../components/museum/entity/RelatedItemList";
import { RecordingCard } from "../../../../components/museum/RecordingCard";

// Phase 6G-9 — the public /conductors/[slug] page. Reuses the generic
// EntityPageData contract exactly like Composer/Venue/Artist/Choir via
// getConductorEntityPageData — no Prisma import here.

const SITE_ORIGIN = process.env.AUTH_URL ?? "http://localhost:3000";

function formatPerformanceDate(date: Date | null): string | null {
  return date ? date.toLocaleDateString("en-GB", { year: "numeric", month: "long", day: "numeric" }) : null;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const conductor = await getConductorEntityPageData(slug);
  if (!conductor) return {};

  const description =
    conductor.description ??
    `${conductor.name} — a conductor documented in the Music Madras archive of Chennai's Western Classical Music heritage.`;
  const title = `${conductor.name} — Music Madras`;

  return {
    metadataBase: new URL(SITE_ORIGIN),
    title,
    description,
    alternates: { canonical: `/conductors/${conductor.slug}` },
    openGraph: { title, description, type: "profile" },
  };
}

export default async function ConductorPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const conductor = await getConductorEntityPageData(slug);
  if (!conductor) {
    notFound();
  }

  return (
    <article>
      <EntityBreadcrumbs
        items={[
          { label: "Music Madras", href: "/" },
          { label: "Archive", href: "/archive" },
          { label: "Conductors" },
          { label: conductor.name },
        ]}
      />

      <EntityHeader eyebrow="Conductor" name={conductor.name} subtitle={null} description={conductor.description} />

      <EntitySection id="programmes" heading="Programmes">
        {conductor.relatedProgrammes.length > 0 ? (
          <ul className="museum-related-list">
            {conductor.relatedProgrammes.map((programme) => (
              <li key={programme.id}>
                <Link href={`/programmes/${programme.slug}`}>{programme.title}</Link>
              </li>
            ))}
          </ul>
        ) : (
          <EntityEmptyState>No programmes featuring this conductor have been catalogued yet.</EntityEmptyState>
        )}
      </EntitySection>

      <EntitySection id="performances" heading="Performances">
        {conductor.relatedPerformances.length > 0 ? (
          <ul className="museum-related-list">
            {conductor.relatedPerformances.map((performance) => {
              const participants = [
                ...performance.conductors.filter((c) => c.slug !== conductor.slug).map((c) => ({ ...c, href: `/conductors/${c.slug}` })),
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
          <EntityEmptyState>No performances have been catalogued for this conductor yet.</EntityEmptyState>
        )}
      </EntitySection>

      <EntitySection id="recordings" heading="Recordings">
        {conductor.relatedRecordings.length > 0 ? (
          <ul className="museum-related-list">
            {conductor.relatedRecordings.map((recording) => (
              <li key={recording.id}>
                <Link href={`/recordings/${recording.slug}`}>{recording.title ?? "Untitled recording"}</Link>
              </li>
            ))}
          </ul>
        ) : (
          <EntityEmptyState>No recordings have been published for this conductor yet.</EntityEmptyState>
        )}
      </EntitySection>

      <p className="museum-group-heading">MusicMadras Media</p>

      <EntitySection
        id="discover"
        heading="MusicMadras Videos"
        intro="Recordings published to the public archive under Music Madras's editorial visibility rules — never raw, unreviewed synchronization data."
      >
        {conductor.relatedVideos.length > 0 ? (
          <ul className="museum-recording-grid">
            {conductor.relatedVideos.map((video) => (
              <li key={video.slug}>
                <RecordingCard page={{ slug: video.slug }} video={{ title: video.title, thumbnailUrl: video.thumbnailUrl }} />
              </li>
            ))}
          </ul>
        ) : (
          <EntityEmptyState>No recordings featuring this conductor have been published to the public archive yet.</EntityEmptyState>
        )}
      </EntitySection>

      {conductor.relatedCollections.length > 0 && (
        <EntitySection id="collections" heading="Collections">
          <RelatedItemList items={conductor.relatedCollections.map((c) => ({ id: c.id, title: c.title }))} asCards />
        </EntitySection>
      )}

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Person",
            name: conductor.name,
            url: `${SITE_ORIGIN}/conductors/${conductor.slug}`,
          }),
        }}
      />
    </article>
  );
}
