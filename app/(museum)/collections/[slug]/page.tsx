import type { Metadata } from "next";
import { after } from "next/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getPublicCollectionPageData } from "../../../../modules/db/repositories/entityRelationshipsRepository";
import { EntityBreadcrumbs } from "../../../../components/museum/entity/EntityBreadcrumbs";
import { EntityHeader } from "../../../../components/museum/entity/EntityHeader";
import { EntitySection } from "../../../../components/museum/entity/EntitySection";
import { EntityEmptyState } from "../../../../components/museum/entity/EntityEmptyState";
import { RecordingCard } from "../../../../components/museum/RecordingCard";
import type { CollectionPageData } from "../../../../modules/mmke/collectionPage/collectionPageContract";
import { trackPublicPageView } from "../../../../modules/analytics/trackPublicPageView";
import { createEntityViewEvent } from "../../../../modules/analytics/events/factories";

// Phase 6G-10 — the public /collections/[slug] page, completing the
// public Museum layer for the MusicMadras Collection entity. Built from
// getPublicCollectionPageData's own Collection-rooted traversal (Collection
// -> CollectionRecording/CollectionWork), never resolveRelatedContent
// (which is Performance-rooted and has no entry point for a Collection as
// its own subject) — no Prisma import here, matching every other public
// entity page's pattern. Programme/Performance/Venue/participant context
// is surfaced per-Recording, where it genuinely exists, rather than as
// invented top-level Collection relationships.

const SITE_ORIGIN = process.env.AUTH_URL ?? "http://localhost:3000";

function formatPerformanceDate(date: Date | null): string | null {
  return date ? date.toLocaleDateString("en-GB", { year: "numeric", month: "long", day: "numeric" }) : null;
}

function buildDescription(collection: CollectionPageData): string {
  if (collection.description) return collection.description;
  const parts: string[] = [];
  if (collection.recordings.length > 0) parts.push(`${collection.recordings.length} recording${collection.recordings.length === 1 ? "" : "s"}`);
  if (collection.works.length > 0) parts.push(`${collection.works.length} musical work${collection.works.length === 1 ? "" : "s"}`);
  const summary = parts.length > 0 ? ` featuring ${parts.join(" and ")}` : "";
  return `${collection.title}${summary} — a curated collection from the Music Madras archive of Chennai's Western Classical Music heritage.`;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const collection = await getPublicCollectionPageData(slug);
  if (!collection) return {};

  const title = `${collection.title} — Music Madras`;
  const description = buildDescription(collection);
  const canonicalPath = `/collections/${collection.slug}`;
  const openGraphImage = collection.videos[0]?.thumbnailUrl;

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

export default async function CollectionPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const collection = await getPublicCollectionPageData(slug);
  if (!collection) {
    notFound();
  }

  after(() =>
    trackPublicPageView(
      { path: `/collections/${collection.slug}` },
      createEntityViewEvent({ entityType: "Collection", entityId: collection.id, collectionId: collection.id })
    )
  );

  const numTracks = collection.recordings.length + collection.works.length;

  return (
    <article>
      <EntityBreadcrumbs
        items={[
          { label: "Music Madras", href: "/" },
          { label: "Archive", href: "/archive" },
          { label: "Collections", href: "/collections" },
          { label: collection.title },
        ]}
      />

      <EntityHeader eyebrow="Collection" name={collection.title} subtitle={null} description={collection.description} />

      <EntitySection id="recordings" heading="Recordings">
        {collection.recordings.length > 0 ? (
          <ul className="museum-related-list">
            {collection.recordings.map((recording) => {
              const dateLabel = formatPerformanceDate(recording.context.performance?.performanceDate ?? null);
              const participants = [...recording.context.conductors, ...recording.context.choirs, ...recording.context.artists];
              return (
                <li key={recording.id}>
                  <Link href={`/recordings/${recording.slug}`}>{recording.title ?? "Untitled recording"}</Link>
                  {recording.context.programme && (
                    <>
                      {" — "}
                      <Link href={`/programmes/${recording.context.programme.slug}`}>{recording.context.programme.title}</Link>
                    </>
                  )}
                  {recording.context.venue && (
                    <>
                      {" · "}
                      <Link href={`/venues/${recording.context.venue.slug}`}>{recording.context.venue.name}</Link>
                    </>
                  )}
                  {dateLabel && <>{" · "}{dateLabel}</>}
                  {participants.length > 0 && (
                    <span className="museum-performance-participants">
                      {" · "}
                      {participants.map((person, index) => (
                        <span key={person.slug}>
                          {index > 0 && ", "}
                          {person.name}
                        </span>
                      ))}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <EntityEmptyState>No published recordings have been added to this collection yet.</EntityEmptyState>
        )}
      </EntitySection>

      <EntitySection id="works" heading="Musical Works">
        {collection.works.length > 0 ? (
          <ul className="museum-related-list">
            {collection.works.map((item) => (
              <li key={item.work.id}>
                <Link href={`/works/${item.work.slug}`}>{item.work.title}</Link> —{" "}
                <Link href={`/composers/${item.work.composer.slug}`}>{item.work.composer.name}</Link>
              </li>
            ))}
          </ul>
        ) : (
          <EntityEmptyState>No musical works have been added to this collection yet.</EntityEmptyState>
        )}
      </EntitySection>

      {collection.composers.length > 0 && (
        <EntitySection id="composers" heading="Composers">
          <ul className="museum-pathways">
            {collection.composers.map((composer) => (
              <li key={composer.id}>
                <Link href={`/composers/${composer.slug}`}>{composer.name}</Link>
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
        {collection.videos.length > 0 ? (
          <ul className="museum-recording-grid">
            {collection.videos.map((video) => (
              <li key={video.slug}>
                <RecordingCard page={{ slug: video.slug }} video={{ title: video.title, thumbnailUrl: video.thumbnailUrl }} />
              </li>
            ))}
          </ul>
        ) : (
          <EntityEmptyState>No recordings from this collection have been published to the public archive yet.</EntityEmptyState>
        )}
      </EntitySection>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "MusicPlaylist",
            name: collection.title,
            url: `${SITE_ORIGIN}/collections/${collection.slug}`,
            numTracks,
          }),
        }}
      />
    </article>
  );
}
