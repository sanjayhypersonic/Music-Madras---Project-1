import { describe, expect, it } from "vitest";
import { YouTubeDataApiAdapter } from "../../modules/youtube/adapter/youtubeDataAdapter";
import { YouTubeProviderError } from "../../modules/youtube/adapter/errors";
import { createFakeFetch, instantSleep } from "./helpers/fakeYouTubeFetch";

function buildAdapter(fetchImpl: typeof fetch) {
  return new YouTubeDataApiAdapter({ apiKey: "test-key", fetchImpl, sleep: instantSleep });
}

describe("YouTubeDataApiAdapter", () => {
  it("getChannel returns the uploads playlist ID", async () => {
    const { fetchImpl, calls } = createFakeFetch([
      {
        status: 200,
        body: {
          items: [
            {
              id: "UCabc",
              etag: '"etag-1"',
              snippet: { title: "Music Madras" },
              contentDetails: { relatedPlaylists: { uploads: "UUabc" } },
            },
          ],
        },
      },
    ]);
    const adapter = buildAdapter(fetchImpl);

    const channel = await adapter.getChannel("UCabc");
    expect(channel).toEqual({ channelId: "UCabc", title: "Music Madras", uploadsPlaylistId: "UUabc", etag: '"etag-1"' });
    expect(calls[0].url).toContain("channels?");
    expect(calls[0].url).toContain("id=UCabc");
  });

  it("getChannel throws NOT_FOUND when the channel does not exist", async () => {
    const { fetchImpl } = createFakeFetch([{ status: 200, body: { items: [] } }]);
    const adapter = buildAdapter(fetchImpl);

    const error = await adapter.getChannel("UCmissing").catch((e) => e);
    expect(error).toBeInstanceOf(YouTubeProviderError);
    expect((error as YouTubeProviderError).kind).toBe("NOT_FOUND");
  });

  it("getChannel throws UNEXPECTED_RESPONSE when the channel has no uploads playlist", async () => {
    const { fetchImpl } = createFakeFetch([{ status: 200, body: { items: [{ id: "UCabc", contentDetails: {} }] } }]);
    const adapter = buildAdapter(fetchImpl);

    const error = await adapter.getChannel("UCabc").catch((e) => e);
    expect((error as YouTubeProviderError).kind).toBe("UNEXPECTED_RESPONSE");
  });

  it("listPlaylists maps items and surfaces nextPageToken for the caller to control pagination", async () => {
    const { fetchImpl, calls } = createFakeFetch([
      {
        status: 200,
        body: {
          nextPageToken: "page-2",
          items: [
            {
              id: "PL1",
              etag: '"e1"',
              snippet: {
                title: "Concerts 2025",
                description: "d",
                publishedAt: "2025-01-01T00:00:00Z",
                channelId: "UCabc",
                thumbnails: { default: { url: "https://example.com/pl-thumb.jpg" } },
              },
              status: { privacyStatus: "public" },
            },
          ],
        },
      },
    ]);
    const adapter = buildAdapter(fetchImpl);

    const page = await adapter.listPlaylists("UCabc");
    expect(page.nextPageToken).toBe("page-2");
    expect(page.items).toEqual([
      {
        playlistId: "PL1",
        title: "Concerts 2025",
        description: "d",
        publishedAt: "2025-01-01T00:00:00Z",
        privacyStatus: "public",
        channelId: "UCabc",
        thumbnails: { default: { url: "https://example.com/pl-thumb.jpg" } },
        etag: '"e1"',
      },
    ]);
    expect(calls[0].url).toContain("channelId=UCabc");
  });

  it("listPlaylists returns an empty page with a null nextPageToken for an empty response", async () => {
    const { fetchImpl } = createFakeFetch([{ status: 200, body: {} }]);
    const adapter = buildAdapter(fetchImpl);

    const page = await adapter.listPlaylists("UCabc");
    expect(page).toEqual({ items: [], nextPageToken: null });
  });

  it("listPlaylistItems extracts videoId from contentDetails, falling back to snippet.resourceId, and preserves position", async () => {
    const { fetchImpl } = createFakeFetch([
      {
        status: 200,
        body: {
          items: [
            { etag: '"a"', snippet: { position: 0, title: "Track 1" }, contentDetails: { videoId: "v1", videoPublishedAt: "2025-01-01T00:00:00Z" } },
            { etag: '"b"', snippet: { position: 1, title: "Track 2", resourceId: { videoId: "v2" } }, contentDetails: {} },
          ],
        },
      },
    ]);
    const adapter = buildAdapter(fetchImpl);

    const page = await adapter.listPlaylistItems("PL1");
    expect(page.items).toEqual([
      { playlistId: "PL1", videoId: "v1", position: 0, title: "Track 1", publishedAt: "2025-01-01T00:00:00Z", etag: '"a"' },
      { playlistId: "PL1", videoId: "v2", position: 1, title: "Track 2", publishedAt: null, etag: '"b"' },
    ]);
  });

  it("listPlaylistItems throws UNEXPECTED_RESPONSE for an item with no video ID at all", async () => {
    const { fetchImpl } = createFakeFetch([{ status: 200, body: { items: [{ snippet: { position: 0 } }] } }]);
    const adapter = buildAdapter(fetchImpl);

    const error = await adapter.listPlaylistItems("PL1").catch((e) => e);
    expect((error as YouTubeProviderError).kind).toBe("UNEXPECTED_RESPONSE");
  });

  it("listVideos batches more than 50 IDs into multiple videos.list calls", async () => {
    const ids = Array.from({ length: 120 }, (_, i) => `v${i}`);
    const { fetchImpl, calls } = createFakeFetch([
      { status: 200, body: { items: ids.slice(0, 50).map((id) => ({ id, snippet: {}, contentDetails: {}, status: {} })) } },
      { status: 200, body: { items: ids.slice(50, 100).map((id) => ({ id, snippet: {}, contentDetails: {}, status: {} })) } },
      { status: 200, body: { items: ids.slice(100, 120).map((id) => ({ id, snippet: {}, contentDetails: {}, status: {} })) } },
    ]);
    const adapter = buildAdapter(fetchImpl);

    const videos = await adapter.listVideos(ids);
    expect(calls).toHaveLength(3);
    expect(videos).toHaveLength(120);
    expect(videos.map((v) => v.videoId)).toEqual(ids);
  });

  it("listVideos maps snippet/contentDetails/status fields into the DTO", async () => {
    const { fetchImpl } = createFakeFetch([
      {
        status: 200,
        body: {
          items: [
            {
              id: "v1",
              etag: '"e1"',
              snippet: {
                title: "A Recording",
                description: "desc",
                publishedAt: "2025-01-01T00:00:00Z",
                channelId: "UCabc",
                channelTitle: "Music Madras",
                thumbnails: { default: { url: "https://example.com/thumb.jpg" } },
              },
              contentDetails: { duration: "PT4M13S" },
              status: { privacyStatus: "public", uploadStatus: "processed", embeddable: true },
              statistics: { viewCount: "1234", likeCount: "56", commentCount: "7" },
            },
          ],
        },
      },
    ]);
    const adapter = buildAdapter(fetchImpl);

    const [video] = await adapter.listVideos(["v1"]);
    expect(video).toEqual({
      videoId: "v1",
      title: "A Recording",
      description: "desc",
      thumbnails: { default: { url: "https://example.com/thumb.jpg" } },
      publishedAt: "2025-01-01T00:00:00Z",
      durationIso8601: "PT4M13S",
      channelId: "UCabc",
      channelTitle: "Music Madras",
      privacyStatus: "public",
      uploadStatus: "processed",
      embeddable: true,
      viewCount: "1234",
      likeCount: "56",
      commentCount: "7",
      etag: '"e1"',
    });
  });

  it("listVideos defaults statistics/embeddable to null when the API omits them", async () => {
    const { fetchImpl } = createFakeFetch([
      { status: 200, body: { items: [{ id: "v2", snippet: {}, contentDetails: {}, status: {} }] } },
    ]);
    const adapter = buildAdapter(fetchImpl);

    const [video] = await adapter.listVideos(["v2"]);
    expect(video.embeddable).toBeNull();
    expect(video.viewCount).toBeNull();
    expect(video.likeCount).toBeNull();
    expect(video.commentCount).toBeNull();
  });

  it("listVideos de-duplicates repeated IDs before batching", async () => {
    const { fetchImpl, calls } = createFakeFetch([{ status: 200, body: { items: [{ id: "v1", snippet: {}, contentDetails: {}, status: {} }] } }]);
    const adapter = buildAdapter(fetchImpl);

    const videos = await adapter.listVideos(["v1", "v1", "v1"]);
    expect(videos).toHaveLength(1);
    expect(calls[0].url).toContain("id=v1");
    expect(calls[0].url).not.toContain("v1%2Cv1");
  });

  it("listVideos returns an empty array for an empty input without making a request", async () => {
    const { fetchImpl, calls } = createFakeFetch([{ status: 200, body: { items: [] } }]);
    const adapter = buildAdapter(fetchImpl);

    const videos = await adapter.listVideos([]);
    expect(videos).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});
