import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getPublicProgrammePageData } from "../../../../modules/db/repositories/entityRelationshipsRepository";
import { EntityBreadcrumbs } from "../../../../components/museum/entity/EntityBreadcrumbs";
import { EntityHeader } from "../../../../components/museum/entity/EntityHeader";
import { EntitySection } from "../../../../components/museum/entity/EntitySection";
import { EntityEmptyState } from "../../../../components/museum/entity/EntityEmptyState";
import { RelatedItemList } from "../../../../components/museum/entity/RelatedItemList";
import { RecordingCard } from "../../../../components/museum/RecordingCard";
import type { ProgrammePageData } from "../../../../modules/mmke/programmePage/programmePageContract";

// Phase 6G-8 — the public /programmes/[slug] page, completing the archive
// graph Composer -> Work -> Programme -> Performance -> Recording -> Video.
// Built from the same resolveRelatedContent core every other public
// entity page uses (scoped to this one Programme's own performances) via
// getPublicProgrammePageData — no Prisma import here, matching the
// Work/Venue/Composer pages' exact pattern. Each performance links to its
// own /performances/[slug] page, same as every other page that surfaces
// relatedPerformances.

const SITE_ORIGIN = process.env.AUTH_URL ?? "http://localhost:3000";

function formatPerformanceDate(date: Date | null): string | null {
  return date ? date.toLocaleDateString("en-GB", { year: "numeric", month: "long", day: "numeric" }) : null;
}

function buildDescription(programme: ProgrammePageData): string {
  const workTitles = programme.items.slice(0, 3).map((item) => item.work.title);
  const worksPart = workTitles.length > 0 ? ` featuring ${workTitles.join(", ")}` : "";
  return `${programme.title}${worksPart} — documented in the Music Madras archive of Chennai's Western Classical Music heritage.`;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const programme = await getPublicProgrammePageData(slug);
  if (!programme) return {};

  const title = `${programme.title} — Music Madras`;
  const description = buildDescription(programme);
  const canonicalPath = `/programmes/${programme.slug}`;
  const openGraphImage = programme.videos[0]?.thumbnailUrl;

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

export default async function ProgrammePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const programme = await getPublicProgrammePageData(slug);
  if (!programme) {
    notFound();
  }

  return (
    <article>
      <EntityBreadcrumbs
        items={[
          { label: "Music Madras", href: "/" },
          { label: "Archive", href: "/archive" },
          { label: "Programmes" },
          { label: programme.title },
        ]}
      />

      <EntityHeader eyebrow="Programme" name={programme.title} subtitle={null} description={programme.notes} />

      <EntitySection id="works" heading="Works in this Programme">
        {programme.items.length > 0 ? (
          <ol className="museum-related-list">
            {programme.items.map((item) => (
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

      <EntitySection id="performances" heading="Performances">
        {programme.performances.length > 0 ? (
          <ul className="museum-related-list">
            {programme.performances.map((performance) => {
              const participants = [...performance.conductors, ...performance.choirs, ...performance.artists];
              return (
                <li key={performance.id}>
                  <Link href={`/performances/${performance.slug}`}>
                    {formatPerformanceDate(performance.performanceDate) ?? "Date unknown"}
                  </Link>
                  {performance.venue && (
                    <>
                      {" — "}
                      <Link href={`/venues/${performance.venue.slug}`}>{performance.venue.name}</Link>
                    </>
                  )}
                  {participants.length > 0 && <span className="museum-performance-participants"> · {participants.join(", ")}</span>}
                </li>
              );
            })}
          </ul>
        ) : (
          <EntityEmptyState>No performances of this programme have been catalogued yet.</EntityEmptyState>
        )}
      </EntitySection>

      <EntitySection id="recordings" heading="Recordings">
        {programme.recordings.length > 0 ? (
          <ul className="museum-related-list">
            {programme.recordings.map((recording) => (
              <li key={recording.id}>
                <Link href={`/recordings/${recording.slug}`}>{recording.title ?? "Untitled recording"}</Link>
              </li>
            ))}
          </ul>
        ) : (
          <EntityEmptyState>No recordings of this programme have been published yet.</EntityEmptyState>
        )}
      </EntitySection>

      <p className="museum-group-heading">MusicMadras Media</p>

      <EntitySection
        id="discover"
        heading="MusicMadras Videos"
        intro="Recordings published to the public archive under Music Madras's editorial visibility rules — never raw, unreviewed synchronization data."
      >
        {programme.videos.length > 0 ? (
          <ul className="museum-recording-grid">
            {programme.videos.map((video) => (
              <li key={video.slug}>
                <RecordingCard page={{ slug: video.slug }} video={{ title: video.title, thumbnailUrl: video.thumbnailUrl }} />
              </li>
            ))}
          </ul>
        ) : (
          <EntityEmptyState>No recordings of this programme have been published to the public archive yet.</EntityEmptyState>
        )}
      </EntitySection>

      {programme.collections.length > 0 && (
        <EntitySection id="collections" heading="Collections">
          <RelatedItemList items={programme.collections.map((c) => ({ id: c.id, title: c.title }))} asCards />
        </EntitySection>
      )}

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "MusicPlaylist",
            name: programme.title,
            url: `${SITE_ORIGIN}/programmes/${programme.slug}`,
            numTracks: programme.items.length,
          }),
        }}
      />
    </article>
  );
}
