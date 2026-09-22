import type { ObservabilityState } from "@prisma/client";

// Phase 6G-1B (pre-flight §6, brief §5), extended Phase 6G-2A — the
// public-visibility gate for a YouTubeVideoPage, evaluated at read time,
// never persisted as a combined enum. This exists specifically so that a
// video Music Madras already published can never render publicly again
// once YouTube itself makes it unlisted/private/unavailable, without any
// code remembering to re-check that on every future call site —
// findPublishedBySlug (the only sanctioned "give me a public page" query)
// always goes through this. This is the SINGLE source of truth for
// public exposure — never duplicated in a route or repository query.
//
// Only ObservabilityState.OBSERVED counts as "not unavailable/deleted."
// The sync engine (Phase 6F) only ever writes OBSERVED/NOT_OBSERVED today,
// never PRIVATE/UNLISTED/UNAVAILABLE/DELETED/SYNC_ERROR — but NOT_OBSERVED
// itself is disqualifying here: it means the video was absent from the
// most recent full synchronization pass, which is not a safe basis for
// keeping a page public even though it isn't (yet) confirmed deleted.
//
// Phase 6G-2A adds the explicit Music Madras approval branch for
// unlisted videos (locked product decision): a "public" video is
// eligible by default; an "unlisted" video is eligible only with
// explicit, separately-recorded approval (unlistedPublicationApprovedAt
// non-null); a "private" video — or any other/absent privacyStatus — has
// NO approval path at all and is never public, regardless of what
// unlistedPublicationApprovedAt holds (it is only ever meaningful for
// "unlisted", and is intentionally never even read for "private").

const AVAILABLE_STATES: ObservabilityState[] = ["OBSERVED"];

export interface YouTubeVideoPagePublicityInput {
  page: {
    status: "DRAFT" | "PUBLISHED";
    archivedAt: Date | null;
    unlistedPublicationApprovedAt: Date | null;
  } | null;
  youtubeVideo: {
    privacyStatus: string | null;
    observabilityState: ObservabilityState;
  } | null;
}

export function isYouTubeVideoPagePublic(input: YouTubeVideoPagePublicityInput): boolean {
  if (!input.page) return false;
  if (input.page.archivedAt !== null) return false;
  if (input.page.status !== "PUBLISHED") return false;

  if (!input.youtubeVideo) return false;
  if (!AVAILABLE_STATES.includes(input.youtubeVideo.observabilityState)) return false;

  if (input.youtubeVideo.privacyStatus === "public") return true;
  if (input.youtubeVideo.privacyStatus === "unlisted") return input.page.unlistedPublicationApprovedAt !== null;
  return false; // "private", any other value, or absent — no approval path, never public
}
