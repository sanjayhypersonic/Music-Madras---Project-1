import { getSiteOrigin } from "../../../../modules/config/siteOrigin";
import { serializeJsonLd } from "../../../../modules/seo/serializeJsonLd";
import type { Metadata } from "next";
import { after } from "next/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { findPublishedBySlug } from "../../../../modules/db/repositories/youtubeVideoPageRepository";
import { findPublishedRecordingSlugForYouTubeVideo } from "../../../../modules/db/repositories/mediaResourceRepository";
import { toIso8601Duration } from "../../../../modules/mmke/catalogue/toIso8601Duration";
import { trackPublicPageView } from "../../../../modules/analytics/trackPublicPageView";
import { createEntityViewEvent } from "../../../../modules/analytics/events/factories";
import { OutboundYouTubeLink } from "../../../../components/museum/OutboundYouTubeLink";

// Phase 6G-2A (route) / Phase 6G-2B (visual design) — the first real
// public Museum route. Uses ONLY findPublishedBySlug (the sanctioned
// public-safe repository lookup, which itself defers entirely to
// isYouTubeVideoPagePublic) — no visibility logic is duplicated here,
// and YouTubeVideo is never read directly. Plain dynamic SSR: no
// generateStaticParams, no revalidate, no ISR — that rendering-strategy
// work is explicitly a later increment. Styling uses only the shared,
// reusable classes from app/(museum)/museum.css — nothing here is
// hardcoded specifically around this one page.
//
// Phase 6G-11: adds factual VideoObject JSON-LD (only fields already on
// the canonical YouTubeVideo/YouTubeVideoPage records — nothing inferred)
// and a back-link to the canonical Recording, found ONLY through the real
// MediaResource -> RecordingRevision FK chain
// (findPublishedRecordingSlugForYouTubeVideo) — never by title/keyword
// matching. A video with no such canonical relationship gets no back-link.

function formatDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts = hours > 0 ? [hours, minutes, seconds] : [minutes, seconds];
  return parts.map((part, index) => (index === 0 ? String(part) : String(part).padStart(2, "0"))).join(":");
}

const SITE_ORIGIN = getSiteOrigin();

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const result = await findPublishedBySlug(slug);
  if (!result) return {};

  const { page, youtubeVideo, discoverable } = result;
  const title = page.seoMetaTitle ?? youtubeVideo.title ?? "Music Madras";
  const description = page.seoMetaDescription ?? youtubeVideo.description ?? undefined;

  return {
    metadataBase: new URL(SITE_ORIGIN),
    title,
    description,
    alternates: { canonical: `/videos/${page.slug}` },
    // Phase 6K-2: a page that is approved to exist but NOT to be listed (an unlisted video without a discovery approval) is reachable by
    // its URL only: it is kept out of search indexes, and it is not in the sitemap or any listing.
    robots: discoverable ? undefined : { index: false, follow: false },
    openGraph: {
      title,
      description,
      type: "video.other",
      images: youtubeVideo.thumbnailUrl ? [{ url: youtubeVideo.thumbnailUrl }] : undefined,
    },
  };
}

export default async function PublicVideoPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const result = await findPublishedBySlug(slug);
  if (!result) {
    notFound();
  }

  const { page, youtubeVideo, discoverable } = result;
  const recordingSlug = await findPublishedRecordingSlugForYouTubeVideo(youtubeVideo.id);

  after(() =>
    trackPublicPageView(
      { path: `/videos/${page.slug}` },
      createEntityViewEvent({ entityType: "YouTubeVideo", entityId: youtubeVideo.id, youtubeVideoId: youtubeVideo.id })
    )
  );

  const embedUrl = `https://www.youtube.com/embed/${youtubeVideo.youtubeVideoId}`;
  const watchUrl = `https://www.youtube.com/watch?v=${youtubeVideo.youtubeVideoId}`;

  const videoJsonLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "VideoObject",
    name: youtubeVideo.title ?? "Untitled",
    description: youtubeVideo.description ?? undefined,
    thumbnailUrl: youtubeVideo.thumbnailUrl ?? undefined,
    uploadDate: youtubeVideo.publishedAt ? new Date(youtubeVideo.publishedAt).toISOString() : undefined,
    duration: youtubeVideo.durationSeconds !== null ? toIso8601Duration(youtubeVideo.durationSeconds) : undefined,
    url: `${SITE_ORIGIN}/videos/${page.slug}`,
    embedUrl,
    contentUrl: watchUrl,
  };

  return (
    <article className="museum-container">
      <p className="museum-eyebrow">Video</p>
      <h1>{youtubeVideo.title ?? "Untitled"}</h1>

      <div className="museum-media">
        <iframe
          src={embedUrl}
          title={youtubeVideo.title ?? "Music Madras video"}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      </div>

      <p className="museum-meta">
        {youtubeVideo.durationSeconds !== null && <span>Duration: {formatDuration(youtubeVideo.durationSeconds)}</span>}
        {youtubeVideo.publishedAt && <span>Published on YouTube: {new Date(youtubeVideo.publishedAt).toLocaleDateString()}</span>}
      </p>

      {page.curatorNote && <p className="museum-curator-note">{page.curatorNote}</p>}

      <p className="museum-prose">{youtubeVideo.description}</p>

      {recordingSlug && (
        <p>
          <Link href={`/recordings/${recordingSlug}`} className="museum-button">
            View this Recording in the Archive →
          </Link>
        </p>
      )}

      <p>
        <OutboundYouTubeLink href={watchUrl} youtubeVideoId={youtubeVideo.id} className="museum-button">
          Watch on YouTube
        </OutboundYouTubeLink>
      </p>

      {discoverable && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(videoJsonLd) }} />}
    </article>
  );
}
