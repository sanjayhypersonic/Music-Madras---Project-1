// Deterministic, network-free fake `fetch` for testing
// modules/youtube/adapter/* (Phase 6C). Not a *.test.ts file itself — a
// shared helper, matching vitest.config.ts's `tests/unit/**/*.test.ts`
// include pattern (this file is never collected as its own suite).

export interface FakeResponseSpec {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
  /** If set, the fake fetch call rejects with this error instead of resolving — simulates a network failure. */
  networkError?: Error;
  /** If set, the fake fetch never settles until the caller's AbortSignal fires — simulates a real timeout. */
  hangUntilAborted?: boolean;
}

export interface FakeFetchCall {
  url: string;
  init?: RequestInit;
}

export function createFakeFetch(responses: FakeResponseSpec[]): { fetchImpl: typeof fetch; calls: FakeFetchCall[] } {
  let index = 0;
  const calls: FakeFetchCall[] = [];

  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push({ url, init });

    const spec = responses[Math.min(index, responses.length - 1)];
    index++;

    if (spec.hangUntilAborted) {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const abortError = new Error("The operation was aborted.");
          abortError.name = "AbortError";
          reject(abortError);
        });
      });
    }

    if (spec.networkError) {
      throw spec.networkError;
    }

    const headers = spec.headers ?? {};
    return {
      ok: spec.status >= 200 && spec.status < 300,
      status: spec.status,
      json: async () => spec.body,
      headers: {
        get: (name: string) => headers[name] ?? headers[name.toLowerCase()] ?? null,
      },
    } as unknown as Response;
  }) as typeof fetch;

  return { fetchImpl, calls };
}

export function instantSleep(): Promise<void> {
  return Promise.resolve();
}
