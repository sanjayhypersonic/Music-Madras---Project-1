// Typed adapter errors (Phase 6C). Deliberately not mapped onto Music
// Madras's ObservabilityState enum here — that mapping is the
// availability layer's job (ADR §15), a later phase. This is only about
// distinguishing *why* a call to YouTube failed, for the caller (and,
// later, the sync engine) to react to appropriately.
//
// Security: the API key travels only as the `x-goog-api-key` request
// header (Phase 6D hardening — see httpClient.ts), never as a URL query
// parameter, so it cannot appear in a request URL at all. `redactUrl`
// (below) is kept as a defense-in-depth safeguard on any URL this module
// puts into a thrown error's message regardless — it strips a `key`
// parameter if one is ever present, rather than assuming it never will
// be.

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
 * Strips a `key` query parameter from a URL, if one is present, before it
 * can ever reach a log line or an error message. As of Phase 6D the
 * adapter no longer sends the API key as a query parameter at all (see
 * httpClient.ts), so this is a defensive backstop rather than the
 * primary protection — the one function any code path that builds a
 * user-facing/loggable string from a request URL should still go
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
