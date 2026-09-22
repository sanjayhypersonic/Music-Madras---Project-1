import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "../../modules/db/client";
import { runYouTubeSync } from "../../modules/youtube/sync-engine/syncYouTubeChannel";
import { buildYouTubeSyncRepository } from "../../modules/db/repositories/youtubeSyncRepository";
import type { YouTubeDataAdapter, YouTubePageResult, YouTubePlaylistItemRecord, YouTubePlaylistRecord, YouTubeVideoRecord } from "../../modules/youtube/adapter";

// Phase 6F: exercises the REAL Prisma-backed repository
// (modules/db/repositories/youtubeSyncRepository.ts) end to end against
// the configured development Postgres database — complementing
// tests/unit/syncYouTubeChannel.test.ts, which proves the reconciliation
// *logic* against an in-memory fake and never touches a database. This
// file proves the actual schema/unique-constraints/repository wiring
// works: idempotent upserts, the [playlistId, youtubeVideoId] unique
// constraint, and FieldOwnership/SyncConflict/ObservabilityTransition/
// SyncCheckpoint all persisting correctly. The adapter is still a fake
// (no real network call, no YouTube quota spent) — only the database is
// real, per tests/integration/README.md's own convention.
//
// All fixture IDs are clearly test-scoped (phase6f-test-*) and cannot
// collide with a real YouTube video/playlist ID (real ones are opaque
// 11/34-character strings from YouTube, never this literal prefix).

const TEST_VIDEO_ID_1 = "phase6f-test-video-1";
const TEST_VIDEO_ID_2 = "phase6f-test-video-2";
const TEST_PLAYLIST_ID = "phase6f-test-playlist-1";
const TEST_UPLOADS_PLAYLIST_ID = "phase6f-test-uploads";
const TEST_CHANNEL_ID = "phase6f-test-channel";

function makeVideo(videoId: string, title: string): YouTubeVideoRecord {
  return {
    videoId,
    title,
    description: "A test description",
    thumbnails: { high: { url: `https://example.com/${videoId}.jpg` } },
    publishedAt: "2025-01-01T00:00:00Z",
    durationIso8601: "PT2M30S",
    channelId: TEST_CHANNEL_ID,
    channelTitle: "Phase 6F Test Channel",
    privacyStatus: "public",
    uploadStatus: "processed",
    embeddable: true,
    viewCount: "5",
    likeCount: "1",
    commentCount: "0",
    etag: `"etag-${videoId}"`,
  };
}

class FakeAdapter implements YouTubeDataAdapter {
  constructor(
    private readonly uploadsItems: YouTubePlaylistItemRecord[],
    private readonly playlists: YouTubePlaylistRecord[],
    private readonly playlistItems: Map<string, YouTubePlaylistItemRecord[]>,
    private readonly videos: Map<string, YouTubeVideoRecord>
  ) {}

  async getChannel() {
    return { channelId: TEST_CHANNEL_ID, title: "Phase 6F Test Channel", uploadsPlaylistId: TEST_UPLOADS_PLAYLIST_ID, etag: '"channel"' };
  }

  async listPlaylists(): Promise<YouTubePageResult<YouTubePlaylistRecord>> {
    return { items: this.playlists, nextPageToken: null };
  }

  async listPlaylistItems(playlistId: string): Promise<YouTubePageResult<YouTubePlaylistItemRecord>> {
    if (playlistId === TEST_UPLOADS_PLAYLIST_ID) return { items: this.uploadsItems, nextPageToken: null };
    return { items: this.playlistItems.get(playlistId) ?? [], nextPageToken: null };
  }

  async listVideos(videoIds: string[]): Promise<YouTubeVideoRecord[]> {
    return videoIds.map((id) => this.videos.get(id)).filter((v): v is YouTubeVideoRecord => Boolean(v));
  }
}

async function cleanup() {
  const videos = await prisma.youTubeVideo.findMany({
    where: { youtubeVideoId: { in: [TEST_VIDEO_ID_1, TEST_VIDEO_ID_2] } },
    select: { id: true },
  });
  const playlists = await prisma.youTubePlaylist.findMany({
    where: { youtubePlaylistId: TEST_PLAYLIST_ID },
    select: { id: true },
  });
  const videoIds = videos.map((v) => v.id);
  const playlistIds = playlists.map((p) => p.id);

  await prisma.auditLogEntry.deleteMany({
    where: {
      OR: [
        { entityType: "YOUTUBE_VIDEO", entityId: { in: videoIds } },
        { entityType: "YOUTUBE_PLAYLIST", entityId: { in: playlistIds } },
      ],
    },
  });
  await prisma.observabilityTransition.deleteMany({
    where: { OR: [{ resourceId: { in: videoIds } }, { resourceId: { in: playlistIds } }] },
  });
  await prisma.syncConflict.deleteMany({
    where: { OR: [{ resourceId: { in: videoIds } }, { resourceId: { in: playlistIds } }] },
  });
  await prisma.fieldOwnership.deleteMany({
    where: { OR: [{ resourceId: { in: videoIds } }, { resourceId: { in: playlistIds } }] },
  });
  await prisma.syncCheckpoint.deleteMany({
    where: { scopeKey: { in: ["channel-uploads", "channel-playlists", TEST_PLAYLIST_ID] } },
  });
  await prisma.youTubePlaylistItem.deleteMany({ where: { playlistId: { in: playlistIds } } });
  await prisma.youTubePlaylist.deleteMany({ where: { youtubePlaylistId: TEST_PLAYLIST_ID } });
  await prisma.youTubeVideo.deleteMany({ where: { youtubeVideoId: { in: [TEST_VIDEO_ID_1, TEST_VIDEO_ID_2] } } });
}

