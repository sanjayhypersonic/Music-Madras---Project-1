import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getPublicRecordingPageData } from "../../../../modules/db/repositories/entityRelationshipsRepository";
import { buildRecordingMetadata } from "../../../../modules/mmke/recordingPage/buildRecordingMetadata";
import { buildRecordingJsonLd } from "../../../../modules/mmke/recordingPage/buildRecordingJsonLd";
import { EntityBreadcrumbs } from "../../../../components/museum/entity/EntityBreadcrumbs";
import { EntityHeader } from "../../../../components/museum/entity/EntityHeader";
import { EntitySection } from "../../../../components/museum/entity/EntitySection";
import { EntityEmptyState } from "../../../../components/museum/entity/EntityEmptyState";
import { RelatedItemList } from "../../../../components/museum/entity/RelatedItemList";
import { RecordingCard } from "../../../../components/museum/RecordingCard";

// Phase 6G-5B — the first public page for a canonical MusicMadras
// Recording (as opposed to a raw YouTube resource — see
// app/(museum)/videos/[slug]/page.tsx, which represents a YouTubeVideoPage
// instead). ARCHIVE AT THE FOUNDATION, DISCOVERY AT THE SURFACE: this
// page is built entirely from the canonical MMKE relationship graph via
// getPublicRecordingPageData — no Prisma import here, no query of any
// kind directly in this file, matching the Composer page's exact pattern.
// Publication safety is entirely getPublicRecordingPageData's
// responsibility (which defers to isRecordingPublished, the single
// authoritative predicate from Phase 6G-5A) — this file never re-checks
// or duplicates that logic.

const SITE_ORIGIN = process.env.AUTH_URL ?? "http://localhost:3000";

function formatPerformanceDate(date: Date | null): string | null {
  return date ? date.toLocaleDateString("en-GB", { year: "numeric", month: "long", day: "numeric" }) : null;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const recording = await getPublicRecordingPageData(slug);
  if (!recording) return {};

  const { title, description, canonicalPath, openGraphImage } = buildRecordingMetadata(recording);

  return {
    metadataBase: new URL(SITE_ORIGIN),
    title,
    description,
    alternates: { canonical: canonicalPath },
    openGraph: {
      title,
      description,
      url: canonicalPath,
      type: "music.song",
      images: openGraphImage ? [{ url: openGraphImage }] : undefined,
    },
  };
}

