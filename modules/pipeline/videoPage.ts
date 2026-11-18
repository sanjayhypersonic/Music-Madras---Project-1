// R-34: whether approving a pipeline bundle also puts the VIDEO PAGE (/videos/[slug]) live. Pure. Applied by modules/pipeline/approve.ts and shown
// on the Studio bundle page before the Approve button.
//
// The existing rule (modules/mmke/catalogue/videoExposure.ts): a PUBLIC video's page is exposed when its Music Madras page is PUBLISHED and not
// archived, the video is OBSERVED, and no hold is recorded; it needs no recorded approval (the exposure-approval service refuses public videos:
// "public needs none"). An UNLISTED video needs recorded, scoped approvals through the unlisted-video review; a PRIVATE one is never exposed.
//
// So, with PIPELINE_APPROVE_PUBLIC_VIDEO_PAGE on (the default), approval publishes the video page ONLY when the video is PUBLIC and OBSERVED, there is
// no hold on the video, no hold on its Recording, the planner did not hold the bundle out, and the page is not archived. It is published through the
// existing page-publication service, in the SAME transaction as the Recording's publication, so either both go live or neither does. In every
// other case the video page is left exactly as it is, with the reason shown; an unlisted video is never exposed by this path.

export interface VideoPageFacts {
  privacyStatus: string | null;
  observabilityState: string | null;
  /** The video's recorded hold (rights, copyright, privacy, other), if any. */
  videoHold: string | null;
  /** The linked Recording's hold, if any. */
  recordingHold: string | null;
  /** The bundle was held out by the planner (it cannot be approved anyway). */
  plannerHeld: boolean;
  /** The video's Music Madras page, if one exists. */
  page: { status: string; archivedAt: Date | string | null } | null;
}

export type VideoPagePlan =
  | { action: "PUBLISH"; createPage: boolean; reason: string }
  | { action: "ALREADY_LIVE"; reason: string }
  | { action: "LEAVE"; reason: string };

export const PIPELINE_VIDEO_PAGE_REASON = "approved with pipeline bundle";

export function planVideoPage(facts: VideoPageFacts, options: { enabled: boolean }): VideoPagePlan {
  const leave = (reason: string): VideoPagePlan => ({ action: "LEAVE", reason });
  if (!options.enabled) return leave("PIPELINE_APPROVE_PUBLIC_VIDEO_PAGE is off: publish the video page in Studio → YouTube Videos.");
  if (facts.privacyStatus === "unlisted") return leave("the video is unlisted on YouTube: its page stays pending and needs its own decision in the unlisted-video review (Studio → YouTube Videos).");
  if (facts.privacyStatus !== "public") return leave(`the video is ${facts.privacyStatus ?? "of unknown privacy"} on YouTube: no video page can go live.`);
  if (facts.observabilityState !== "OBSERVED") return leave(`the video was ${facts.observabilityState ?? "not observed"} in the latest sync.`);
  if (facts.videoHold) return leave(`the video has a ${facts.videoHold.toLowerCase()} hold; clear it in Studio first.`);
  if (facts.recordingHold) return leave(`its Recording has a ${facts.recordingHold.toLowerCase()} hold; clear it in Studio first.`);
  if (facts.plannerHeld) return leave("the bundle is held out by the planner.");
  if (facts.page?.archivedAt) return leave("the video page is archived; restore it in Studio first.");
  if (facts.page?.status === "PUBLISHED") return { action: "ALREADY_LIVE", reason: "the video page is already published." };
  return { action: "PUBLISH", createPage: facts.page === null, reason: `public on YouTube, observed, no hold: the video page goes live with the Recording (${facts.page ? "existing draft page" : "a new page"}).` };
}
