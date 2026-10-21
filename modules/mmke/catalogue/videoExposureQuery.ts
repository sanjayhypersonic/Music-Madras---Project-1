import type { Prisma } from "@prisma/client";
import type { ExposureSurface } from "./videoExposure";

// Phase 6K-3 — the database-side twin of isVideoExposed (videoExposure.ts). The pure function is the specification; this builds the Prisma
// `where` that selects exactly the pages the function would allow, so a list (catalogue, homepage, sitemap, featured, playlists) can filter and
// paginate in SQL instead of loading everything and filtering in memory. tests/integration/videoExposureParity.test.ts proves, over every
// combination of visibility/availability/page state/approvals, that the two always agree — change one and that test fails until both change.
//
// Only Prisma filters are produced here (no raw SQL, no user input), so there is nothing to inject into.

const approved = (scope: "PAGE" | "DISCOVERY" | "PLAYLIST", playlistPageId?: string): Prisma.YouTubeVideoPageWhereInput => ({
  exposureApprovals: { some: { scope, revokedAt: null, ...(scope === "PLAYLIST" ? { playlistPageId: playlistPageId ?? null } : {}) } },
});

/** A page row that exists, is published and not archived, whose video is currently available — the preconditions of every surface. */
const PUBLISHED_AND_AVAILABLE: Prisma.YouTubeVideoPageWhereInput = {
  status: "PUBLISHED",
  archivedAt: null,
  youtubeVideo: { observabilityState: "OBSERVED" },
};

/** A recorded hold on the video denies every surface (the SQL twin of the `hold` rule in isVideoExposed). */
const NO_ACTIVE_HOLD: Prisma.YouTubeVideoPageWhereInput = {
  youtubeVideo: { OR: [{ exposureReview: { is: null } }, { exposureReview: { holdReason: null } }] },
};

export function exposedVideoPageWhere(surface: ExposureSurface): Prisma.YouTubeVideoPageWhereInput {
  const unlistedScopes: Prisma.YouTubeVideoPageWhereInput[] = [{ unlistedPublicationApprovedAt: { not: null } }, approved("PAGE")];
  if (surface.kind === "DISCOVERY") unlistedScopes.push(approved("DISCOVERY"));
  if (surface.kind === "PLAYLIST") unlistedScopes.push(approved("PLAYLIST", surface.playlistPageId));
  return {
    AND: [
      PUBLISHED_AND_AVAILABLE,
      NO_ACTIVE_HOLD,
      {
        OR: [
          { youtubeVideo: { privacyStatus: "public" } },
          { AND: [{ youtubeVideo: { privacyStatus: "unlisted" } }, ...unlistedScopes] },
        ],
      },
    ],
  };
}
