// Exports a SMALL, deterministic set of REAL synchronized YouTube records (the
// channel's own public metadata) to tests/fixtures/realYouTubeVideos.json, so the
// editorial-workflow integration test can run on real data without touching the
// real database at test time (Phase 6J-4).
//
//   npx tsx scripts/exportYouTubeWorkflowFixtures.ts
//
// READ-ONLY: it issues SELECTs only and writes one local JSON file. It reads
// whatever DATABASE_URL points at (the real catalogue); the tests never do — they
// load the JSON into the isolated test database. Nothing is written to any database.

import { writeFileSync } from "fs";
import path from "path";
import { prisma } from "../modules/db/client";

// Chosen to cover the workflow's cases (see docs/content-intelligence-architecture.md section 122):
//   zEQmnmwr5UE  rich description with a credits block (conductor, choir, venue, arranger); no playlist
//   m2THfAiraY8  concert programme listing real composers and works; no playlist
//   rfGy3l-BwQI  description naming work/composer/choir/conductor/venue; member of 2 playlists
//   0RQXxX1J79I  NO description at all (the information-gap case)
//   pcksu7PtG8Y  UNLISTED on YouTube (must never become public without explicit approval)
export const WORKFLOW_VIDEO_IDS = ["zEQmnmwr5UE", "m2THfAiraY8", "rfGy3l-BwQI", "0RQXxX1J79I", "pcksu7PtG8Y"] as const;

async function main() {
  const videos = await prisma.youTubeVideo.findMany({
    where: { youtubeVideoId: { in: [...WORKFLOW_VIDEO_IDS] } },
    include: { playlistItems: { include: { playlist: true } } },
  });
  if (videos.length !== WORKFLOW_VIDEO_IDS.length) throw new Error(`Expected ${WORKFLOW_VIDEO_IDS.length} videos, found ${videos.length}.`);

  const playlists = new Map<string, Record<string, unknown>>();
  const out = WORKFLOW_VIDEO_IDS.map((id) => {
    const v = videos.find((video) => video.youtubeVideoId === id)!;
    for (const item of v.playlistItems) {
      const p = item.playlist;
      playlists.set(p.youtubePlaylistId, {
        youtubePlaylistId: p.youtubePlaylistId,
        title: p.title,
        description: p.description,
        channelId: p.channelId,
        thumbnailUrl: p.thumbnailUrl,
        privacyStatus: p.privacyStatus,
        publishedAt: p.publishedAt?.toISOString() ?? null,
      });
    }
    return {
      youtubeVideoId: v.youtubeVideoId,
      title: v.title,
      description: v.description,
      thumbnailUrl: v.thumbnailUrl,
      publishedAt: v.publishedAt?.toISOString() ?? null,
      durationSeconds: v.durationSeconds,
      channelId: v.channelId,
      privacyStatus: v.privacyStatus,
      embeddable: v.embeddable,
      observabilityState: v.observabilityState,
      playlistMemberships: v.playlistItems.map((item) => ({ youtubePlaylistId: item.playlist.youtubePlaylistId, position: item.position })),
    };
  });

  const file = path.resolve(__dirname, "../tests/fixtures/realYouTubeVideos.json");
  writeFileSync(file, JSON.stringify({ videos: out, playlists: [...playlists.values()] }, null, 2) + "\n", "utf8");
  console.log(`Wrote ${path.relative(path.resolve(__dirname, ".."), file)}: ${out.length} videos, ${playlists.size} playlists.`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
