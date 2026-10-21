import type { ObservabilityState } from "@prisma/client";
import { isYouTubeVideoPagePublic } from "./isYouTubeVideoPagePublic";

// Phase 6K-2 — the SHARED eligibility service for public exposure of a YouTube video's Music Madras page. One pure function answers
// "may this video be exposed on this surface?", and every public surface (video page, catalogue, search, sitemap, homepage, featured,
// entity "related videos", playlists) must go through it — or through a database query proven equivalent by a parity test.
//
// Surfaces:
//   PAGE       the public page at /videos/[slug] (reachable by its URL).
//   DISCOVERY  being LISTED: catalogue, search, facets and counts, sitemap, homepage, featured, related-video sections, structured data.
//   PLAYLIST   being a member shown on one specific public Music Madras playlist page.
//
// Rules (all start from the existing single predicate, isYouTubeVideoPagePublic: published, unarchived page; video OBSERVED):
//   public video     PAGE and DISCOVERY follow from the published page. PLAYLIST additionally needs the page to be an approved member of
//                    that playlist (curated membership is a playlist-page concern, outside this function).
//   unlisted video   every surface needs an explicit, recorded, ACTIVE approval of that scope: PAGE (the legacy flag AND its approval
//                    row), DISCOVERY, or PLAYLIST for that playlist page. DISCOVERY and PLAYLIST also require the page to be exposed.
//   private / other  never exposed. No approval path exists.
// An active rights, copyright, privacy or other HOLD on the video (modules/db/repositories/unlistedReviewRepository.ts) denies EVERY surface, for
// every video — public or unlisted — whatever approvals exist. It is part of this one function (and of its SQL twin), so no public route can
// forget it. Clearing a hold never approves anything: approvals revoked by the hold stay revoked and re-approval is explicit.
// An approval is never inferred from YouTube playlist membership, from AI, or from a setting.

export type ExposureHoldName = "RIGHTS" | "COPYRIGHT" | "PRIVACY" | "OTHER";

export type ExposureScopeName = "PAGE" | "DISCOVERY" | "PLAYLIST";

export type ExposureSurface = { kind: "PAGE" } | { kind: "DISCOVERY" } | { kind: "PLAYLIST"; playlistPageId: string };

export interface ActiveApproval {
  scope: ExposureScopeName;
  playlistPageId: string | null;
}

export interface VideoExposureFacts {
  page: { status: "DRAFT" | "PUBLISHED"; archivedAt: Date | null; unlistedPublicationApprovedAt: Date | null } | null;
  youtubeVideo: { privacyStatus: string | null; observabilityState: ObservabilityState } | null;
  /** The page's UNREVOKED approvals (revoked rows must not be passed in). */
  activeApprovals: readonly ActiveApproval[];
  /** The video's active hold, if any (null when none). A hold denies every surface. */
  hold: ExposureHoldName | null;
}

function hasApproval(facts: VideoExposureFacts, scope: ExposureScopeName, playlistPageId: string | null = null): boolean {
  return facts.activeApprovals.some((a) => a.scope === scope && (scope !== "PLAYLIST" || a.playlistPageId === playlistPageId));
}

export function isVideoExposed(facts: VideoExposureFacts, surface: ExposureSurface): boolean {
  if (facts.hold !== null) return false;
  // The page itself must be publicly eligible. For an unlisted video the legacy flag alone is not enough: the recorded PAGE approval must exist too.
  if (!isYouTubeVideoPagePublic({ page: facts.page, youtubeVideo: facts.youtubeVideo })) return false;
  const privacy = facts.youtubeVideo?.privacyStatus;
  if (privacy === "public") return true;
  if (privacy !== "unlisted") return false; // unreachable after the check above, kept so the function is correct on its own
  if (!hasApproval(facts, "PAGE")) return false;
  if (surface.kind === "PAGE") return true;
  if (surface.kind === "DISCOVERY") return hasApproval(facts, "DISCOVERY");
  return hasApproval(facts, "PLAYLIST", surface.playlistPageId);
}

export interface ExposureExplanation {
  surface: "PAGE" | "DISCOVERY";
  allowed: boolean;
  reason: string;
}

/** Why a video is or is not exposed — for Studio, so an editor can see what is missing. Mirrors isVideoExposed exactly. */
export function explainVideoExposure(facts: VideoExposureFacts): ExposureExplanation[] {
  const explain = (surface: "PAGE" | "DISCOVERY"): ExposureExplanation => {
    const allowed = isVideoExposed(facts, { kind: surface });
    if (facts.hold !== null) return { surface, allowed, reason: `A ${facts.hold.toLowerCase()} hold is in place on this video, so it cannot be shown anywhere on the public Museum until the hold is cleared.` };
    if (allowed) return { surface, allowed, reason: facts.youtubeVideo?.privacyStatus === "public" ? "The video is public and its page is published." : "Approved by an editor, and the page is published." };
    if (!facts.page) return { surface, allowed, reason: "No Music Madras page exists yet." };
    if (facts.page.archivedAt) return { surface, allowed, reason: "The page is archived." };
    if (facts.page.status !== "PUBLISHED") return { surface, allowed, reason: "The page is not published." };
    if (!facts.youtubeVideo || facts.youtubeVideo.observabilityState !== "OBSERVED") return { surface, allowed, reason: "The video is not currently available on YouTube." };
    const privacy = facts.youtubeVideo.privacyStatus;
    if (privacy === "unlisted") {
      if (!hasApproval(facts, "PAGE")) return { surface, allowed, reason: "The video is unlisted on YouTube and has no recorded approval for a public Music Madras page." };
      return { surface, allowed, reason: "The page is approved, but the video has no approval to be listed in the catalogue, search and sitemap." };
    }
    return { surface, allowed, reason: "The video is private on YouTube; it can never be shown publicly." };
  };
  return [explain("PAGE"), explain("DISCOVERY")];
}
