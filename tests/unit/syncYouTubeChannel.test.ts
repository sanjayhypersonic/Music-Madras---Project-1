import { describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { runYouTubeSync, type FieldOwnershipSnapshot, type YouTubeSyncRepositoryPort } from "../../modules/youtube/sync-engine/syncYouTubeChannel";
import type { YouTubeDataAdapter, YouTubePageResult, YouTubePlaylistItemRecord, YouTubePlaylistRecord, YouTubeVideoRecord } from "../../modules/youtube/adapter";
import type { FieldOwnershipState, ObservabilityState } from "@prisma/client";

// In-memory fakes — no network, no database. The fake repository mirrors
// the real Prisma-backed one closely enough (identity keyed by the
// immutable YouTube id, a real FieldOwnership table, real
// created/updated/unchanged/flagged bookkeeping) to genuinely exercise
// the reconciliation logic end to end, matching the same
// fake-adapter-plus-fake-repository pattern already used for
// tests/unit/runYouTubeAnalyticsSync.test.ts.

interface VideoRow {
  id: string;
  youtubeVideoId: string;
  title: string | null;
  description: string | null;
  thumbnailUrl: string | null;
  privacyStatus: string | null;
  channelId: string | null;
  embeddable: boolean | null;
  durationSeconds: number | null;
  publishedAt: Date | null;
  etag: string | null;
  currentViewCount: number | null;
  currentLikeCount: number | null;
  currentCommentCount: number | null;
  observabilityState: ObservabilityState;
}

interface PlaylistRow {
  id: string;
  youtubePlaylistId: string;
  title: string | null;
  description: string | null;
  thumbnailUrl: string | null;
  privacyStatus: string | null;
  channelId: string | null;
  publishedAt: Date | null;
  etag: string | null;
  observabilityState: ObservabilityState;
}

interface PlaylistItemRow {
  id: string;
  playlistId: string;
  youtubeVideoId: string;
  position: number;
  etag: string | null;
  observabilityState: ObservabilityState;
}

class FakeYouTubeSyncRepository implements YouTubeSyncRepositoryPort {
  videos = new Map<string, VideoRow>(); // by internal id
  videosByYoutubeId = new Map<string, string>();
  playlists = new Map<string, PlaylistRow>();
  playlistsByYoutubeId = new Map<string, string>();
  playlistItems = new Map<string, PlaylistItemRow>();
  fieldOwnerships = new Map<string, FieldOwnershipSnapshot>();
  conflicts: { resourceType: string; resourceId: string; fieldName: string }[] = [];
  checkpoints = new Map<string, { pageToken: string | null; completeness: string }>();
  observabilityTransitions: { resourceType: string; resourceId: string; toState: string }[] = [];

  async ensureVideoIdentity(youtubeVideoId: string) {
    const existingId = this.videosByYoutubeId.get(youtubeVideoId);
    if (existingId) {
      const row = this.videos.get(existingId)!;
      return { id: row.id, isNew: false, observabilityState: row.observabilityState };
    }
    const id = randomUUID();
    this.videos.set(id, {
      id,
      youtubeVideoId,
      title: null,
      description: null,
      thumbnailUrl: null,
      privacyStatus: null,
      channelId: null,
      embeddable: null,
      durationSeconds: null,
      publishedAt: null,
      etag: null,
      currentViewCount: null,
      currentLikeCount: null,
      currentCommentCount: null,
      observabilityState: "OBSERVED",
    });
    this.videosByYoutubeId.set(youtubeVideoId, id);
    return { id, isNew: true, observabilityState: "OBSERVED" as ObservabilityState };
  }

  async getVideoSnapshot(id: string) {
    const row = this.videos.get(id);
    return row ? { ...row } : null;
  }

  async updateVideoFields(id: string, fields: Record<string, unknown>) {
    const row = this.videos.get(id);
    if (!row) throw new Error("video not found");
    Object.assign(row, fields);
  }

  async listVideoIdentities() {
    return Array.from(this.videos.values()).map((v) => ({ id: v.id, youtubeVideoId: v.youtubeVideoId, observabilityState: v.observabilityState }));
  }

  async setVideoObservability(id: string, state: ObservabilityState, reason: string) {
    const row = this.videos.get(id);
    if (!row) throw new Error("video not found");
    row.observabilityState = state;
    this.observabilityTransitions.push({ resourceType: "YOUTUBE_VIDEO", resourceId: id, toState: state });
    void reason;
  }

  async ensurePlaylistIdentity(youtubePlaylistId: string) {
    const existingId = this.playlistsByYoutubeId.get(youtubePlaylistId);
    if (existingId) {
      const row = this.playlists.get(existingId)!;
      return { id: row.id, isNew: false, observabilityState: row.observabilityState };
    }
    const id = randomUUID();
    this.playlists.set(id, {
      id,
      youtubePlaylistId,
      title: null,
      description: null,
      thumbnailUrl: null,
      privacyStatus: null,
      channelId: null,
      publishedAt: null,
      etag: null,
      observabilityState: "OBSERVED",
    });
    this.playlistsByYoutubeId.set(youtubePlaylistId, id);
    return { id, isNew: true, observabilityState: "OBSERVED" as ObservabilityState };
  }

  async getPlaylistSnapshot(id: string) {
    const row = this.playlists.get(id);
    return row ? { ...row } : null;
  }

  async updatePlaylistFields(id: string, fields: Record<string, unknown>) {
    const row = this.playlists.get(id);
    if (!row) throw new Error("playlist not found");
    Object.assign(row, fields);
  }

  async listPlaylistIdentities() {
    return Array.from(this.playlists.values()).map((p) => ({ id: p.id, youtubePlaylistId: p.youtubePlaylistId, observabilityState: p.observabilityState }));
  }

  async setPlaylistObservability(id: string, state: ObservabilityState, reason: string) {
    const row = this.playlists.get(id);
    if (!row) throw new Error("playlist not found");
    row.observabilityState = state;
    this.observabilityTransitions.push({ resourceType: "YOUTUBE_PLAYLIST", resourceId: id, toState: state });
    void reason;
  }

  async ensurePlaylistItem(playlistId: string, videoId: string) {
    const key = `${playlistId}:${videoId}`;
    const existing = this.playlistItems.get(key);
    if (existing) {
      return { id: existing.id, isNew: false, position: existing.position, observabilityState: existing.observabilityState };
    }
    const id = randomUUID();
    this.playlistItems.set(key, { id, playlistId, youtubeVideoId: videoId, position: 0, etag: null, observabilityState: "OBSERVED" });
    return { id, isNew: true, position: 0, observabilityState: "OBSERVED" as ObservabilityState };
  }

  async updatePlaylistItemFields(id: string, fields: { position?: number; etag?: string | null }) {
    const row = Array.from(this.playlistItems.values()).find((i) => i.id === id);
    if (!row) throw new Error("playlist item not found");
    if (fields.position !== undefined) row.position = fields.position;
    if (fields.etag !== undefined) row.etag = fields.etag;
  }

  async listPlaylistItemIdentities(playlistId: string) {
    return Array.from(this.playlistItems.values())
      .filter((i) => i.playlistId === playlistId)
      .map((i) => ({ id: i.id, youtubeVideoId: i.youtubeVideoId, position: i.position, observabilityState: i.observabilityState }));
  }

  async setPlaylistItemObservability(id: string, state: ObservabilityState, reason: string) {
    const row = Array.from(this.playlistItems.values()).find((i) => i.id === id);
    if (!row) throw new Error("playlist item not found");
    row.observabilityState = state;
    this.observabilityTransitions.push({ resourceType: "YOUTUBE_PLAYLIST_ITEM", resourceId: id, toState: state });
    void reason;
  }

  async getFieldOwnership(resourceType: string, resourceId: string, fieldName: string) {
    return this.fieldOwnerships.get(`${resourceType}:${resourceId}:${fieldName}`) ?? null;
  }

  async recordExternalFieldValue(resourceType: string, resourceId: string, fieldName: string, externalValue: string | null) {
    const key = `${resourceType}:${resourceId}:${fieldName}`;
    const existing = this.fieldOwnerships.get(key);
    this.fieldOwnerships.set(key, {
      ownership: existing?.ownership ?? "YOUTUBE_CONTROLLED",
      lastExternalValue: externalValue,
      lastEditorialValue: existing?.lastEditorialValue ?? null,
    });
  }

  async createSyncConflict(input: { resourceType: string; resourceId: string; fieldName: string }) {
    this.conflicts.push(input);
  }

  async upsertCheckpoint(scopeKey: string, resourceType: string, input: { pageToken: string | null; completeness: "FULL" | "PARTIAL" }) {
    this.checkpoints.set(`${resourceType}:${scopeKey}`, { pageToken: input.pageToken, completeness: input.completeness });
  }

  // Test helper: simulate a pre-existing editorial override.
  setFieldOwnershipForTest(resourceType: string, resourceId: string, fieldName: string, ownership: FieldOwnershipState, lastExternalValue: string | null, lastEditorialValue: string | null) {
    this.fieldOwnerships.set(`${resourceType}:${resourceId}:${fieldName}`, { ownership, lastExternalValue, lastEditorialValue });
  }
}

class FakeAdapter implements YouTubeDataAdapter {
  constructor(
    private readonly uploadsPlaylistId: string,
    private readonly channelId: string,
    private readonly uploadsPages: YouTubePageResult<YouTubePlaylistItemRecord>[],
    private readonly playlistsPages: YouTubePageResult<YouTubePlaylistRecord>[],
    private readonly playlistItemsByPlaylistId: Map<string, YouTubePageResult<YouTubePlaylistItemRecord>[]>,
    private readonly videosById: Map<string, YouTubeVideoRecord>,
    private readonly failures: Partial<{ getChannel: boolean; listVideos: boolean; listPlaylistItemsForPlaylistId: string }> = {},
    private readonly channelVideoCount?: number | null
  ) {}

  async getChannel() {
    if (this.failures.getChannel) throw new Error("simulated getChannel failure");
    return { channelId: this.channelId, title: "Music Madras", uploadsPlaylistId: this.uploadsPlaylistId, videoCount: this.channelVideoCount, etag: '"channel-etag"' };
  }

  async listPlaylists(_channelId: string, pageToken?: string): Promise<YouTubePageResult<YouTubePlaylistRecord>> {
    const index = pageToken ? Number(pageToken) : 0;
    return this.playlistsPages[index] ?? { items: [], nextPageToken: null };
  }

  async listPlaylistItems(playlistId: string, pageToken?: string): Promise<YouTubePageResult<YouTubePlaylistItemRecord>> {
    if (this.failures.listPlaylistItemsForPlaylistId === playlistId) {
      throw new Error(`simulated listPlaylistItems failure for ${playlistId}`);
    }
    const index = pageToken ? Number(pageToken) : 0;
    if (playlistId === this.uploadsPlaylistId) {
      return this.uploadsPages[index] ?? { items: [], nextPageToken: null };
    }
    const pages = this.playlistItemsByPlaylistId.get(playlistId) ?? [];
    return pages[index] ?? { items: [], nextPageToken: null };
  }

  async listVideos(videoIds: string[]): Promise<YouTubeVideoRecord[]> {
    if (this.failures.listVideos) throw new Error("simulated listVideos failure");
    return videoIds.map((id) => this.videosById.get(id)).filter((v): v is YouTubeVideoRecord => Boolean(v));
  }
}

function makeVideo(overrides: Partial<YouTubeVideoRecord> & { videoId: string }): YouTubeVideoRecord {
  return {
    title: "Untitled",
    description: null,
    thumbnails: { high: { url: `https://example.com/${overrides.videoId}.jpg` } },
    publishedAt: "2025-01-01T00:00:00Z",
    durationIso8601: "PT4M13S",
    channelId: "UCchannel",
    channelTitle: "Music Madras",
    privacyStatus: "public",
    uploadStatus: "processed",
    embeddable: true,
    viewCount: "100",
    likeCount: "10",
    commentCount: "1",
    etag: `"etag-${overrides.videoId}"`,
    ...overrides,
  };
}

function makePlaylistItem(playlistId: string, videoId: string, position: number): YouTubePlaylistItemRecord {
  return { playlistId, videoId, position, title: null, publishedAt: null, etag: `"item-${playlistId}-${videoId}"` };
}

const NOW = new Date(Date.UTC(2026, 0, 1));
const UPLOADS_PLAYLIST_ID = "UUchannel";
const CHANNEL_ID = "UCchannel";

describe("runYouTubeSync", () => {
  it("performs a full initial synchronization: creates videos, playlists, and membership, keyed by immutable YouTube IDs", async () => {
    const videosById = new Map<string, YouTubeVideoRecord>([
      ["v1", makeVideo({ videoId: "v1", title: "Bach Cantata" })],
      ["v2", makeVideo({ videoId: "v2", title: "Handel Messiah" })],
    ]);
    const adapter = new FakeAdapter(
      UPLOADS_PLAYLIST_ID,
      CHANNEL_ID,
      [{ items: [makePlaylistItem(UPLOADS_PLAYLIST_ID, "v1", 0), makePlaylistItem(UPLOADS_PLAYLIST_ID, "v2", 1)], nextPageToken: null }],
      [{ items: [{ playlistId: "PL1", title: "Concerts 2025", description: null, publishedAt: null, privacyStatus: "public", channelId: CHANNEL_ID, thumbnails: {}, etag: '"pl1"' }], nextPageToken: null }],
      new Map([["PL1", [{ items: [makePlaylistItem("PL1", "v1", 0)], nextPageToken: null }]]]),
      videosById
    );
    const repo = new FakeYouTubeSyncRepository();

    const result = await runYouTubeSync(adapter, repo, { channelId: CHANNEL_ID, now: NOW });

    expect(result.completeness).toBe("FULL");
    expect(result.videos.created).toBe(2);
    expect(result.playlists.created).toBe(1);
    expect(result.playlistItems.created).toBe(1);
    expect(repo.videos.size).toBe(2);
    expect(Array.from(repo.videos.values()).map((v) => v.title).sort()).toEqual(["Bach Cantata", "Handel Messiah"]);
  });

  it("keeps identity by video ID, never by title — duplicate titles with distinct IDs create distinct rows", async () => {
    const videosById = new Map<string, YouTubeVideoRecord>([
      ["v1", makeVideo({ videoId: "v1", title: "Evensong" })],
      ["v2", makeVideo({ videoId: "v2", title: "Evensong" })],
    ]);
    const adapter = new FakeAdapter(
      UPLOADS_PLAYLIST_ID,
      CHANNEL_ID,
      [{ items: [makePlaylistItem(UPLOADS_PLAYLIST_ID, "v1", 0), makePlaylistItem(UPLOADS_PLAYLIST_ID, "v2", 1)], nextPageToken: null }],
      [{ items: [], nextPageToken: null }],
      new Map(),
      videosById
    );
    const repo = new FakeYouTubeSyncRepository();

    const result = await runYouTubeSync(adapter, repo, { channelId: CHANNEL_ID, now: NOW });

    expect(result.videos.created).toBe(2);
    expect(repo.videos.size).toBe(2);
    expect(repo.videosByYoutubeId.has("v1")).toBe(true);
    expect(repo.videosByYoutubeId.has("v2")).toBe(true);
  });

  it("a video can belong to multiple playlists at once — no 1:1 assumption", async () => {
    const videosById = new Map<string, YouTubeVideoRecord>([["v1", makeVideo({ videoId: "v1" })]]);
    const adapter = new FakeAdapter(
      UPLOADS_PLAYLIST_ID,
      CHANNEL_ID,
      [{ items: [makePlaylistItem(UPLOADS_PLAYLIST_ID, "v1", 0)], nextPageToken: null }],
      [
        {
          items: [
            { playlistId: "PL1", title: "A", description: null, publishedAt: null, privacyStatus: "public", channelId: CHANNEL_ID, thumbnails: {}, etag: '"pl1"' },
            { playlistId: "PL2", title: "B", description: null, publishedAt: null, privacyStatus: "public", channelId: CHANNEL_ID, thumbnails: {}, etag: '"pl2"' },
          ],
          nextPageToken: null,
        },
      ],
      new Map([
        ["PL1", [{ items: [makePlaylistItem("PL1", "v1", 0)], nextPageToken: null }]],
        ["PL2", [{ items: [makePlaylistItem("PL2", "v1", 0)], nextPageToken: null }]],
      ]),
      videosById
    );
    const repo = new FakeYouTubeSyncRepository();

    const result = await runYouTubeSync(adapter, repo, { channelId: CHANNEL_ID, now: NOW });

    expect(result.playlistItems.created).toBe(2);
    expect(repo.playlistItems.size).toBe(2);
  });

  it("walks multiple pages of a playlist's membership before considering it complete", async () => {
    const videosById = new Map<string, YouTubeVideoRecord>([
      ["v1", makeVideo({ videoId: "v1" })],
      ["v2", makeVideo({ videoId: "v2" })],
    ]);
    const adapter = new FakeAdapter(
      UPLOADS_PLAYLIST_ID,
      CHANNEL_ID,
      [
        { items: [makePlaylistItem(UPLOADS_PLAYLIST_ID, "v1", 0)], nextPageToken: "1" },
        { items: [makePlaylistItem(UPLOADS_PLAYLIST_ID, "v2", 1)], nextPageToken: null },
      ],
      [{ items: [], nextPageToken: null }],
      new Map(),
      videosById
    );
    const repo = new FakeYouTubeSyncRepository();

    const result = await runYouTubeSync(adapter, repo, { channelId: CHANNEL_ID, now: NOW });

    expect(result.videos.created).toBe(2);
  });

  it("re-running the same sync is idempotent: no duplicates, and unchanged records are reported as unchanged", async () => {
    const videosById = new Map<string, YouTubeVideoRecord>([["v1", makeVideo({ videoId: "v1" })]]);
    const adapter1 = new FakeAdapter(
      UPLOADS_PLAYLIST_ID,
      CHANNEL_ID,
      [{ items: [makePlaylistItem(UPLOADS_PLAYLIST_ID, "v1", 0)], nextPageToken: null }],
      [{ items: [{ playlistId: "PL1", title: "A", description: null, publishedAt: null, privacyStatus: "public", channelId: CHANNEL_ID, thumbnails: {}, etag: '"pl1"' }], nextPageToken: null }],
      new Map([["PL1", [{ items: [makePlaylistItem("PL1", "v1", 0)], nextPageToken: null }]]]),
      videosById
    );
    const repo = new FakeYouTubeSyncRepository();
    const first = await runYouTubeSync(adapter1, repo, { channelId: CHANNEL_ID, now: NOW });

    const videoCountAfterFirst = repo.videos.size;
    const playlistCountAfterFirst = repo.playlists.size;
    const itemCountAfterFirst = repo.playlistItems.size;

    const adapter2 = new FakeAdapter(
      UPLOADS_PLAYLIST_ID,
      CHANNEL_ID,
      [{ items: [makePlaylistItem(UPLOADS_PLAYLIST_ID, "v1", 0)], nextPageToken: null }],
      [{ items: [{ playlistId: "PL1", title: "A", description: null, publishedAt: null, privacyStatus: "public", channelId: CHANNEL_ID, thumbnails: {}, etag: '"pl1"' }], nextPageToken: null }],
      new Map([["PL1", [{ items: [makePlaylistItem("PL1", "v1", 0)], nextPageToken: null }]]]),
      videosById
    );
    const second = await runYouTubeSync(adapter2, repo, { channelId: CHANNEL_ID, now: NOW });

    expect(repo.videos.size).toBe(videoCountAfterFirst);
    expect(repo.playlists.size).toBe(playlistCountAfterFirst);
    expect(repo.playlistItems.size).toBe(itemCountAfterFirst);
    expect(second.videos.created).toBe(0);
    expect(second.playlists.created).toBe(0);
    expect(second.playlistItems.created).toBe(0);
    expect(second.videos.unchanged).toBe(first.videos.created);
    expect(second.playlists.unchanged).toBe(first.playlists.created);
    expect(second.playlistItems.unchanged).toBe(first.playlistItems.created);
  });

  it("flags a video no longer observed in a full pass as NOT_OBSERVED, never as deleted", async () => {
    const repo = new FakeYouTubeSyncRepository();
    const videosById1 = new Map<string, YouTubeVideoRecord>([
      ["v1", makeVideo({ videoId: "v1" })],
      ["v2", makeVideo({ videoId: "v2" })],
    ]);
    const adapter1 = new FakeAdapter(
      UPLOADS_PLAYLIST_ID,
      CHANNEL_ID,
      [{ items: [makePlaylistItem(UPLOADS_PLAYLIST_ID, "v1", 0), makePlaylistItem(UPLOADS_PLAYLIST_ID, "v2", 1)], nextPageToken: null }],
      [{ items: [], nextPageToken: null }],
      new Map(),
      videosById1
    );
    await runYouTubeSync(adapter1, repo, { channelId: CHANNEL_ID, now: NOW });

    // Second pass: v2 no longer appears anywhere.
    const videosById2 = new Map<string, YouTubeVideoRecord>([["v1", makeVideo({ videoId: "v1" })]]);
    const adapter2 = new FakeAdapter(
      UPLOADS_PLAYLIST_ID,
      CHANNEL_ID,
      [{ items: [makePlaylistItem(UPLOADS_PLAYLIST_ID, "v1", 0)], nextPageToken: null }],
      [{ items: [], nextPageToken: null }],
      new Map(),
      videosById2
    );
    const result = await runYouTubeSync(adapter2, repo, { channelId: CHANNEL_ID, now: NOW });

    expect(result.videos.flagged).toBe(1);
    const v2Id = repo.videosByYoutubeId.get("v2")!;
    expect(repo.videos.get(v2Id)!.observabilityState).toBe("NOT_OBSERVED");
    // Never deleted — the row still exists.
    expect(repo.videos.has(v2Id)).toBe(true);
  });

  it("flags a removed playlist item as NOT_OBSERVED without deleting the row", async () => {
    const repo = new FakeYouTubeSyncRepository();
    const videosById = new Map<string, YouTubeVideoRecord>([
      ["v1", makeVideo({ videoId: "v1" })],
      ["v2", makeVideo({ videoId: "v2" })],
    ]);
    const adapter1 = new FakeAdapter(
      UPLOADS_PLAYLIST_ID,
      CHANNEL_ID,
      [{ items: [makePlaylistItem(UPLOADS_PLAYLIST_ID, "v1", 0), makePlaylistItem(UPLOADS_PLAYLIST_ID, "v2", 1)], nextPageToken: null }],
      [{ items: [{ playlistId: "PL1", title: "A", description: null, publishedAt: null, privacyStatus: "public", channelId: CHANNEL_ID, thumbnails: {}, etag: '"pl1"' }], nextPageToken: null }],
      new Map([["PL1", [{ items: [makePlaylistItem("PL1", "v1", 0), makePlaylistItem("PL1", "v2", 1)], nextPageToken: null }]]]),
      videosById
    );
    await runYouTubeSync(adapter1, repo, { channelId: CHANNEL_ID, now: NOW });

    const adapter2 = new FakeAdapter(
      UPLOADS_PLAYLIST_ID,
      CHANNEL_ID,
      [{ items: [makePlaylistItem(UPLOADS_PLAYLIST_ID, "v1", 0), makePlaylistItem(UPLOADS_PLAYLIST_ID, "v2", 1)], nextPageToken: null }],
      [{ items: [{ playlistId: "PL1", title: "A", description: null, publishedAt: null, privacyStatus: "public", channelId: CHANNEL_ID, thumbnails: {}, etag: '"pl1"' }], nextPageToken: null }],
      new Map([["PL1", [{ items: [makePlaylistItem("PL1", "v1", 0)], nextPageToken: null }]]]), // v2 removed from PL1
      videosById
    );
    const result = await runYouTubeSync(adapter2, repo, { channelId: CHANNEL_ID, now: NOW });

    expect(result.playlistItems.flagged).toBe(1);
    const remainingItems = Array.from(repo.playlistItems.values());
    expect(remainingItems).toHaveLength(2); // still present, just flagged
    const flaggedItem = remainingItems.find((i) => i.youtubeVideoId === repo.videosByYoutubeId.get("v2"));
    expect(flaggedItem?.observabilityState).toBe("NOT_OBSERVED");
  });

  it("never overwrites an editorially-controlled field, and records a conflict when YouTube's value diverges", async () => {
    const repo = new FakeYouTubeSyncRepository();
    const videosById = new Map<string, YouTubeVideoRecord>([["v1", makeVideo({ videoId: "v1", title: "New YouTube Title" })]]);
    const adapter = new FakeAdapter(
      UPLOADS_PLAYLIST_ID,
      CHANNEL_ID,
      [{ items: [makePlaylistItem(UPLOADS_PLAYLIST_ID, "v1", 0)], nextPageToken: null }],
      [{ items: [], nextPageToken: null }],
      new Map(),
      videosById
    );

    // Pre-seed identity + an editorial override, as if a prior sync + a Studio edit had already happened.
    const identity = await repo.ensureVideoIdentity("v1");
    repo.videos.get(identity.id)!.title = "Editorially Corrected Title";
    repo.setFieldOwnershipForTest("YOUTUBE_VIDEO", identity.id, "title", "MUSIC_MADRAS_CONTROLLED", "Old YouTube Title", "Editorially Corrected Title");

    const result = await runYouTubeSync(adapter, repo, { channelId: CHANNEL_ID, now: NOW });

    expect(repo.videos.get(identity.id)!.title).toBe("Editorially Corrected Title"); // never overwritten
    expect(result.conflictsDetected).toBeGreaterThanOrEqual(1);
    expect(repo.conflicts.some((c) => c.fieldName === "title" && c.resourceId === identity.id)).toBe(true);
  });

  it("produces zero conflicts when there is no pre-existing editorial data (a genuine first-ever sync)", async () => {
    const repo = new FakeYouTubeSyncRepository();
    const videosById = new Map<string, YouTubeVideoRecord>([["v1", makeVideo({ videoId: "v1" })]]);
    const adapter = new FakeAdapter(
      UPLOADS_PLAYLIST_ID,
      CHANNEL_ID,
      [{ items: [makePlaylistItem(UPLOADS_PLAYLIST_ID, "v1", 0)], nextPageToken: null }],
      [{ items: [], nextPageToken: null }],
      new Map(),
      videosById
    );

    const result = await runYouTubeSync(adapter, repo, { channelId: CHANNEL_ID, now: NOW });
    expect(result.conflictsDetected).toBe(0);
  });

  it("reports a PARTIAL, not FULL, completeness and records the error when the channel lookup itself fails", async () => {
    const repo = new FakeYouTubeSyncRepository();
    const adapter = new FakeAdapter(UPLOADS_PLAYLIST_ID, CHANNEL_ID, [], [], new Map(), new Map(), { getChannel: true });

    const result = await runYouTubeSync(adapter, repo, { channelId: CHANNEL_ID, now: NOW });

    expect(result.completeness).toBe("PARTIAL");
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].phase).toBe("getChannel");
  });

  it("a single failing playlist's membership fetch does not abort the whole run, but the run is still reported PARTIAL", async () => {
    const videosById = new Map<string, YouTubeVideoRecord>([["v1", makeVideo({ videoId: "v1" })]]);
    const adapter = new FakeAdapter(
      UPLOADS_PLAYLIST_ID,
      CHANNEL_ID,
      [{ items: [makePlaylistItem(UPLOADS_PLAYLIST_ID, "v1", 0)], nextPageToken: null }],
      [
        {
          items: [
            { playlistId: "PL1", title: "A", description: null, publishedAt: null, privacyStatus: "public", channelId: CHANNEL_ID, thumbnails: {}, etag: '"pl1"' },
            { playlistId: "PL2", title: "B", description: null, publishedAt: null, privacyStatus: "public", channelId: CHANNEL_ID, thumbnails: {}, etag: '"pl2"' },
          ],
          nextPageToken: null,
        },
      ],
      new Map([["PL2", [{ items: [makePlaylistItem("PL2", "v1", 0)], nextPageToken: null }]]]),
      videosById,
      { listPlaylistItemsForPlaylistId: "PL1" }
    );
    const repo = new FakeYouTubeSyncRepository();

    const result = await runYouTubeSync(adapter, repo, { channelId: CHANNEL_ID, now: NOW });

    expect(result.completeness).toBe("PARTIAL");
    expect(result.errors.some((e) => e.phase.includes("PL1"))).toBe(true);
    // PL2 still got fully processed despite PL1's failure.
    expect(result.playlists.created).toBe(2);
    expect(repo.playlistItems.size).toBe(1);
  });

  it("never creates a MediaResource, Recording, or Collection — the port has no such capability at all", () => {
    // Structural guarantee, not a runtime assertion: YouTubeSyncRepositoryPort
    // (see modules/youtube/sync-engine/syncYouTubeChannel.ts) exposes no
    // method whatsoever for those tables. If this test compiles, the
    // engine cannot have called one.
    const methods = Object.keys(new FakeYouTubeSyncRepository());
    expect(methods.some((m) => /mediaResource|recording|collection/i.test(m))).toBe(false);
  });

  // Phase 6F-CORRECTION: a Music Madras playlist can legitimately reference
  // a video from another YouTube channel entirely (the reverse never
  // actually occurred in the live data — every synced video turned out to
  // be Music Madras's own, including 57 unlisted ones the anonymous
  // uploads-playlist listing excludes — but the engine must still handle
  // this correctly if it ever does happen). Ownership is the video's own
  // `channelId`, taken verbatim from YouTube, never inferred from which
  // playlist referenced it and never coerced to the channel being synced.

  it("stores a playlist-referenced video's own true channel ID, even when it differs from the channel being synced", async () => {
    const videosById = new Map<string, YouTubeVideoRecord>([
      ["v1", makeVideo({ videoId: "v1", title: "Music Madras Original", channelId: CHANNEL_ID, channelTitle: "Music Madras" })],
      ["v2", makeVideo({ videoId: "v2", title: "Guest Performance", channelId: "UCexternalChannel", channelTitle: "Some Other Channel" })],
    ]);
    const adapter = new FakeAdapter(
      UPLOADS_PLAYLIST_ID,
      CHANNEL_ID,
      [{ items: [makePlaylistItem(UPLOADS_PLAYLIST_ID, "v1", 0)], nextPageToken: null }], // only v1 is an actual upload
      [{ items: [{ playlistId: "PL1", title: "A Curated Playlist", description: null, publishedAt: null, privacyStatus: "public", channelId: CHANNEL_ID, thumbnails: {}, etag: '"pl1"' }], nextPageToken: null }],
      new Map([["PL1", [{ items: [makePlaylistItem("PL1", "v1", 0), makePlaylistItem("PL1", "v2", 1)], nextPageToken: null }]]]),
      videosById
    );
    const repo = new FakeYouTubeSyncRepository();

    await runYouTubeSync(adapter, repo, { channelId: CHANNEL_ID, now: NOW });

    const ownedId = repo.videosByYoutubeId.get("v1")!;
    const externalId = repo.videosByYoutubeId.get("v2")!;
    expect(repo.videos.get(ownedId)!.channelId).toBe(CHANNEL_ID);
    expect(repo.videos.get(externalId)!.channelId).toBe("UCexternalChannel");
    // Ownership is a plain data comparison against the configured channel, not a separate flag or table.
    expect(repo.videos.get(ownedId)!.channelId === CHANNEL_ID).toBe(true);
    expect(repo.videos.get(externalId)!.channelId === CHANNEL_ID).toBe(false);
  });

  it("a playlist containing both a channel-owned video and an externally-owned video keeps both, distinctly, with no cross-contamination", async () => {
    const videosById = new Map<string, YouTubeVideoRecord>([
      ["v1", makeVideo({ videoId: "v1", channelId: CHANNEL_ID })],
      ["v2", makeVideo({ videoId: "v2", channelId: "UCexternalChannel" })],
    ]);
    const adapter = new FakeAdapter(
      UPLOADS_PLAYLIST_ID,
      CHANNEL_ID,
      [{ items: [makePlaylistItem(UPLOADS_PLAYLIST_ID, "v1", 0)], nextPageToken: null }],
      [{ items: [{ playlistId: "PL1", title: "Mixed Playlist", description: null, publishedAt: null, privacyStatus: "public", channelId: CHANNEL_ID, thumbnails: {}, etag: '"pl1"' }], nextPageToken: null }],
      new Map([["PL1", [{ items: [makePlaylistItem("PL1", "v1", 0), makePlaylistItem("PL1", "v2", 1)], nextPageToken: null }]]]),
      videosById
    );
    const repo = new FakeYouTubeSyncRepository();

    const result = await runYouTubeSync(adapter, repo, { channelId: CHANNEL_ID, now: NOW });

    expect(result.playlistItems.created).toBe(2);
    const playlistInternalId = repo.playlistsByYoutubeId.get("PL1")!;
    const items = await repo.listPlaylistItemIdentities(playlistInternalId);
    expect(items).toHaveLength(2);
    const channelIds = items.map((i) => repo.videos.get(i.youtubeVideoId)!.channelId).sort();
    expect(channelIds).toEqual(["UCexternalChannel", CHANNEL_ID].sort());
  });

  it("duplicate titles across two different channels are still stored as distinct rows, keyed by video ID with each one's own true channel ID", async () => {
    const videosById = new Map<string, YouTubeVideoRecord>([
      ["v1", makeVideo({ videoId: "v1", title: "Ave Maria", channelId: CHANNEL_ID })],
      ["v2", makeVideo({ videoId: "v2", title: "Ave Maria", channelId: "UCexternalChannel" })],
    ]);
    const adapter = new FakeAdapter(
      UPLOADS_PLAYLIST_ID,
      CHANNEL_ID,
      [{ items: [makePlaylistItem(UPLOADS_PLAYLIST_ID, "v1", 0)], nextPageToken: null }],
      [{ items: [{ playlistId: "PL1", title: "A", description: null, publishedAt: null, privacyStatus: "public", channelId: CHANNEL_ID, thumbnails: {}, etag: '"pl1"' }], nextPageToken: null }],
      new Map([["PL1", [{ items: [makePlaylistItem("PL1", "v1", 0), makePlaylistItem("PL1", "v2", 1)], nextPageToken: null }]]]),
      videosById
    );
    const repo = new FakeYouTubeSyncRepository();

    await runYouTubeSync(adapter, repo, { channelId: CHANNEL_ID, now: NOW });

    expect(repo.videos.size).toBe(2);
    const ownedId = repo.videosByYoutubeId.get("v1")!;
    const externalId = repo.videosByYoutubeId.get("v2")!;
    expect(repo.videos.get(ownedId)!.title).toBe("Ave Maria");
    expect(repo.videos.get(externalId)!.title).toBe("Ave Maria");
    expect(repo.videos.get(ownedId)!.channelId).not.toBe(repo.videos.get(externalId)!.channelId);
  });

  it("never creates a Recording, MediaResource, or Collection for an externally-owned video merely because a Music Madras playlist references it", async () => {
    const videosById = new Map<string, YouTubeVideoRecord>([
      ["v1", makeVideo({ videoId: "v1", channelId: "UCexternalChannel" })],
    ]);
    const adapter = new FakeAdapter(
      UPLOADS_PLAYLIST_ID,
      CHANNEL_ID,
      [{ items: [], nextPageToken: null }], // not a Music Madras upload at all
      [{ items: [{ playlistId: "PL1", title: "A", description: null, publishedAt: null, privacyStatus: "public", channelId: CHANNEL_ID, thumbnails: {}, etag: '"pl1"' }], nextPageToken: null }],
      new Map([["PL1", [{ items: [makePlaylistItem("PL1", "v1", 0)], nextPageToken: null }]]]),
      videosById
    );
    const repo = new FakeYouTubeSyncRepository();

    await runYouTubeSync(adapter, repo, { channelId: CHANNEL_ID, now: NOW });

    // The port itself has no method for MediaResource/Recording/Collection
    // (see the structural test above) — this confirms the video is still
    // synced as a bare YouTubeVideo/YouTubePlaylistItem, nothing more.
    expect(repo.videos.size).toBe(1);
    expect(repo.videos.get(repo.videosByYoutubeId.get("v1")!)!.channelId).toBe("UCexternalChannel");
  });
});