describe("Phase 6F YouTube sync against a real database (fake adapter, real repository)", () => {
  afterEach(async () => {
    await cleanup();
  });

  it("creates a video, a playlist, and a membership row on first sync, and is fully idempotent on a second run", async () => {
    const videos = new Map([
      [TEST_VIDEO_ID_1, makeVideo(TEST_VIDEO_ID_1, "Phase 6F Integration Test Video 1")],
      [TEST_VIDEO_ID_2, makeVideo(TEST_VIDEO_ID_2, "Phase 6F Integration Test Video 2")],
    ]);
    const uploadsItems: YouTubePlaylistItemRecord[] = [
      { playlistId: TEST_UPLOADS_PLAYLIST_ID, videoId: TEST_VIDEO_ID_1, position: 0, title: null, publishedAt: null, etag: '"u1"' },
      { playlistId: TEST_UPLOADS_PLAYLIST_ID, videoId: TEST_VIDEO_ID_2, position: 1, title: null, publishedAt: null, etag: '"u2"' },
    ];
    const playlists: YouTubePlaylistRecord[] = [
      {
        playlistId: TEST_PLAYLIST_ID,
        title: "Phase 6F Test Playlist",
        description: null,
        publishedAt: "2025-01-01T00:00:00Z",
        privacyStatus: "public",
        channelId: TEST_CHANNEL_ID,
        thumbnails: {},
        etag: '"pl"',
      },
    ];
    const playlistItems = new Map<string, YouTubePlaylistItemRecord[]>([
      [TEST_PLAYLIST_ID, [{ playlistId: TEST_PLAYLIST_ID, videoId: TEST_VIDEO_ID_1, position: 0, title: null, publishedAt: null, etag: '"i1"' }]],
    ]);

    const adapter = new FakeAdapter(uploadsItems, playlists, playlistItems, videos);
    const repository = buildYouTubeSyncRepository(null);
    const now = new Date();

    const first = await runYouTubeSync(adapter, repository, { channelId: TEST_CHANNEL_ID, now });
    expect(first.completeness).toBe("FULL");
    expect(first.videos.created).toBe(2);
    expect(first.playlists.created).toBe(1);
    expect(first.playlistItems.created).toBe(1);

    const videoRow = await prisma.youTubeVideo.findUnique({ where: { youtubeVideoId: TEST_VIDEO_ID_1 } });
    expect(videoRow?.title).toBe("Phase 6F Integration Test Video 1");
    expect(videoRow?.durationSeconds).toBe(150);
    expect(videoRow?.currentViewCount).toBe(5);

    const playlistRow = await prisma.youTubePlaylist.findUnique({ where: { youtubePlaylistId: TEST_PLAYLIST_ID } });
    expect(playlistRow?.title).toBe("Phase 6F Test Playlist");

    const itemRows = await prisma.youTubePlaylistItem.findMany({ where: { playlistId: playlistRow!.id } });
    expect(itemRows).toHaveLength(1);

    // Second run, same inputs — must not duplicate anything.
    const second = await runYouTubeSync(adapter, repository, { channelId: TEST_CHANNEL_ID, now: new Date(now.getTime() + 1000) });
    expect(second.videos.created).toBe(0);
    expect(second.playlists.created).toBe(0);
    expect(second.playlistItems.created).toBe(0);
    expect(second.videos.unchanged).toBe(2);
    expect(second.playlists.unchanged).toBe(1);
    expect(second.playlistItems.unchanged).toBe(1);

    const videoCountAfter = await prisma.youTubeVideo.count({ where: { youtubeVideoId: { in: [TEST_VIDEO_ID_1, TEST_VIDEO_ID_2] } } });
    expect(videoCountAfter).toBe(2);
    const itemCountAfter = await prisma.youTubePlaylistItem.count({ where: { playlistId: playlistRow!.id } });
    expect(itemCountAfter).toBe(1);
  });
});
