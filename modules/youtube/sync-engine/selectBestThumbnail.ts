import type { YouTubeThumbnailSet } from "../adapter";

// YouTubeVideo.thumbnailUrl / YouTubePlaylist.thumbnailUrl are each a
// single column (Phase 1 schema), not a full multi-resolution set. This
// picks one representative URL — the highest resolution YouTube actually
// returned — which is sufficient to satisfy the Phase 6F brief's
// requirement to "store what's needed to dynamically reflect the current
// YouTube thumbnail": a future sync compares this stored URL against the
// newly fetched best-available URL to detect a thumbnail change. Storing
// the full variant set was considered and rejected as a schema change
// beyond what this single-URL requirement actually needs.
const RESOLUTION_PREFERENCE_ORDER: (keyof YouTubeThumbnailSet)[] = ["maxres", "standard", "high", "medium", "default"];

export function selectBestThumbnail(thumbnails: YouTubeThumbnailSet | undefined | null): string | null {
  if (!thumbnails) return null;
  for (const key of RESOLUTION_PREFERENCE_ORDER) {
    const candidate = thumbnails[key];
    if (candidate?.url) return candidate.url;
  }
  return null;
}
