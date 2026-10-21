import Image from "next/image";
import Link from "next/link";

// Phase 6G-3 — a published, publicly-eligible recording as shown on the
// homepage's discovery grid. Always links to the existing public route
// (/videos/[slug]); never fetches or filters anything itself — the caller
// is responsible for only ever passing pages that already came from
// listPublishedVideoPages (or, from Phase 6G-4B, an entity page's
// EntityPageRelatedVideo).
//
// Phase 6G-4B: prop types are a narrow structural subset, not the full
// YouTubeVideoPage/YouTubeVideo Prisma models — this is the only thing
// the card actually reads, and keeping it structural is what lets an
// entity page's plain EntityPageRelatedVideo DTO satisfy it directly,
// without a second near-identical card component (brief §8).

export interface RecordingCardProps {
  page: { slug: string };
  video: { title: string | null; thumbnailUrl: string | null };
}

export function RecordingCard({ page, video }: RecordingCardProps) {
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
      <span className="museum-recording-card__title">{video.title ?? "Untitled video"}</span>
    </Link>
  );
}
