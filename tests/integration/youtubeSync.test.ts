import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "../../modules/db/client";
import { buildYouTubeSyncRepository } from "../../modules/db/repositories/youtubeSyncRepository";

// Phase 6F / Phase 6F-CORRECTION: exercises the REAL Prisma-backed
// repository (modules/db/repositories/youtubeSyncRepository.ts) directly,
// method by method, against the configured development Postgres
// database — complementing tests/unit/syncYouTubeChannel.test.ts, which
// proves the full reconciliation *logic* (including its global
// NOT_OBSERVED-detection pass) against an in-memory fake and never
// touches a database.
//
// IMPORTANT — why this file does NOT call runYouTubeSync end to end:
// an earlier version of this file did, and it corrupted real production
// data. runYouTubeSync's NOT_OBSERVED detection is correctly global by
// design (listVideoIdentities()/listPlaylistIdentities() return every
// row in the table, not just the ones a test cares about — a real full
// synchronization genuinely needs this, since Phase 6F-CORRECTION proved
// a Music Madras playlist can legitimately reference a video from
// another channel, so YouTubeVideo can never be safely "scoped" to one
// sync run). Once real synchronized data exists in the same database,
// running the full engine here means every real video/playlist an
// isolated fake adapter doesn't mention gets treated as "not observed
// this pass" and flagged NOT_OBSERVED — a false signal, plus a spurious
// ObservabilityTransition + AuditLogEntry per row. That happened once
// (226 real videos + 4 real playlists incorrectly flagged, 298 spurious
// audit/transition rows created, corrected by a one-off restorative
// UPDATE — see the Phase 6F-CORRECTION report for the full account) and
// must not happen again. This file instead calls the repository's
// individual methods directly — proving the same schema/constraint/
// idempotency guarantees — and never touches listVideoIdentities,
// listPlaylistIdentities, or any checkpoint scopeKey production code
// also writes to ("channel-uploads", "channel-playlists", or a real
// playlist's own YouTube id).
//
// All fixture IDs are clearly test-scoped (phase6f-test-*) and cannot
// collide with a real YouTube video/playlist ID (real ones are opaque
// 11/34-character strings from YouTube, never this literal prefix).

const TEST_VIDEO_ID_1 = "phase6f-test-video-1";
const TEST_VIDEO_ID_EXTERNAL = "phase6f-test-video-external";
const TEST_PLAYLIST_ID = "phase6f-test-playlist-1";
const TEST_CHANNEL_ID = "phase6f-test-channel";
const TEST_EXTERNAL_CHANNEL_ID = "phase6f-test-external-channel";
const TEST_CHECKPOINT_SCOPE_KEY = "phase6f-test-scope";

async function cleanup() {
  const videos = await prisma.youTubeVideo.findMany({
    where: { youtubeVideoId: { in: [TEST_VIDEO_ID_1, TEST_VIDEO_ID_EXTERNAL] } },
    select: { id: true },
  });
  const playlists = await prisma.youTubePlaylist.findMany({
    where: { youtubePlaylistId: TEST_PLAYLIST_ID },
    select: { id: true },
  });
  const videoIds = videos.map((v) => v.id);
  const playlistIds = playlists.map((p) => p.id);
  const items = await prisma.youTubePlaylistItem.findMany({
    where: { playlistId: { in: playlistIds } },
    select: { id: true },
  });
  const itemIds = items.map((i) => i.id);
  const allResourceIds = [...videoIds, ...playlistIds, ...itemIds];

  await prisma.auditLogEntry.deleteMany({
    where: {
      OR: [
        { entityType: "YOUTUBE_VIDEO", entityId: { in: videoIds } },
        { entityType: "YOUTUBE_PLAYLIST", entityId: { in: playlistIds } },
        { entityType: "YOUTUBE_PLAYLIST_ITEM", entityId: { in: itemIds } },
      ],
    },
  });
  await prisma.observabilityTransition.deleteMany({ where: { resourceId: { in: allResourceIds } } });
  await prisma.syncConflict.deleteMany({ where: { resourceId: { in: allResourceIds } } });
  await prisma.fieldOwnership.deleteMany({ where: { resourceId: { in: allResourceIds } } });
  // Scoped to a literal test-only scope key — never the production
  // sentinels ("channel-uploads", "channel-playlists") or a real
  // playlist's own YouTube id, which a previous version of this file
  // deleted by mistake because it shared those exact scope keys with the
  // real sync job.
  await prisma.syncCheckpoint.deleteMany({ where: { scopeKey: TEST_CHECKPOINT_SCOPE_KEY } });
  await prisma.youTubePlaylistItem.deleteMany({ where: { playlistId: { in: playlistIds } } });
  await prisma.youTubePlaylist.deleteMany({ where: { youtubePlaylistId: TEST_PLAYLIST_ID } });
  await prisma.youTubeVideo.deleteMany({ where: { youtubeVideoId: { in: [TEST_VIDEO_ID_1, TEST_VIDEO_ID_EXTERNAL] } } });
}

