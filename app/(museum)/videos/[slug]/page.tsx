import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { findPublishedBySlug } from "../../../../modules/db/repositories/youtubeVideoPageRepository";

// Phase 6G-2A (route) / Phase 6G-2B (visual design) — the first real
// public Museum route. Uses ONLY findPublishedBySlug (the sanctioned
// public-safe repository lookup, which itself defers entirely to
// isYouTubeVideoPagePublic) — no visibility logic is duplicated here,
// and YouTubeVideo is never read directly. Plain dynamic SSR: no
// generateStaticParams, no revalidate, no ISR — that rendering-strategy
// work is explicitly a later increment. Styling uses only the shared,
// reusable classes from app/(museum)/museum.css — nothing here is
// hardcoded specifically around this one page.

function formatDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts = hours > 0 ? [hours, minutes, seconds] : [minutes, seconds];
  return parts.map((part, index) => (index === 0 ? String(part) : String(part).padStart(2, "0"))).join(":");
}

const SITE_ORIGIN = process.env.AUTH_URL ?? "http://localhost:3000";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const result = await findPublishedBySlug(slug);
  if (!result) return {};

  const { page, youtubeVideo } = result;
  const title = page.seoMetaTitle ?? youtubeVideo.title ?? "Music Madras";
  const description = page.seoMetaDescription ?? youtubeVideo.description ?? undefined;

  return {
    metadataBase: new URL(SITE_ORIGIN),
    title,
    description,
    alternates: { canonical: `/videos/${page.slug}` },
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

  const { page, youtubeVideo } = result;

  return (
    <article className="museum-container">
      <p className="museum-eyebrow">Recording</p>
      <h1>{youtubeVideo.title ?? "Untitled"}</h1>

      <div className="museum-media">
        <iframe
          src={`https://www.youtube.com/embed/${youtubeVideo.youtubeVideoId}`}
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

      <p>
        <a
          className="museum-button"
          href={`https://www.youtube.com/watch?v=${youtubeVideo.youtubeVideoId}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          Watch on YouTube
        </a>
      </p>
    </article>
  );
}
