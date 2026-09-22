import { redactUrl, YouTubeProviderError, isRetryableYouTubeError, type YouTubeProviderErrorKind } from "./errors";
import { withRetry } from "./retryPolicy";
import type { YouTubeAdapterConfig, YouTubeDataApiOperation } from "./types";

// The one place a request actually reaches YouTube's servers (Phase 6C,
// ADR §11: "the adapter is the ONLY place YouTube Data API v3 calls are
// made"). No SDK — the YouTube Data API v3 is plain REST/JSON, and the
// project already prefers native `fetch` over adding a dependency for
// this shape of call (see modules/analytics/providers/ga4/ga4Adapter.ts).
//
// Configuration (the API key) is received via the constructor, never read
// from `process.env` inside this file — that stays at the application's
// composition boundary, wherever this client is eventually instantiated
// (not built in this phase; nothing calls this adapter yet).

const DEFAULT_BASE_URL = "https://www.googleapis.com/youtube/v3";
const DEFAULT_TIMEOUT_MS = 10_000;

export interface YouTubeHttpClientOptions extends YouTubeAdapterConfig {
  /** Injectable for tests — defaults to the runtime's global fetch. Never a network call in a test. */
  fetchImpl?: typeof fetch;
  /** Injectable for tests, so retry tests don't actually wait. */
  sleep?: (ms: number) => Promise<void>;
  /** Called once per HTTP response actually received (not per logical operation) — the caller's visibility into real request volume, per operation. Never invents a quota-unit number. */
  onApiCall?: (info: { operation: YouTubeDataApiOperation; status: number }) => void;
}

export interface YouTubeGetResult<T> {
  data: T;
  etag: string | null;
  notModified: false;
}

export interface YouTubeNotModifiedResult {
  data: null;
  etag: string | null;
  notModified: true;
}

interface YouTubeApiErrorBody {
  error?: {
    code?: number;
    message?: string;
    errors?: { reason?: string; message?: string }[];
  };
}

export class YouTubeHttpClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep?: (ms: number) => Promise<void>;
  private readonly onApiCall?: YouTubeHttpClientOptions["onApiCall"];

  constructor(options: YouTubeHttpClientOptions) {
    if (!options.apiKey) {
      throw new YouTubeProviderError("CONFIGURATION", "YouTube adapter requires an apiKey.");
    }
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = options.maxRetries ?? 3;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep;
    this.onApiCall = options.onApiCall;
  }

  /**
   * GET a single Data API list endpoint. `ifNoneMatch`, when provided,
   * sets the `If-None-Match` header — a 304 response resolves to
   * `{ notModified: true }` rather than throwing, so a future caller that
   * already knows a resource's last ETag can skip re-processing an
   * unchanged response body. Nothing in this phase calls with
   * `ifNoneMatch` yet (there is no sync engine tracking previous ETags to
   * compare against) — the mechanism exists so the sync engine can use it
   * directly once it does.
   */
  async get<T>(
    operation: YouTubeDataApiOperation,
    path: string,
    query: Record<string, string | number | undefined>,
    ifNoneMatch?: string
  ): Promise<YouTubeGetResult<T> | YouTubeNotModifiedResult> {
    const url = this.buildUrl(path, query);

    return withRetry(
      () => this.performRequest<T>(operation, url, ifNoneMatch),
      isRetryableYouTubeError,
      { maxAttempts: this.maxRetries, sleep: this.sleep }
    );
  }

  /**
   * Deliberately never adds the API key here (Phase 6D security
   * hardening) — it travels only as the `x-goog-api-key` request header,
   * set in performRequest, so it can never end up in a URL that gets
   * logged, cached by an intermediary, or captured in server access
   * logs. Google's APIs document this header as an equivalent,
   * server-side-only alternative to the `key` query parameter.
   */
  private buildUrl(path: string, query: Record<string, string | number | undefined>): string {
    const url = new URL(`${this.baseUrl}/${path}`);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }

  private async performRequest<T>(
    operation: YouTubeDataApiOperation,
    url: string,
    ifNoneMatch?: string
  ): Promise<YouTubeGetResult<T> | YouTubeNotModifiedResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    const headers: Record<string, string> = { "x-goog-api-key": this.apiKey };
    if (ifNoneMatch) {
      headers["If-None-Match"] = ifNoneMatch;
    }

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: "GET",
        headers,
        signal: controller.signal,
      });
    } catch (error) {
      // Network failure or our own timeout abort — always transient.
      throw new YouTubeProviderError("TRANSIENT", `YouTube API request failed for ${operation}: ${networkErrorMessage(error)}`, {
        operation,
        cause: error,
      });
    } finally {
      clearTimeout(timeout);
    }

    this.onApiCall?.({ operation, status: response.status });

    if (response.status === 304) {
      return { data: null, etag: ifNoneMatch ?? null, notModified: true };
    }

    if (!response.ok) {
      throw await this.toProviderError(operation, url, response);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch (error) {
      throw new YouTubeProviderError("UNEXPECTED_RESPONSE", `YouTube API returned a response for ${operation} that was not valid JSON.`, {
        operation,
        status: response.status,
        cause: error,
      });
    }

    return { data: body as T, etag: response.headers.get("etag"), notModified: false };
  }

  private async toProviderError(operation: YouTubeDataApiOperation, url: string, response: Response): Promise<YouTubeProviderError> {
    let body: YouTubeApiErrorBody | null = null;
    try {
      body = (await response.json()) as YouTubeApiErrorBody;
    } catch {
      // Body wasn't JSON (or was empty) — fall through with no body detail; still classify by status below.
    }

    const reason = body?.error?.errors?.[0]?.reason;
    const apiMessage = body?.error?.message;
    const status = response.status;
    const kind = classifyErrorStatus(status, reason);

    const detail = apiMessage ? `: ${apiMessage}` : "";
    return new YouTubeProviderError(
      kind,
      `YouTube API request for ${operation} failed with status ${status}${detail} (${redactUrl(url)})`,
      { status, operation }
    );
  }
}

function classifyErrorStatus(status: number, reason: string | undefined): YouTubeProviderErrorKind {
  if (status === 404) return "NOT_FOUND";
  if (status === 429) return "QUOTA_EXCEEDED";
  if (status >= 500) return "TRANSIENT";
  if (status === 401) return "AUTHENTICATION";
  if (status === 403) {
    if (reason === "quotaExceeded" || reason === "dailyLimitExceeded" || reason === "rateLimitExceeded") {
      return "QUOTA_EXCEEDED";
    }
    return "AUTHENTICATION";
  }
  if (status >= 400 && status < 500) return "INVALID_REQUEST";
  return "UNEXPECTED_RESPONSE";
}

function networkErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.name === "AbortError" ? "request timed out" : error.message;
  }
  return "unknown network error";
}
