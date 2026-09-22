import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { findPublishedBySlug } from "../../../../modules/db/repositories/youtubeVideoPageRepository";

// Phase 6G-2A — the first real public Museum route. Uses ONLY
// findPublishedBySlug (the sanctioned public-safe repository lookup,
// which itself defers entirely to isYouTubeVideoPagePublic) — no
// visibility logic is duplicated here, and YouTubeVideo is never read
// directly. Plain dynamic SSR: no generateStaticParams, no revalidate,
// no ISR — that rendering-strategy work is explicitly a later increment.

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
    <article style={{ maxWidth: "48rem", margin: "0 auto", padding: "1.5rem" }}>
      <h1>{youtubeVideo.title ?? "Untitled"}</h1>

      <div style={{ position: "relative", paddingBottom: "56.25%", height: 0 }}>
        <iframe
          src={`https://www.youtube.com/embed/${youtubeVideo.youtubeVideoId}`}
          title={youtubeVideo.title ?? "Music Madras video"}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", border: 0 }}
        />
      </div>

      {page.curatorNote && (
        <p>
          <em>{page.curatorNote}</em>
        </p>
      )}

      <p>
        {youtubeVideo.durationSeconds !== null && <>Duration: {formatDuration(youtubeVideo.durationSeconds)} </>}
        {youtubeVideo.publishedAt && <>· Published on YouTube: {new Date(youtubeVideo.publishedAt).toLocaleDateString()}</>}
      </p>

      <p style={{ whiteSpace: "pre-wrap" }}>{youtubeVideo.description}</p>

      <p>
        <a href={`https://www.youtube.com/watch?v=${youtubeVideo.youtubeVideoId}`} target="_blank" rel="noopener noreferrer">
          Watch on YouTube
        </a>
      </p>

      <footer style={{ marginTop: "2rem", borderTop: "1px solid #ccc", paddingTop: "1rem" }}>
        <small>Music Madras — Music. People. Heritage. Chennai.</small>
      </footer>
    </article>
  );
}
