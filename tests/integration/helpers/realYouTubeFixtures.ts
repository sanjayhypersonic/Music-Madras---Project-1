import { readFileSync } from "fs";
import path from "path";
import { prisma } from "../../../modules/db/client";
import { importYouTubeMirror } from "../../../modules/db/repositories/stagingSeedRepository";

// Phase 6J-4 — loads the small set of REAL synchronized YouTube records exported
// by scripts/exportYouTubeWorkflowFixtures.ts (tests/fixtures/realYouTubeVideos.json)
// into the isolated test database. The test database starts empty (Phase 6J-2), so
// this is how a workflow test gets real titles, descriptions, durations, thumbnails,
// privacy states and playlist memberships without depending on, or ever touching,
// the real database. The records are inserted exactly as exported — never edited.

interface FixtureVideo {
  youtubeVideoId: string;
  title: string | null;
  description: string | null;
  thumbnailUrl: string | null;
  publishedAt: string | null;
  durationSeconds: number | null;
  channelId: string | null;
  privacyStatus: string | null;
  embeddable: boolean | null;
  observabilityState: "OBSERVED";
  playlistMemberships: { youtubePlaylistId: string; position: number }[];
}
interface FixturePlaylist {
  youtubePlaylistId: string;
  title: string | null;
  description: string | null;
  channelId: string | null;
  thumbnailUrl: string | null;
  privacyStatus: string | null;
  publishedAt: string | null;
}

const file = path.resolve(__dirname, "../../fixtures/realYouTubeVideos.json");
export const REAL_FIXTURES = JSON.parse(readFileSync(file, "utf8")) as { videos: FixtureVideo[]; playlists: FixturePlaylist[] };

export const REAL_VIDEO = {
  /** Credits block (conductor, choir, venue, arranger) in the description; not in any playlist. */
  DINGIRI: "zEQmnmwr5UE",
  /** Concert programme listing four real works by Mozart and Verdi; not in any playlist. */
  MOZART_VERDI: "m2THfAiraY8",
  /** Names its work, composer, choir, conductor and venue; belongs to two playlists. */
  PROMISE: "rfGy3l-BwQI",
  /** No description at all — the information-gap case. */
  NO_DESCRIPTION: "0RQXxX1J79I",
  /** Unlisted on YouTube. */
  UNLISTED: "pcksu7PtG8Y",
} as const;

export function realVideo(youtubeVideoId: string): FixtureVideo {
  const video = REAL_FIXTURES.videos.find((v) => v.youtubeVideoId === youtubeVideoId);
  if (!video) throw new Error(`No fixture for ${youtubeVideoId}`);
  return video;
}

/**
 * Inserts the fixtures (idempotent) and returns each video's internal id by YouTube id. Since the staging content loader, the one implementation of this import is
 * modules/db/repositories/stagingSeedRepository.ts (importYouTubeMirror): it is the same insert-only upserts, now in one transaction.
 */
export async function loadRealYouTubeFixtures(): Promise<Map<string, string>> {
  return (await importYouTubeMirror(REAL_FIXTURES)).videoIds;
}
/** Removes ONLY the fixture rows (and their dependants) — never any other video. */
export async function removeRealYouTubeFixtures(): Promise<void> {
  const youtubeIds = REAL_FIXTURES.videos.map((v) => v.youtubeVideoId);
  const rows = await prisma.youTubeVideo.findMany({ where: { youtubeVideoId: { in: youtubeIds } }, select: { id: true } });
  const internal = rows.map((r) => r.id);
  if (internal.length > 0) {
    const pages = await prisma.youTubeVideoPage.findMany({ where: { youtubeVideoId: { in: internal } }, select: { id: true } });
    if (pages.length > 0) await prisma.auditLogEntry.deleteMany({ where: { entityType: "YouTubeVideoPage", entityId: { in: pages.map((p) => p.id) } } });
    await prisma.mediaResource.deleteMany({ where: { youtubeVideoId: { in: internal } } });
    await prisma.youTubeVideo.deleteMany({ where: { id: { in: internal } } });
  }
  await prisma.youTubePlaylist.deleteMany({ where: { youtubePlaylistId: { in: REAL_FIXTURES.playlists.map((p) => p.youtubePlaylistId) } } });
}
