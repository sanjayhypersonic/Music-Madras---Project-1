import type { ObservabilityState } from "@prisma/client";

// Phase 6G-1B (pre-flight §6, brief §5) — the three-axis public-visibility
// gate for a YouTubeVideoPage, evaluated at read time, never persisted as
// a combined enum. This exists specifically so that a video Music Madras
// already published can never render publicly again once YouTube itself
// makes it unlisted/private/unavailable, without any code remembering to
// re-check that on every future call site — findPublishedBySlug (the only
// sanctioned "give me a public page" query) always goes through this.
//
// Only ObservabilityState.OBSERVED counts as "not unavailable/deleted."
// The sync engine (Phase 6F) only ever writes OBSERVED/NOT_OBSERVED today,
// never PRIVATE/UNLISTED/UNAVAILABLE/DELETED/SYNC_ERROR — but NOT_OBSERVED
// itself is disqualifying here: it means the video was absent from the
// most recent full synchronization pass, which is not a safe basis for
// keeping a page public even though it isn't (yet) confirmed deleted.

const AVAILABLE_STATES: ObservabilityState[] = ["OBSERVED"];

export interface YouTubeVideoPagePublicityInput {
  page: {
    status: "DRAFT" | "PUBLISHED";
    archivedAt: Date | null;
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
  if (input.youtubeVideo.privacyStatus !== "public") return false;
  if (!AVAILABLE_STATES.includes(input.youtubeVideo.observabilityState)) return false;

  return true;
}