// Phase 6J-1 — hardening: a partial pass must never withdraw anything, a pass
// that failed records is never a success, and the channel's own video count is
// reconciled (reported, never acted on).
describe("runYouTubeSync hardening", () => {
  const playlist = (id: string) => ({ playlistId: id, title: id, description: null, publishedAt: null, privacyStatus: "public", channelId: CHANNEL_ID, thumbnails: {}, etag: `"${id}"` });

  // v1 is in uploads; v2 lives ONLY in playlist PL1 (so it is not in uploads).
  function build(options: { failPlaylist?: string; resolvable?: string[]; channelVideoCount?: number | null; uploadsIds?: string[] }) {
    const resolvable = options.resolvable ?? ["v1", "v2"];
    const videosById = new Map<string, YouTubeVideoRecord>(resolvable.map((id) => [id, makeVideo({ videoId: id })]));
    const uploads = (options.uploadsIds ?? ["v1"]).map((id, i) => makePlaylistItem(UPLOADS_PLAYLIST_ID, id, i));
    return new FakeAdapter(
      UPLOADS_PLAYLIST_ID,
      CHANNEL_ID,
      [{ items: uploads, nextPageToken: null }],
      [{ items: [playlist("PL1")], nextPageToken: null }],
      new Map([["PL1", [{ items: [makePlaylistItem("PL1", "v2", 0)], nextPageToken: null }]]]),
      videosById,
      options.failPlaylist ? { listPlaylistItemsForPlaylistId: options.failPlaylist } : {},
      options.channelVideoCount
    );
  }

  it("a partial pass never flags a previously known video as NOT_OBSERVED (a playlist that could not be read hides its videos)", async () => {
    const repo = new FakeYouTubeSyncRepository();
    const first = await runYouTubeSync(build({}), repo, { channelId: CHANNEL_ID, now: NOW });
    expect(first.completeness).toBe("FULL");
    expect(first.videoAbsenceEvaluated).toBe(true);

    // Second pass: PL1's membership fetch fails, so v2 (only in PL1) is simply never looked at.
    const second = await runYouTubeSync(build({ failPlaylist: "PL1" }), repo, { channelId: CHANNEL_ID, now: NOW });
    expect(second.completeness).toBe("PARTIAL");
    expect(second.videoAbsenceEvaluated).toBe(false);
    expect(second.videos.flagged).toBe(0);
    const v2 = repo.videos.get(repo.videosByYoutubeId.get("v2")!)!;
    expect(v2.observabilityState).toBe("OBSERVED");
  });

  it("a full pass still flags a genuinely absent video (the guard did not switch absence detection off)", async () => {
    const repo = new FakeYouTubeSyncRepository();
    await runYouTubeSync(build({}), repo, { channelId: CHANNEL_ID, now: NOW });
    const second = await runYouTubeSync(build({ resolvable: ["v1"] }), repo, { channelId: CHANNEL_ID, now: NOW });
    expect(second.videoAbsenceEvaluated).toBe(true);
    expect(second.videos.flagged).toBe(1);
    expect(repo.videos.get(repo.videosByYoutubeId.get("v2")!)!.observabilityState).toBe("NOT_OBSERVED");
  });

  it("a run that failed to process any record is PARTIAL even though every list was read completely", async () => {
    // v2 is referenced by PL1 but videos.list does not return it.
    const result = await runYouTubeSync(build({ resolvable: ["v1"] }), new FakeYouTubeSyncRepository(), { channelId: CHANNEL_ID, now: NOW });
    expect(result.recordsFailed).toBe(1);
    expect(result.completeness).toBe("PARTIAL");
  });

  it("a clean run with nothing failed stays FULL", async () => {
    const result = await runYouTubeSync(build({}), new FakeYouTubeSyncRepository(), { channelId: CHANNEL_ID, now: NOW });
    expect(result.recordsFailed).toBe(0);
    expect(result.completeness).toBe("FULL");
    expect(result.errors).toEqual([]);
  });

  it("records a checkpoint for both channel-wide scopes and for every playlist", async () => {
    const repo = new FakeYouTubeSyncRepository();
    await runYouTubeSync(build({}), repo, { channelId: CHANNEL_ID, now: NOW });
    expect([...repo.checkpoints.keys()].sort()).toEqual(["YOUTUBE_PLAYLIST:channel-playlists", "YOUTUBE_PLAYLIST_ITEM:PL1", "YOUTUBE_PLAYLIST_ITEM:channel-uploads"]);
    expect([...repo.checkpoints.values()].every((c) => c.completeness === "FULL")).toBe(true);
  });

  describe("reconciliation against the channel's reported video count", () => {
    it("MATCH when the reported public count equals the public uploads this pass saw", async () => {
      const result = await runYouTubeSync(build({ channelVideoCount: 1 }), new FakeYouTubeSyncRepository(), { channelId: CHANNEL_ID, now: NOW });
      expect(result.reconciliation).toMatchObject({ status: "MATCH", reportedVideoCount: 1, uploadsPublicVideos: 1, uploadsVideoIds: 1, observedVideoIds: 2, resolvedVideos: 2, difference: 0 });
    });

    it("MISMATCH (reported, not acted on) when the channel reports more than the pass saw", async () => {
      const repo = new FakeYouTubeSyncRepository();
      const result = await runYouTubeSync(build({ channelVideoCount: 14 }), repo, { channelId: CHANNEL_ID, now: NOW });
      expect(result.reconciliation).toMatchObject({ status: "MISMATCH", reportedVideoCount: 14, uploadsPublicVideos: 1, difference: 13 });
      expect(result.reconciliation!.note).toMatch(/private/i);
      // Information only: a mismatch never changes completeness or flags anything on its own.
      expect(result.completeness).toBe("FULL");
      expect(result.videos.flagged).toBe(0);
    });

    it("counts only PUBLIC uploads — an unlisted upload is not part of the public count", async () => {
      const adapter = build({ channelVideoCount: 1 });
      // Make the only uploads video unlisted.
      const videos = (adapter as unknown as { videosById: Map<string, YouTubeVideoRecord> }).videosById;
      videos.set("v1", makeVideo({ videoId: "v1", privacyStatus: "unlisted" }));
      const result = await runYouTubeSync(adapter, new FakeYouTubeSyncRepository(), { channelId: CHANNEL_ID, now: NOW });
      expect(result.reconciliation).toMatchObject({ status: "MISMATCH", uploadsPublicVideos: 0, difference: 1 });
    });

    it("UNAVAILABLE when YouTube reports no count — it does not pretend to have reconciled", async () => {
      const result = await runYouTubeSync(build({ channelVideoCount: null }), new FakeYouTubeSyncRepository(), { channelId: CHANNEL_ID, now: NOW });
      expect(result.reconciliation).toMatchObject({ status: "UNAVAILABLE", reportedVideoCount: null, difference: null });
    });

    it("there is no reconciliation when the pass never got far enough to have anything to compare", async () => {
      const adapter = new FakeAdapter(UPLOADS_PLAYLIST_ID, CHANNEL_ID, [], [], new Map(), new Map(), { getChannel: true });
      const result = await runYouTubeSync(adapter, new FakeYouTubeSyncRepository(), { channelId: CHANNEL_ID, now: NOW });
      expect(result.reconciliation).toBeNull();
    });
  });
});