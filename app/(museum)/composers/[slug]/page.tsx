import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getComposerEntityPageData } from "../../../../modules/db/repositories/entityRelationshipsRepository";
import type { EntityPageLifespan } from "../../../../modules/mmke/entityPage/entityPageContract";
import { EntityBreadcrumbs } from "../../../../components/museum/entity/EntityBreadcrumbs";
import { EntityHeader } from "../../../../components/museum/entity/EntityHeader";
import { EntitySection } from "../../../../components/museum/entity/EntitySection";
import { EntityEmptyState } from "../../../../components/museum/entity/EntityEmptyState";
import { RelatedItemList } from "../../../../components/museum/entity/RelatedItemList";
import { RecordingCard } from "../../../../components/museum/RecordingCard";

// Phase 6G-4B — the first real public Archive entity page, proving the
// Phase 6G-4A relationship layer end to end: public route -> repository
// -> EntityPageData contract -> Museum presentation. No Prisma import
// here (brief §9) — getComposerEntityPageData is the only data access.
//
// Phase 6G-6: Works, Recordings and Venues now have their own public
// routes, so this page links to them directly instead of using the
// non-linked RelatedItemList placeholder — Artists/Choirs/Conductors
// still have no public route, so they remain plain text.

const SITE_ORIGIN = process.env.AUTH_URL ?? "http://localhost:3000";

function formatLifespan(lifespan: EntityPageLifespan | null): string | null {
  if (!lifespan) return null;
  const { bornDate, diedDate, era } = lifespan;
  if (bornDate && diedDate) return `${bornDate}–${diedDate}`;
  if (bornDate) return `b. ${bornDate}`;
  if (diedDate) return `d. ${diedDate}`;
  return era;
}

function formatPerformanceDate(date: Date | null): string | null {
  return date ? date.toLocaleDateString("en-GB", { year: "numeric", month: "long", day: "numeric" }) : null;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const composer = await getComposerEntityPageData(slug);
  if (!composer) return {};

  const description =
    composer.description ??
    `${composer.name} — a composer documented in the Music Madras archive of Chennai's Western Classical Music heritage.`;
  const title = `${composer.name} — Music Madras`;

  return {
    metadataBase: new URL(SITE_ORIGIN),
    title,
    description,
    alternates: { canonical: `/composers/${composer.slug}` },
    openGraph: { title, description, type: "profile" },
  };
}

export default async function ComposerPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const composer = await getComposerEntityPageData(slug);
  if (!composer) {
    notFound();
  }

  const lifespanLabel = formatLifespan(composer.lifespan);
  const { artists, choirs, conductors, venues } = composer.relatedParticipants;
  const relatedPeopleNames = [...conductors, ...choirs, ...artists];

  return (
    <article>
      <EntityBreadcrumbs
        items={[
          { label: "Music Madras", href: "/" },
          { label: "Archive", href: "/archive" },
          { label: "Composers" },
          { label: composer.name },
        ]}
      />

      <EntityHeader eyebrow="Composer" name={composer.name} subtitle={lifespanLabel} description={composer.description} />

      <EntitySection id="works" heading="Musical Works">
        {composer.relatedWorks && composer.relatedWorks.length > 0 ? (
          <ul className="museum-related-list">
            {composer.relatedWorks.map((work) => (
              <li key={work.id}>
                <Link href={`/works/${work.slug}`}>{work.title}</Link>
              </li>
            ))}
          </ul>
        ) : (
          <EntityEmptyState>No musical works have been catalogued for this composer yet.</EntityEmptyState>
        )}
      </EntitySection>

      <EntitySection id="performances" heading="Performances">
        {composer.relatedPerformances.length > 0 ? (
          <ul className="museum-related-list">
            {composer.relatedPerformances.map((performance) => {
              const participants = [...performance.conductors, ...performance.choirs, ...performance.artists];
              return (
                <li key={performance.id}>
                  {formatPerformanceDate(performance.performanceDate) ?? "Date unknown"}
                  {performance.venueName && (
                    <>
                      {" — "}
                      {performance.venueSlug ? <Link href={`/venues/${performance.venueSlug}`}>{performance.venueName}</Link> : performance.venueName}
                    </>
                  )}
                  {participants.length > 0 && <span className="museum-performance-participants"> · {participants.join(", ")}</span>}
                </li>
              );
            })}
          </ul>
        ) : (
          <EntityEmptyState>No performances have been catalogued for this composer yet.</EntityEmptyState>
        )}
      </EntitySection>

      <EntitySection id="recordings" heading="Recordings">
        {composer.relatedRecordings.length > 0 ? (
          <ul className="museum-related-list">
            {composer.relatedRecordings.map((recording) => (
              <li key={recording.id}>
                <Link href={`/recordings/${recording.slug}`}>{recording.title ?? "Untitled recording"}</Link>
              </li>
            ))}
          </ul>
        ) : (
          <EntityEmptyState>No recordings have been published for this composer yet.</EntityEmptyState>
        )}
      </EntitySection>

      {(relatedPeopleNames.length > 0 || venues.length > 0) && (
        <EntitySection id="related" heading="Related People &amp; Places">
          <ul className="museum-pathways">
            {venues.map((venue) => (
              <li key={venue.slug}>
                <Link href={`/venues/${venue.slug}`}>{venue.name}</Link>
              </li>
            ))}
            {relatedPeopleNames.map((name) => (
              <li key={name}>{name}</li>
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
        {composer.relatedVideos.length > 0 ? (
          <ul className="museum-recording-grid">
            {composer.relatedVideos.map((video) => (
              <li key={video.slug}>
                <RecordingCard page={{ slug: video.slug }} video={{ title: video.title, thumbnailUrl: video.thumbnailUrl }} />
              </li>
            ))}
          </ul>
        ) : (
          <EntityEmptyState>No recordings by this composer have been published to the public archive yet.</EntityEmptyState>
        )}
      </EntitySection>

      {composer.relatedCollections.length > 0 && (
        <EntitySection id="collections" heading="Collections">
          <RelatedItemList items={composer.relatedCollections.map((c) => ({ id: c.id, title: c.title }))} asCards />
        </EntitySection>
      )}

      <script
        type="application/ld+json"
        // Minimal, safe structured data (brief §12) — name and canonical
        // URL only. No birthDate/deathDate: Composer.bornDate/diedDate are
        // free text (e.g. "circa 1685"), not the ISO 8601 Schema.org's
        // Person.birthDate requires, and mapping free text into that field
        // would produce invalid/misleading structured data.
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Person",
            name: composer.name,
            url: `${SITE_ORIGIN}/composers/${composer.slug}`,
          }),
        }}
      />
    </article>
  );
}
