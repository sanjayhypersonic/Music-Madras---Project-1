import { describe, expect, it } from "vitest";
import { YouTubeHttpClient } from "../../modules/youtube/adapter/httpClient";
import { YouTubeProviderError } from "../../modules/youtube/adapter/errors";
import { createFakeFetch, instantSleep } from "./helpers/fakeYouTubeFetch";

const API_KEY = "test-secret-api-key-should-never-leak";

function buildClient(fetchImpl: typeof fetch, overrides: Partial<ConstructorParameters<typeof YouTubeHttpClient>[0]> = {}) {
  return new YouTubeHttpClient({
    apiKey: API_KEY,
    fetchImpl,
    sleep: instantSleep,
    timeoutMs: 50,
    maxRetries: 3,
    ...overrides,
  });
}

describe("YouTubeHttpClient", () => {
  it("performs a successful GET and returns the parsed body plus etag", async () => {
    const { fetchImpl } = createFakeFetch([{ status: 200, body: { items: [{ id: "abc" }] }, headers: { etag: "\"etag-1\"" } }]);
    const client = buildClient(fetchImpl);

    const result = await client.get<{ items: { id: string }[] }>("channels.list", "channels", { id: "UC123" });
    expect(result.notModified).toBe(false);
    if (!result.notModified) {
      expect(result.data.items[0].id).toBe("abc");
      expect(result.etag).toBe('"etag-1"');
    }
  });

  // Phase 6D security hardening: the API key travels only via the
  // `x-goog-api-key` request header, never a URL query parameter.
  describe("API key handling (Phase 6D security patch)", () => {
    it("1. sends the API key in the x-goog-api-key request header", async () => {
      const { fetchImpl, calls } = createFakeFetch([{ status: 200, body: { items: [] } }]);
      const client = buildClient(fetchImpl);

      await client.get("channels.list", "channels", { id: "UC123" });

      const headers = calls[0].init?.headers as Record<string, string> | undefined;
      expect(headers?.["x-goog-api-key"]).toBe(API_KEY);
    });

    it("2. never includes the API key anywhere in the request URL", async () => {
      const { fetchImpl, calls } = createFakeFetch([{ status: 200, body: { items: [] } }]);
      const client = buildClient(fetchImpl);

      await client.get("channels.list", "channels", { id: "UC123" });

      expect(calls[0].url).not.toContain(API_KEY);
      expect(calls[0].url).not.toContain("key=");
    });

    it("3. never includes the API key in a thrown error's message, across every error kind", async () => {
      const scenarios = [
        { status: 400, body: { error: { message: "Bad request" } } },
        { status: 401, body: { error: { message: "Invalid credentials" } } },
        { status: 403, body: { error: { message: "Forbidden", errors: [{ reason: "forbidden" }] } } },
        { status: 404, body: { error: { message: "Not found" } } },
        { status: 429, body: { error: { message: "Too many requests" } } },
      ];

      for (const scenario of scenarios) {
        const { fetchImpl } = createFakeFetch([scenario]);
        const client = buildClient(fetchImpl);
        const error = await client.get("channels.list", "channels", { id: "UC123" }).catch((e) => e);
        expect(error).toBeInstanceOf(YouTubeProviderError);
        expect((error as YouTubeProviderError).message).not.toContain(API_KEY);
      }
    });

    it("4. never passes the API key to onApiCall, the adapter's only built-in 'observability' hook", async () => {
      const { fetchImpl } = createFakeFetch([{ status: 200, body: { items: [] } }]);
      const observed: unknown[] = [];
      const client = new YouTubeHttpClient({
        apiKey: API_KEY,
        fetchImpl,
        sleep: instantSleep,
        onApiCall: (info) => observed.push(info),
      });

      await client.get("channels.list", "channels", { id: "UC123" });

      expect(JSON.stringify(observed)).not.toContain(API_KEY);
    });

    // 5. Retry/error behavior is unchanged by this patch — verified by every
    // other test in this file continuing to pass unmodified below (status
    // classification, retry-on-TRANSIENT, no-retry-on-permanent, timeout,
    // 304 handling, onApiCall invocation count).
  });

  it("classifies 429 as QUOTA_EXCEEDED and does not retry it", async () => {
    const { fetchImpl, calls } = createFakeFetch([{ status: 429, body: { error: { message: "Too many requests" } } }]);
    const client = buildClient(fetchImpl);

    const error = await client.get("videos.list", "videos", { id: "v1" }).catch((e) => e);
    expect(error).toBeInstanceOf(YouTubeProviderError);
    expect((error as YouTubeProviderError).kind).toBe("QUOTA_EXCEEDED");
    expect(calls).toHaveLength(1);
  });

  it("classifies a 403 with reason quotaExceeded as QUOTA_EXCEEDED, and a plain 403 as AUTHENTICATION", async () => {
    const quota = createFakeFetch([{ status: 403, body: { error: { errors: [{ reason: "quotaExceeded" }] } } }]);
    const quotaClient = buildClient(quota.fetchImpl);
    const quotaError = await quotaClient.get("videos.list", "videos", { id: "v1" }).catch((e) => e);
    expect((quotaError as YouTubeProviderError).kind).toBe("QUOTA_EXCEEDED");

    const auth = createFakeFetch([{ status: 403, body: { error: { errors: [{ reason: "forbidden" }] } } }]);
    const authClient = buildClient(auth.fetchImpl);
    const authError = await authClient.get("videos.list", "videos", { id: "v1" }).catch((e) => e);
    expect((authError as YouTubeProviderError).kind).toBe("AUTHENTICATION");
  });

  it("classifies 404 as NOT_FOUND and does not retry it", async () => {
    const { fetchImpl, calls } = createFakeFetch([{ status: 404, body: { error: { message: "Not found" } } }]);
    const client = buildClient(fetchImpl);

    const error = await client.get("playlists.list", "playlists", { id: "PL1" }).catch((e) => e);
    expect((error as YouTubeProviderError).kind).toBe("NOT_FOUND");
    expect(calls).toHaveLength(1);
  });

  it("classifies 400 as INVALID_REQUEST and does not retry it", async () => {
    const { fetchImpl, calls } = createFakeFetch([{ status: 400, body: { error: { message: "Bad request" } } }]);
    const client = buildClient(fetchImpl);

    const error = await client.get("videos.list", "videos", { id: "" }).catch((e) => e);
    expect((error as YouTubeProviderError).kind).toBe("INVALID_REQUEST");
    expect(calls).toHaveLength(1);
  });

  it("retries a 500 (TRANSIENT) and succeeds once the server recovers", async () => {
    const { fetchImpl, calls } = createFakeFetch([
      { status: 500, body: { error: { message: "Internal error" } } },
      { status: 200, body: { items: [] } },
    ]);
    const client = buildClient(fetchImpl);

    const result = await client.get<{ items: unknown[] }>("videos.list", "videos", { id: "v1" });
    expect(result.notModified).toBe(false);
    expect(calls).toHaveLength(2);
  });

  it("retries a network failure and eventually throws TRANSIENT if it never recovers", async () => {
    const { fetchImpl, calls } = createFakeFetch([
      { status: 0, networkError: new Error("ECONNRESET") },
      { status: 0, networkError: new Error("ECONNRESET") },
      { status: 0, networkError: new Error("ECONNRESET") },
    ]);
    const client = buildClient(fetchImpl, { maxRetries: 3 });

    const error = await client.get("videos.list", "videos", { id: "v1" }).catch((e) => e);
    expect((error as YouTubeProviderError).kind).toBe("TRANSIENT");
    expect(calls).toHaveLength(3);
  });

  it("treats a client-side timeout as TRANSIENT", async () => {
    const { fetchImpl } = createFakeFetch([{ status: 0, hangUntilAborted: true }, { status: 200, body: { items: [] } }]);
    const client = buildClient(fetchImpl, { timeoutMs: 5, maxRetries: 2 });

    const result = await client.get<{ items: unknown[] }>("videos.list", "videos", { id: "v1" });
    // First attempt times out (TRANSIENT, retried), second attempt (a fresh fake response) succeeds.
    expect(result.notModified).toBe(false);
  });

  it("raises UNEXPECTED_RESPONSE for a 200 response that isn't valid JSON", async () => {
    // A plain FakeResponseSpec always returns a JSON-serializable body via
    // JSON.stringify-free `async () => spec.body`, which can't itself throw —
    // so this constructs the fetch fake directly to simulate a response body
    // that fails to parse (e.g. a truncated/non-JSON body from the real API).
    const throwingFetch: typeof fetch = async () =>
      ({
        ok: true,
        status: 200,
        json: async () => {
          throw new Error("Unexpected end of JSON input");
        },
        headers: { get: () => null },
      }) as unknown as Response;
    const client = buildClient(throwingFetch);

    const error = await client.get("videos.list", "videos", { id: "v1" }).catch((e) => e);
    expect(error).toBeInstanceOf(YouTubeProviderError);
    expect((error as YouTubeProviderError).kind).toBe("UNEXPECTED_RESPONSE");
  });

  it("resolves a 304 response as notModified without throwing", async () => {
    const { fetchImpl } = createFakeFetch([{ status: 304 }]);
    const client = buildClient(fetchImpl);

    const result = await client.get("videos.list", "videos", { id: "v1" }, '"previous-etag"');
    expect(result.notModified).toBe(true);
  });

  it("invokes onApiCall once per HTTP response received, tagged with the operation", async () => {
    const { fetchImpl } = createFakeFetch([{ status: 200, body: { items: [] } }]);
    const calls: { operation: string; status: number }[] = [];
    const client = new YouTubeHttpClient({
      apiKey: API_KEY,
      fetchImpl,
      sleep: instantSleep,
      onApiCall: (info) => calls.push(info),
    });

    await client.get("playlists.list", "playlists", { channelId: "UC1" });
    expect(calls).toEqual([{ operation: "playlists.list", status: 200 }]);
  });

  it("throws a CONFIGURATION error immediately if no API key is provided", () => {
    expect(() => new YouTubeHttpClient({ apiKey: "" })).toThrow(YouTubeProviderError);
  });
});
