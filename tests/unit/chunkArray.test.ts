import { describe, expect, it } from "vitest";
import { chunkArray } from "../../modules/youtube/adapter/youtubeDataAdapter";

describe("chunkArray", () => {
  it("splits items into chunks no larger than size, preserving order", () => {
    const ids = Array.from({ length: 120 }, (_, i) => `id-${i}`);
    const chunks = chunkArray(ids, 50);

    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toHaveLength(50);
    expect(chunks[1]).toHaveLength(50);
    expect(chunks[2]).toHaveLength(20);
    expect(chunks.flat()).toEqual(ids);
  });

  it("returns a single chunk when items fit within size", () => {
    expect(chunkArray(["a", "b"], 50)).toEqual([["a", "b"]]);
  });

  it("returns an empty array for empty input", () => {
    expect(chunkArray([], 50)).toEqual([]);
  });

  it("rejects a non-positive chunk size", () => {
    expect(() => chunkArray(["a"], 0)).toThrow();
  });
});