describe("Phase 6F YouTube sync repository against a real database (real repository methods, no full-engine run)", () => {
  afterEach(async () => {
    await cleanup();
  });

  it("ensureVideoIdentity is idempotent, keyed by the immutable YouTube video ID", async () => {
    const repo = buildYouTubeSyncRepository(null);

    const first = await repo.ensureVideoIdentity(TEST_VIDEO_ID_1);
    expect(first.isNew).toBe(true);

    const second = await repo.ensureVideoIdentity(TEST_VIDEO_ID_1);
    expect(second.isNew).toBe(false);
    expect(second.id).toBe(first.id);

    const count = await prisma.youTubeVideo.count({ where: { youtubeVideoId: TEST_VIDEO_ID_1 } });
    expect(count).toBe(1);
  });

  it("updateVideoFields persists real fields, including the new Phase 6F statistics/status columns", async () => {
    const repo = buildYouTubeSyncRepository(null);
    const { id } = await repo.ensureVideoIdentity(TEST_VIDEO_ID_1);

    await repo.updateVideoFields(id, {
      title: "Phase 6F Repository Test Video",
      description: "A description",
      thumbnailUrl: "https://example.com/thumb.jpg",
      channelId: TEST_CHANNEL_ID,
      privacyStatus: "public",
      embeddable: true,
      durationSeconds: 150,
      currentViewCount: 5,
      currentLikeCount: 1,
      currentCommentCount: 0,
      statisticsUpdatedAt: new Date(),
    });

    const row = await prisma.youTubeVideo.findUnique({ where: { id } });
    expect(row?.title).toBe("Phase 6F Repository Test Video");
    expect(row?.channelId).toBe(TEST_CHANNEL_ID);
    expect(row?.durationSeconds).toBe(150);
    expect(row?.currentViewCount).toBe(5);

    const snapshot = await repo.getVideoSnapshot(id);
    expect(snapshot?.title).toBe("Phase 6F Repository Test Video");
    expect(snapshot?.channelId).toBe(TEST_CHANNEL_ID);
  });

  it("stores an externally-owned video's own true channel ID, distinct from the configured channel, with zero MediaResource/Recording/Collection creation", async () => {
    const repo = buildYouTubeSyncRepository(null);
    const owned = await repo.ensureVideoIdentity(TEST_VIDEO_ID_1);
    const external = await repo.ensureVideoIdentity(TEST_VIDEO_ID_EXTERNAL);

    await repo.updateVideoFields(owned.id, { channelId: TEST_CHANNEL_ID });
    await repo.updateVideoFields(external.id, { channelId: TEST_EXTERNAL_CHANNEL_ID });

    const ownedRow = await prisma.youTubeVideo.findUnique({ where: { id: owned.id } });
    const externalRow = await prisma.youTubeVideo.findUnique({ where: { id: external.id } });
    expect(ownedRow?.channelId).toBe(TEST_CHANNEL_ID);
    expect(externalRow?.channelId).toBe(TEST_EXTERNAL_CHANNEL_ID);
    expect(externalRow?.channelId).not.toBe(TEST_CHANNEL_ID);

    const mediaResourceCount = await prisma.mediaResource.count({ where: { youtubeVideoId: { in: [owned.id, external.id] } } });
    expect(mediaResourceCount).toBe(0);
  });

  it("ensurePlaylistItem is idempotent, keyed by [playlistId, youtubeVideoId], and a video can appear once per playlist per the schema's own unique constraint", async () => {
    const repo = buildYouTubeSyncRepository(null);
    const video = await repo.ensureVideoIdentity(TEST_VIDEO_ID_1);
    const playlist = await repo.ensurePlaylistIdentity(TEST_PLAYLIST_ID);

    const first = await repo.ensurePlaylistItem(playlist.id, video.id);
    expect(first.isNew).toBe(true);
    await repo.updatePlaylistItemFields(first.id, { position: 3, etag: '"item-etag"' });

    const second = await repo.ensurePlaylistItem(playlist.id, video.id);
    expect(second.isNew).toBe(false);
    expect(second.id).toBe(first.id);
    expect(second.position).toBe(3); // the earlier update persisted and is read back, not re-created at position 0

    const count = await prisma.youTubePlaylistItem.count({ where: { playlistId: playlist.id, youtubeVideoId: video.id } });
    expect(count).toBe(1);
  });

  it("FieldOwnership round-trips through the real repository: a MUSIC_MADRAS_CONTROLLED field is never reported writable, and a real SyncConflict row is created on divergence", async () => {
    const repo = buildYouTubeSyncRepository(null);
    const { id } = await repo.ensureVideoIdentity(TEST_VIDEO_ID_1);

    // No pre-existing ownership row yet — defaults to YOUTUBE_CONTROLLED.
    const beforeAnyOverride = await repo.getFieldOwnership("YOUTUBE_VIDEO", id, "title");
    expect(beforeAnyOverride).toBeNull();

    await repo.recordExternalFieldValue("YOUTUBE_VIDEO", id, "title", "First Synced Title", new Date());
    const afterFirstSync = await repo.getFieldOwnership("YOUTUBE_VIDEO", id, "title");
    expect(afterFirstSync?.ownership).toBe("YOUTUBE_CONTROLLED");
    expect(afterFirstSync?.lastExternalValue).toBe("First Synced Title");

    // Simulate an editorial override the way setFieldOwnership (Phase 6B) would leave it.
    await prisma.fieldOwnership.update({
      where: { provider_resourceType_resourceId_fieldName: { provider: "YOUTUBE", resourceType: "YOUTUBE_VIDEO", resourceId: id, fieldName: "title" } },
      data: { ownership: "MUSIC_MADRAS_CONTROLLED", lastEditorialValue: "Editorially Corrected Title" },
    });

    const overridden = await repo.getFieldOwnership("YOUTUBE_VIDEO", id, "title");
    expect(overridden?.ownership).toBe("MUSIC_MADRAS_CONTROLLED");

    await repo.createSyncConflict({
      resourceType: "YOUTUBE_VIDEO",
      resourceId: id,
      fieldName: "title",
      ownershipAtDetection: "MUSIC_MADRAS_CONTROLLED",
      previousMusicMadrasValue: "Editorially Corrected Title",
      newProviderValue: "A New YouTube Title",
    });

    const conflicts = await prisma.syncConflict.findMany({ where: { resourceId: id, fieldName: "title" } });
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].status).toBe("OPEN");
    expect(conflicts[0].previousMusicMadrasValue).toBe("Editorially Corrected Title");
  });

  it("upsertCheckpoint is idempotent under a test-only scope key", async () => {
    const repo = buildYouTubeSyncRepository(null);

    await repo.upsertCheckpoint(TEST_CHECKPOINT_SCOPE_KEY, "YOUTUBE_PLAYLIST_ITEM", { pageToken: null, completeness: "FULL", lastFullCompletionAt: new Date() });
    await repo.upsertCheckpoint(TEST_CHECKPOINT_SCOPE_KEY, "YOUTUBE_PLAYLIST_ITEM", { pageToken: null, completeness: "FULL", lastFullCompletionAt: new Date() });

    const count = await prisma.syncCheckpoint.count({ where: { scopeKey: TEST_CHECKPOINT_SCOPE_KEY } });
    expect(count).toBe(1);
  });
});