export default async function RecordingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const recording = await getPublicRecordingPageData(slug);
  if (!recording) {
    notFound();
  }

  const displayTitle = recording.title ?? "Untitled Recording";
  const subtitleParts: string[] = [];
  if (recording.performance) {
    const dateLabel = formatPerformanceDate(recording.performance.performanceDate);
    if (dateLabel) subtitleParts.push(dateLabel);
    if (recording.performance.venue) subtitleParts.push(recording.performance.venue.name);
  }
  const subtitle = subtitleParts.length > 0 ? subtitleParts.join(" — ") : null;

  const hasEducationalContent = Boolean(
    recording.educationalListeningGuide || recording.educationalAnalysis || recording.educationalDifficultyLevel
  );

  return (
    <article>
      <EntityBreadcrumbs
        items={[
          { label: "Music Madras", href: "/" },
          { label: "Archive", href: "/#archive" },
          { label: "Recordings" },
          { label: displayTitle },
        ]}
      />

      <EntityHeader eyebrow="Recording" name={displayTitle} subtitle={subtitle} description={recording.description} />

      <EntitySection
        id="videos"
        heading="MusicMadras Videos"
        intro="Recordings published to the public archive under Music Madras's editorial visibility rules — never raw, unreviewed synchronization data."
      >
        {recording.videos.length > 0 ? (
          <ul className="museum-recording-grid">
            {recording.videos.map((video) => (
              <li key={video.slug}>
                <RecordingCard page={{ slug: video.slug }} video={{ title: video.title, thumbnailUrl: video.thumbnailUrl }} />
              </li>
            ))}
          </ul>
        ) : (
          <EntityEmptyState>No video has been published for this recording yet.</EntityEmptyState>
        )}
      </EntitySection>

      <EntitySection id="programme" heading="Programme &amp; Musical Works">
        {recording.works.length > 0 ? (
          <ul className="museum-related-list">
            {recording.works.map((work) => (
              <li key={work.id}>
                <Link href={`/works/${work.slug}`}>{work.title}</Link> —{" "}
                <Link href={`/composers/${work.composer.slug}`}>{work.composer.name}</Link>
              </li>
            ))}
          </ul>
        ) : (
          <EntityEmptyState>No musical works have been catalogued for this recording yet.</EntityEmptyState>
        )}

        {recording.programme && (
          <>
            <p className="museum-section__intro">
              Part of the programme <strong>{recording.programme.title}</strong>:
            </p>
            <ol className="museum-related-list">
              {recording.programme.items.map((item) => (
                <li key={item.id}>
                  <Link href={`/works/${item.work.slug}`}>{item.work.title}</Link>
                  {item.movement ? ` — ${item.movement}` : ""}
                  {item.isEncore ? " (encore)" : ""}
                </li>
              ))}
            </ol>
          </>
        )}
      </EntitySection>

      <EntitySection id="performance" heading="Performance">
        {recording.performance ? (
          <>
            <p className="museum-meta">
              {formatPerformanceDate(recording.performance.performanceDate) && (
                <span>{formatPerformanceDate(recording.performance.performanceDate)}</span>
              )}
              {recording.performance.venue && (
                <span>
                  <Link href={`/venues/${recording.performance.venue.slug}`}>{recording.performance.venue.name}</Link>
                  {recording.performance.venue.organisation ? ` (${recording.performance.venue.organisation.name})` : ""}
                </span>
              )}
            </p>
            {(recording.performance.artists.length > 0 ||
              recording.performance.choirs.length > 0 ||
              recording.performance.conductors.length > 0) && (
              <ul className="museum-pathways">
                {recording.performance.conductors.map((conductor) => (
                  <li key={`conductor-${conductor.id}`}>{conductor.name} · Conductor</li>
                ))}
                {recording.performance.choirs.map((choir) => (
                  <li key={`choir-${choir.id}`}>{choir.name}</li>
                ))}
                {recording.performance.artists.map((artist) => (
                  <li key={`artist-${artist.id}`}>
                    {artist.name}
                    {artist.role ? ` · ${artist.role}` : ""}
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <EntityEmptyState>No performance details have been catalogued for this recording yet.</EntityEmptyState>
        )}
      </EntitySection>

      {hasEducationalContent && (
        <EntitySection id="educational" heading="Educational Content">
          {recording.educationalDifficultyLevel && <p className="museum-meta">Difficulty: {recording.educationalDifficultyLevel}</p>}
          {recording.educationalListeningGuide && <p className="museum-prose">{recording.educationalListeningGuide}</p>}
          {recording.educationalAnalysis && <p className="museum-prose">{recording.educationalAnalysis}</p>}
        </EntitySection>
      )}

      {recording.collections.length > 0 && (
        <EntitySection id="collections" heading="Collections">
          {/* Collection identity only — no public /collections/[slug] route exists yet, so this renders
              as non-linked cards rather than a fake or broken URL, matching Composer page's own pattern. */}
          <RelatedItemList items={recording.collections.map((c) => ({ id: c.id, title: c.title }))} asCards />
        </EntitySection>
      )}

      {recording.composers.length > 0 && (
        <EntitySection id="related" heading="Related Archive">
          <ul className="museum-pathways">
            {recording.composers.map((composer) => (
              <li key={composer.id}>
                <Link href={`/composers/${composer.slug}`}>{composer.name}</Link>
              </li>
            ))}
          </ul>
        </EntitySection>
      )}

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(buildRecordingJsonLd(recording, SITE_ORIGIN)) }}
      />
    </article>
  );
}
