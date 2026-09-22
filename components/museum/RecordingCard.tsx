import Image from "next/image";
import Link from "next/link";
import type { YouTubeVideo, YouTubeVideoPage } from "@prisma/client";

// Phase 6G-3 — a published, publicly-eligible recording as shown on the
// homepage's discovery grid. Always links to the existing public route
// (/videos/[slug]); never fetches or filters anything itself — the caller
// is responsible for only ever passing pages that already came from
// listPublishedVideoPages.

export function RecordingCard({ page, video }: { page: YouTubeVideoPage; video: YouTubeVideo }) {
  return (
    <Link href={`/videos/${page.slug}`} className="museum-recording-card">
      <span className="museum-media museum-media--thumbnail">
        {video.thumbnailUrl ? (
          // The recording's title is already rendered as visible text below,
          // so the thumbnail itself is treated as decorative (alt="").
          <Image src={video.thumbnailUrl} alt="" fill sizes="(max-width: 40rem) 100vw, 33vw" />
        ) : (
          <span className="museum-media__placeholder" aria-hidden="true" />
        )}
      </span>
      <span className="museum-recording-card__title">{video.title ?? "Untitled recording"}</span>
    </Link>
  );
}
