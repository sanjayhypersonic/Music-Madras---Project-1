// A small, bounded retry/backoff helper (Phase 6C) — deliberately scoped
// to this adapter, not a generalized enterprise retry framework. Only
// used for TRANSIENT failures (see errors.ts); permanent failures
// (configuration, authentication, quota, invalid request, not found)
// never reach this loop at all — httpClient.ts checks that before ever
// calling withRetry.

export interface RetryPolicyOptions {
  /** Total attempts including the first — default 3 (1 initial + 2 retries). */
  maxAttempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  /** Injectable for tests, so a retry test doesn't actually wait — defaults to a real timer. */
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_INITIAL_DELAY_MS = 250;
const DEFAULT_MAX_DELAY_MS = 4000;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function computeBackoffDelayMs(attempt: number, initialDelayMs: number, maxDelayMs: number): number {
  // attempt is 1-based (the failed attempt number); exponential backoff: initialDelay * 2^(attempt-1), capped.
  const delay = initialDelayMs * 2 ** (attempt - 1);
  return Math.min(delay, maxDelayMs);
}

/**
 * Calls `fn` up to `maxAttempts` times. `isRetryable` decides, per
 * caught error, whether another attempt is warranted; the moment it
 * returns false (or attempts are exhausted), the error is rethrown as-is
 * — this function never swallows or rewrites an error, only decides
 * whether to try again.
 */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  isRetryable: (error: unknown) => boolean,
  options: RetryPolicyOptions = {}
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const initialDelayMs = options.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS;
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const sleep = options.sleep ?? defaultSleep;

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      const isLastAttempt = attempt === maxAttempts;
      if (isLastAttempt || !isRetryable(error)) {
        throw error;
      }
      await sleep(computeBackoffDelayMs(attempt, initialDelayMs, maxDelayMs));
    }
  }
  // Unreachable — the loop above always either returns or throws — but
  // keeps TypeScript satisfied that this function always returns T or throws.
  throw lastError;
}
