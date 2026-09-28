import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getPublicPerformancePageData } from "../../../../modules/db/repositories/entityRelationshipsRepository";
import { EntityBreadcrumbs } from "../../../../components/museum/entity/EntityBreadcrumbs";
import { EntityHeader } from "../../../../components/museum/entity/EntityHeader";
import { EntitySection } from "../../../../components/museum/entity/EntitySection";
import { EntityEmptyState } from "../../../../components/museum/entity/EntityEmptyState";
import { RecordingCard } from "../../../../components/museum/RecordingCard";
import type { PerformancePageData } from "../../../../modules/mmke/performancePage/performancePageContract";

// Phase 6G-8 — the public /performances/[slug] page, completing the
// archive graph Composer -> Work -> Programme -> Performance -> Recording
// -> Video. Built from the same resolveRelatedContent core every other
// public entity page uses (scoped to this one Performance's own id) via
// getPublicPerformancePageData — no Prisma import here, matching the
// Programme/Work/Venue pages' exact pattern. Phase 6G-9: each Artist/
// Choir/Conductor now links to its own /artists|choirs|conductors/[slug]
// route.

const SITE_ORIGIN = process.env.AUTH_URL ?? "http://localhost:3000";

function formatPerformanceDate(date: Date | null): string | null {
  return date ? date.toLocaleDateString("en-GB", { year: "numeric", month: "long", day: "numeric" }) : null;
}

function buildPerformanceLabel(performance: PerformancePageData): string {
  return `${performance.programme.title} at ${performance.venue.name}`;
}

function buildDescription(performance: PerformancePageData): string {
  const dateLabel = formatPerformanceDate(performance.performanceDate);
  const base = `${buildPerformanceLabel(performance)}`;
  return `${base}${dateLabel ? `, ${dateLabel}` : ""} — documented in the Music Madras archive of Chennai's Western Classical Music heritage.`;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const performance = await getPublicPerformancePageData(slug);
  if (!performance) return {};

  const title = `${buildPerformanceLabel(performance)} — Music Madras`;
  const description = buildDescription(performance);
  const canonicalPath = `/performances/${performance.slug}`;
  const openGraphImage = performance.videos[0]?.thumbnailUrl;

  return {
    metadataBase: new URL(SITE_ORIGIN),
    title,
    description,
    alternates: { canonical: canonicalPath },
    openGraph: {
      title,
      description,
      url: canonicalPath,
      type: "website",
      images: openGraphImage ? [{ url: openGraphImage }] : undefined,
    },
  };
}

export default async function PerformancePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const performance = await getPublicPerformancePageData(slug);
  if (!performance) {
    notFound();
  }

  const dateLabel = formatPerformanceDate(performance.performanceDate);
  const label = buildPerformanceLabel(performance);
  const participants = [...performance.conductors, ...performance.choirs, ...performance.artists];

  return (
    <article>
      <EntityBreadcrumbs
        items={[
          { label: "Music Madras", href: "/" },
          { label: "Archive", href: "/archive" },
          { label: "Performances" },
          { label },
        ]}
      />

      <EntityHeader eyebrow="Performance" name={label} subtitle={dateLabel} description={null} />

      <EntitySection id="programme" heading="Programme">
        <p className="museum-section__intro">
          Part of the programme{" "}
          <Link href={`/programmes/${performance.programme.slug}`}>
            <strong>{performance.programme.title}</strong>
          </Link>
          :
        </p>
        {performance.programme.items.length > 0 ? (
          <ol className="museum-related-list">
            {performance.programme.items.map((item) => (
              <li key={item.id}>
                <Link href={`/works/${item.work.slug}`}>{item.work.title}</Link> —{" "}
                <Link href={`/composers/${item.work.composer.slug}`}>{item.work.composer.name}</Link>
                {item.movement ? ` — ${item.movement}` : ""}
                {item.isEncore ? " (encore)" : ""}
              </li>
            ))}
          </ol>
        ) : (
          <EntityEmptyState>No works have been catalogued for this programme yet.</EntityEmptyState>
        )}
      </EntitySection>

      <EntitySection id="venue" heading="Venue">
        <p className="museum-meta">
          <Link href={`/venues/${performance.venue.slug}`}>{performance.venue.name}</Link>
          {performance.venue.organisation ? (
            <>
              {" ("}
              <Link href={`/organisations/${performance.venue.organisation.slug}`}>{performance.venue.organisation.name}</Link>
              {")"}
            </>
          ) : (
            ""
          )}
        </p>
      </EntitySection>

      <EntitySection id="participants" heading="Participants">
        {participants.length > 0 ? (
          <ul className="museum-pathways">
            {performance.conductors.map((conductor) => (
              <li key={`conductor-${conductor.id}`}>
                <Link href={`/conductors/${conductor.slug}`}>{conductor.name}</Link> · Conductor
              </li>
            ))}
            {performance.choirs.map((choir) => (
              <li key={`choir-${choir.id}`}>
                <Link href={`/choirs/${choir.slug}`}>{choir.name}</Link>
              </li>
            ))}
            {performance.artists.map((artist) => (
              <li key={`artist-${artist.id}`}>
                <Link href={`/artists/${artist.slug}`}>{artist.name}</Link>
                {artist.role ? ` · ${artist.role}` : ""}
              </li>
            ))}
          </ul>
        ) : (
          <EntityEmptyState>No participants have been catalogued for this performance yet.</EntityEmptyState>
        )}
      </EntitySection>

      <EntitySection id="recordings" heading="Recordings">
        {performance.recordings.length > 0 ? (
          <ul className="museum-related-list">
            {performance.recordings.map((recording) => (
              <li key={recording.id}>
                <Link href={`/recordings/${recording.slug}`}>{recording.title ?? "Untitled recording"}</Link>
              </li>
            ))}
          </ul>
        ) : (
          <EntityEmptyState>No recordings of this performance have been published yet.</EntityEmptyState>
        )}
      </EntitySection>

      <p className="museum-group-heading">MusicMadras Media</p>

      <EntitySection
        id="discover"
        heading="MusicMadras Videos"
        intro="Recordings published to the public archive under Music Madras's editorial visibility rules — never raw, unreviewed synchronization data."
      >
        {performance.videos.length > 0 ? (
          <ul className="museum-recording-grid">
            {performance.videos.map((video) => (
              <li key={video.slug}>
                <RecordingCard page={{ slug: video.slug }} video={{ title: video.title, thumbnailUrl: video.thumbnailUrl }} />
              </li>
            ))}
          </ul>
        ) : (
          <EntityEmptyState>No recordings of this performance have been published to the public archive yet.</EntityEmptyState>
        )}
      </EntitySection>

      {performance.collections.length > 0 && (
        <EntitySection id="collections" heading="Collections">
          <ul className="museum-category-grid">
            {performance.collections.map((c) => (
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
            "@type": "MusicEvent",
            name: label,
            url: `${SITE_ORIGIN}/performances/${performance.slug}`,
            ...(performance.performanceDate ? { startDate: performance.performanceDate.toISOString().slice(0, 10) } : {}),
            location: { "@type": "Place", name: performance.venue.name },
          }),
        }}
      />
    </article>
  );
}
