// Typed adapter errors (Phase 6C). Deliberately not mapped onto Music
// Madras's ObservabilityState enum here — that mapping is the
// availability layer's job (ADR §15), a later phase. This is only about
// distinguishing *why* a call to YouTube failed, for the caller (and,
// later, the sync engine) to react to appropriately.
//
// Security: messages built by this module use `redactUrl` (below) so a
// request URL containing `key=<api key>` never appears in a thrown
// error's message — see modules/youtube/adapter/httpClient.ts, the only
// place a URL is ever constructed.

export type YouTubeProviderErrorKind =
  | "CONFIGURATION" // e.g. no API key provided
  | "AUTHENTICATION" // API key rejected/forbidden
  | "QUOTA_EXCEEDED" // quota or rate limit hit
  | "TRANSIENT" // network error, timeout, or 5xx — safe to retry
  | "INVALID_REQUEST" // 400-class, not authentication/quota related
  | "NOT_FOUND" // 404, or a definitive "resource does not exist" response
  | "UNEXPECTED_RESPONSE"; // malformed JSON, or a shape this adapter doesn't recognise

export class YouTubeProviderError extends Error {
  readonly kind: YouTubeProviderErrorKind;
  readonly status?: number;
  readonly operation?: string;

  constructor(kind: YouTubeProviderErrorKind, message: string, options?: { status?: number; operation?: string; cause?: unknown }) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "YouTubeProviderError";
    this.kind = kind;
    this.status = options?.status;
    this.operation = options?.operation;
  }
}

/** Only TRANSIENT failures are ever safe to retry — everything else is a permanent outcome for that request. */
export function isRetryableYouTubeError(error: unknown): boolean {
  return error instanceof YouTubeProviderError && error.kind === "TRANSIENT";
}

/**
 * Strips the `key` query parameter from a URL before it can ever reach a
 * log line or an error message — the one function every code path that
 * builds a user-facing/loggable string from a request URL must go
 * through.
 */
export function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.searchParams.has("key")) {
      parsed.searchParams.set("key", "REDACTED");
    }
    return parsed.toString();
  } catch {
    return "[unparseable URL]";
  }
}
