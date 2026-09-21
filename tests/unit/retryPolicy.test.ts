import { describe, expect, it, vi } from "vitest";
import { computeBackoffDelayMs, withRetry } from "../../modules/youtube/adapter/retryPolicy";
import { instantSleep } from "./helpers/fakeYouTubeFetch";

describe("computeBackoffDelayMs", () => {
  it("doubles the delay each attempt, capped at maxDelayMs", () => {
    expect(computeBackoffDelayMs(1, 100, 4000)).toBe(100);
    expect(computeBackoffDelayMs(2, 100, 4000)).toBe(200);
    expect(computeBackoffDelayMs(3, 100, 4000)).toBe(400);
    expect(computeBackoffDelayMs(10, 100, 4000)).toBe(4000);
  });
});

describe("withRetry", () => {
  it("returns the result on first success without retrying", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await withRetry(fn, () => true, { sleep: instantSleep });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries a retryable failure up to maxAttempts, then succeeds", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("transient 1"))
      .mockRejectedValueOnce(new Error("transient 2"))
      .mockResolvedValue("recovered");

    const result = await withRetry(fn, () => true, { maxAttempts: 3, sleep: instantSleep });
    expect(result).toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("stops immediately when isRetryable returns false, without exhausting maxAttempts", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("permanent"));
    await expect(withRetry(fn, () => false, { maxAttempts: 5, sleep: instantSleep })).rejects.toThrow("permanent");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("throws the final error once maxAttempts is exhausted", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("still failing"));
    await expect(withRetry(fn, () => true, { maxAttempts: 3, sleep: instantSleep })).rejects.toThrow("still failing");
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
