import { slugify } from "./slugify";

// Phase 6G-1B — the slug for a YouTubeVideoPage (pre-flight §7, brief §3).
// Deliberately NOT a database lookup/retry-on-collision strategy: the
// suffix is the video's own immutable YouTube video ID (already short —
// YouTube IDs are 11 characters), which is unique by construction across
// every video that will ever exist, so the combined slug is collision-safe
// without ever needing to ask the database "is this taken?" first. This is
// generated exactly once, at YouTubeVideoPage creation (brief §4) — the
// repository's updateEditorialFields must never accept `slug` as an input,
// and no synchronization code path may ever call this again for an
// existing page, so a later YouTube title change never changes the URL.

export function generateVideoSlug(title: string | null, youtubeVideoId: string): string {
  const base = slugify(title ?? "") || "video";
  const suffix = youtubeVideoId.toLowerCase();
  return `${base}-${suffix}`;
}
