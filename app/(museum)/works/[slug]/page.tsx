import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getPublicWorkPageData } from "../../../../modules/db/repositories/entityRelationshipsRepository";
import { EntityBreadcrumbs } from "../../../../components/museum/entity/EntityBreadcrumbs";
import { EntityHeader } from "../../../../components/museum/entity/EntityHeader";
import { EntitySection } from "../../../../components/museum/entity/EntitySection";
import { EntityEmptyState } from "../../../../components/museum/entity/EntityEmptyState";
import { RelatedItemList } from "../../../../components/museum/entity/RelatedItemList";
import { RecordingCard } from "../../../../components/museum/RecordingCard";
import type { WorkPageData } from "../../../../modules/mmke/workPage/workPageContract";

// Phase 6G-6 — the public /works/[slug] page. Built from the same
// resolveRelatedContent core the Composer page already uses (scoped to
// this one Work's id), assembled into the dedicated WorkPageData contract
// via getPublicWorkPageData — no Prisma import here, matching every other
// public entity page's pattern exactly.

const SITE_ORIGIN = process.env.AUTH_URL ?? "http://localhost:3000";

function formatPerformanceDate(date: Date | null): string | null {
  return date ? date.toLocaleDateString("en-GB", { year: "numeric", month: "long", day: "numeric" }) : null;
}

function buildDescription(work: WorkPageData): string {
  return `${work.title} by ${work.composer.name} — documented in the Music Madras archive of Chennai's Western Classical Music heritage.`;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const work = await getPublicWorkPageData(slug);
  if (!work) return {};

  const title = `${work.title} — Music Madras`;
  const description = buildDescription(work);
  const canonicalPath = `/works/${work.slug}`;
  const openGraphImage = work.videos[0]?.thumbnailUrl;

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

export default async function WorkPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const work = await getPublicWorkPageData(slug);
  if (!work) {
    notFound();
  }

  const subtitleParts: string[] = [];
  if (work.catalogueNumber) subtitleParts.push(work.catalogueNumber);
  if (work.keySignature) subtitleParts.push(work.keySignature);
  const subtitle = subtitleParts.length > 0 ? subtitleParts.join(" · ") : null;

  return (
    <article>
      <EntityBreadcrumbs
        items={[
          { label: "Music Madras", href: "/" },
          { label: "Archive", href: "/archive" },
          { label: "Musical Works" },
          { label: work.title },
        ]}
      />

      <EntityHeader eyebrow="Musical Work" name={work.title} subtitle={subtitle} description={null} />

      <EntitySection id="identity" heading="About This Work">
        <ul className="museum-related-list">
          <li>
            Composer — <Link href={`/composers/${work.composer.slug}`}>{work.composer.name}</Link>
          </li>
          {work.alternateTitles.length > 0 && <li>Also known as: {work.alternateTitles.join(", ")}</li>}
          {work.language && <li>Language: {work.language}</li>}
          {work.notes && <li>{work.notes}</li>}
        </ul>
      </EntitySection>

      <EntitySection id="programmes" heading="Programmes">
        {work.programmes.length > 0 ? (
          <ul className="museum-related-list">
            {work.programmes.map((programme) => (
              <li key={programme.id}>
                <Link href={`/programmes/${programme.slug}`}>{programme.title}</Link>
              </li>
            ))}
          </ul>
        ) : (
          <EntityEmptyState>No programmes featuring this work have been catalogued yet.</EntityEmptyState>
        )}
      </EntitySection>

      <EntitySection id="performances" heading="Performances">
        {work.performances.length > 0 ? (
          <ul className="museum-related-list">
            {work.performances.map((performance) => {
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
          <EntityEmptyState>No performances of this work have been catalogued yet.</EntityEmptyState>
        )}
      </EntitySection>

      <EntitySection id="recordings" heading="Recordings">
        {work.recordings.length > 0 ? (
          <ul className="museum-related-list">
            {work.recordings.map((recording) => (
              <li key={recording.id}>
                <Link href={`/recordings/${recording.slug}`}>{recording.title ?? "Untitled recording"}</Link>
              </li>
            ))}
          </ul>
        ) : (
          <EntityEmptyState>No recordings of this work have been published yet.</EntityEmptyState>
        )}
      </EntitySection>

      <p className="museum-group-heading">MusicMadras Media</p>

      <EntitySection
        id="discover"
        heading="MusicMadras Videos"
        intro="Recordings published to the public archive under Music Madras's editorial visibility rules — never raw, unreviewed synchronization data."
      >
        {work.videos.length > 0 ? (
          <ul className="museum-recording-grid">
            {work.videos.map((video) => (
              <li key={video.slug}>
                <RecordingCard page={{ slug: video.slug }} video={{ title: video.title, thumbnailUrl: video.thumbnailUrl }} />
              </li>
            ))}
          </ul>
        ) : (
          <EntityEmptyState>No recordings of this work have been published to the public archive yet.</EntityEmptyState>
        )}
      </EntitySection>

      {work.collections.length > 0 && (
        <EntitySection id="collections" heading="Collections">
          <RelatedItemList items={work.collections.map((c) => ({ id: c.id, title: c.title }))} asCards />
        </EntitySection>
      )}

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "MusicComposition",
            name: work.title,
            url: `${SITE_ORIGIN}/works/${work.slug}`,
            composer: { "@type": "Person", name: work.composer.name },
          }),
        }}
      />
    </article>
  );
}
