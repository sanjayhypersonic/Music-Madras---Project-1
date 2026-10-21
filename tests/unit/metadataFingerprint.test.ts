import { describe, expect, it } from "vitest";
import {
  METADATA_FINGERPRINT_VERSION,
  MATERIAL_FIELDS,
  diffMaterial,
  fingerprintFacts,
  isComparableSnapshot,
  materialMetadata,
  type VideoMetadataFacts,
} from "../../modules/mmke/catalogue/metadataFingerprint";

// Lifecycle hardening, F12 — the material-change fingerprint. What counts as a change an editor must look at, and what must NOT trigger a review.
// Synthetic values only.

const base: VideoMetadataFacts = {
  title: "Advent Carols",
  description: "A service of carols.\nSung by the junior choir.",
  thumbnailUrl: "https://img.example.test/vi/abc123/hqdefault.jpg",
  durationSeconds: 1800,
  publishedAt: new Date("2021-12-19T10:00:00Z"),
  embeddable: true,
  channelId: "UC-example",
};
const fp = (overrides: Partial<VideoMetadataFacts> = {}) => fingerprintFacts({ ...base, ...overrides });

describe("what IS a material change", () => {
  it.each<[string, Partial<VideoMetadataFacts>]>([
    ["a new title", { title: "Advent Carols 2021" }],
    ["a different description", { description: "A service of carols and readings." }],
    ["a different thumbnail image", { thumbnailUrl: "https://img.example.test/vi/abc123/maxresdefault.jpg" }],
    ["a different thumbnail host", { thumbnailUrl: "https://other.example.test/vi/abc123/hqdefault.jpg" }],
    ["a different length (a different cut of the recording)", { durationSeconds: 1500 }],
    ["a different published date", { publishedAt: new Date("2021-12-20T10:00:00Z") }],
    ["the video no longer being embeddable", { embeddable: false }],
    ["a different channel (whose video it is)", { channelId: "UC-someone-else" }],
    ["a title removed", { title: null }],
  ])("%s changes the fingerprint", (_name, change) => {
    expect(fp(change)).not.toBe(fp());
  });

  it("names exactly the fields that changed, with what was reviewed and what is there now", () => {
    const changes = diffMaterial(materialMetadata(base), materialMetadata({ ...base, title: "Advent Carols 2021", durationSeconds: 1500 }));
    expect(changes.map((c) => c.field)).toEqual(["title", "duration"]);
    expect(changes[0]).toEqual({ field: "title", before: "Advent Carols", after: "Advent Carols 2021" });
    expect(changes[1]).toEqual({ field: "duration", before: "1800", after: "1500" });
  });

  it("covers every material field and nothing else", () => {
    expect([...MATERIAL_FIELDS].sort()).toEqual(["channel", "description", "duration", "embeddable", "publishedAt", "thumbnail", "title"]);
  });
});

describe("what is NOT a material change (no review is triggered)", () => {
  it("ignores whitespace noise in the title and description (spacing, line endings, trailing space, extra blank lines)", () => {
    expect(fp({ title: "  Advent   Carols  " })).toBe(fp());
    expect(fp({ description: "A service of carols.\r\nSung by the junior choir.  \r\n" })).toBe(fp());
    expect(fp({ description: "A service of carols.\n\n\n\nSung by the junior choir." })).not.toBe(fp()); // a paragraph break is collapsed to one blank line, which is still a difference from none
    expect(fp({ description: "A service of carols.\n\n\n\nSung by the junior choir." })).toBe(fp({ description: "A service of carols.\n\nSung by the junior choir." }));
  });

  it("ignores a cache-busting query string or fragment on the thumbnail (the picture is the same)", () => {
    expect(fp({ thumbnailUrl: "https://img.example.test/vi/abc123/hqdefault.jpg?v=987654" })).toBe(fp());
    expect(fp({ thumbnailUrl: "https://img.example.test/vi/abc123/hqdefault.jpg#x" })).toBe(fp());
  });

  it("ignores sub-second differences in the published time", () => {
    expect(fp({ publishedAt: new Date("2021-12-19T10:00:00.750Z") })).toBe(fp());
    expect(fp({ publishedAt: "2021-12-19T10:00:00Z" })).toBe(fp());
  });

  it("ignores Unicode composition differences (the same text typed two ways)", () => {
    expect(fp({ title: "Café Carols" })).toBe(fp({ title: "Café Carols" }));
  });

  it("has no input for volatile statistics, the etag, or playlist order: they cannot affect the fingerprint", () => {
    // The facts type carries only the material fields; statistics and technical fields are not inputs at all.
    const extra = { ...base, currentViewCount: 99999, currentLikeCount: 5, etag: "changed", position: 7 } as VideoMetadataFacts;
    expect(fingerprintFacts(extra)).toBe(fp());
  });

  it("is stable: the same facts always give the same fingerprint", () => {
    expect(fp()).toBe(fp());
    expect(fp()).toHaveLength(32);
  });
});

describe("the versioned snapshot", () => {
  it("is comparable only when it came from this version of the rules (otherwise a baseline is re-recorded, not reported as a change)", () => {
    expect(isComparableSnapshot(materialMetadata(base))).toBe(true);
    expect(isComparableSnapshot({ ...materialMetadata(base), version: "mm-meta-v0" })).toBe(false);
    expect(isComparableSnapshot(null)).toBe(false);
    expect(isComparableSnapshot("nope")).toBe(false);
    expect(materialMetadata(base).version).toBe(METADATA_FINGERPRINT_VERSION);
  });

  it("shortens long values in the change summary", () => {
    const long = "x".repeat(1000);
    const [change] = diffMaterial(materialMetadata(base), materialMetadata({ ...base, description: long }));
    expect(change.after!.length).toBeLessThan(400);
    expect(change.after!.endsWith("…")).toBe(true);
  });
});
