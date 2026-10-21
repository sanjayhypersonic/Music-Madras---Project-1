import { describe, expect, it } from "vitest";
import { scoreCandidate, selectFeatured, type RankingCandidate, type RankingParams } from "../../modules/mmke/featured/featuredRanking";
import { BUILT_IN_COPY, findBuiltInCopy } from "../../modules/mmke/editorial/builtInCopy";
import { findEditorialBlock, listPublishProblems } from "../../modules/mmke/editorial/editorialBlocks";
import { MUSEUM_NAV_LINKS, visibleNavLinks } from "../../components/museum/museumNavigation";

// Phase 6K-3 — featured ranking (pure), built-in copy integrity, derived navigation. Synthetic values only.

const NOW = new Date("2030-01-01T00:00:00.000Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
const params: RankingParams = { halfLifeDays: 100, recencyWeight: 0.5, now: NOW };
const c = (pageId: string, viewCount: number | null, publishedAt: Date | null): RankingCandidate => ({ pageId, viewCount, publishedAt });

describe("scoreCandidate", () => {
  it("is log(1+views) times a bounded recency factor", () => {
    const fresh = scoreCandidate(c("a", 99, NOW), params);
    expect(fresh.viewTerm).toBeCloseTo(Math.log(100), 10);
    expect(fresh.recencyFactor).toBeCloseTo(1, 10); // brand new
    const oneHalfLife = scoreCandidate(c("a", 99, daysAgo(100)), params);
    expect(oneHalfLife.recencyFactor).toBeCloseTo(0.5 + 0.5 * 0.5, 10);
    expect(oneHalfLife.score).toBeCloseTo(Math.log(100) * 0.75, 10);
  });

  it("recency never removes more than the configured weight, however old", () => {
    for (const weight of [0, 0.25, 0.5, 1]) {
      const ancient = scoreCandidate(c("a", 1000, daysAgo(100_000)), { ...params, recencyWeight: weight });
      expect(ancient.recencyFactor).toBeGreaterThanOrEqual(1 - weight - 1e-9);
      expect(ancient.recencyFactor).toBeLessThanOrEqual(1 - weight + 1e-6);
    }
    expect(scoreCandidate(c("a", 1000, daysAgo(100_000)), { ...params, recencyWeight: 0 }).recencyFactor).toBe(1); // weight 0 ignores age entirely
  });

  it("never guesses: no view count scores 0, no date is treated as fully aged, a future date is treated as new", () => {
    expect(scoreCandidate(c("a", null, NOW), params).score).toBe(0);
    expect(scoreCandidate(c("a", 0, NOW), params).score).toBe(0);
    expect(scoreCandidate(c("a", -5, NOW), params).score).toBe(0);
    expect(scoreCandidate(c("a", 100, null), params).recencyFactor).toBeCloseTo(0.5, 10);
    expect(scoreCandidate(c("a", 100, new Date(NOW.getTime() + 86_400_000)), params).ageDays).toBe(0);
  });

  it("is monotonic: more views is never worse, an older video is never better, all else equal", () => {
    for (const views of [1, 10, 1000]) expect(scoreCandidate(c("a", views + 1, daysAgo(5)), params).score).toBeGreaterThan(scoreCandidate(c("a", views, daysAgo(5)), params).score);
    for (const age of [0, 10, 500]) expect(scoreCandidate(c("a", 50, daysAgo(age + 10)), params).score).toBeLessThan(scoreCandidate(c("a", 50, daysAgo(age)), params).score);
  });

  it("a non-positive half-life cannot produce NaN", () => {
    expect(Number.isFinite(scoreCandidate(c("a", 10, daysAgo(10)), { ...params, halfLifeDays: 0 }).score)).toBe(true);
  });
});

describe("selectFeatured", () => {
  const pool = [c("old-popular", 100_000, daysAgo(2000)), c("new-modest", 2000, daysAgo(10)), c("mid", 5000, daysAgo(300)), c("nothing", null, null)];

  it("pinned videos come first, in the editors' order, then the best automatic ones", () => {
    const slots = selectFeatured({ pinned: ["nothing", "mid"], candidates: pool, count: 3, autoFill: true, params });
    expect(slots.map((s) => [s.pageId, s.source])).toEqual([["nothing", "PINNED"], ["mid", "PINNED"], [slots[2].pageId, "AUTOMATIC"]]);
    expect(slots[2].pageId).not.toBe("nothing");
    expect(slots[2].pageId).not.toBe("mid");
    expect(slots[0].reason).toMatch(/Pinned by the editors \(position 1\)/);
  });

  it("with automatic fill off only pinned videos appear, and an empty pin list yields nothing", () => {
    expect(selectFeatured({ pinned: ["mid"], candidates: pool, count: 6, autoFill: false, params }).map((s) => s.pageId)).toEqual(["mid"]);
    expect(selectFeatured({ pinned: [], candidates: pool, count: 6, autoFill: false, params })).toEqual([]);
  });

  it("never exceeds the count, never repeats a video, and truncates pins beyond the count", () => {
    const slots = selectFeatured({ pinned: ["a", "b", "a", "c"], candidates: pool, count: 2, autoFill: true, params });
    expect(slots.map((s) => s.pageId)).toEqual(["a", "b"]);
    const filled = selectFeatured({ pinned: [], candidates: pool, count: 10, autoFill: true, params });
    expect(new Set(filled.map((s) => s.pageId)).size).toBe(filled.length);
    expect(filled.length).toBe(pool.length);
    expect(selectFeatured({ pinned: [], candidates: pool, count: 0, autoFill: true, params })).toEqual([]);
  });

  it("an unpinned candidate that is also pinned is not duplicated by the automatic fill", () => {
    const slots = selectFeatured({ pinned: ["mid"], candidates: pool, count: 4, autoFill: true, params });
    expect(slots.filter((s) => s.pageId === "mid")).toHaveLength(1);
  });

  it("every automatic slot explains itself from evidence that exists, and invents nothing", () => {
    const slots = selectFeatured({ pinned: [], candidates: pool, count: 4, autoFill: true, params });
    for (const slot of slots) expect(slot.reason).toMatch(/^Automatic: (\d+ views on YouTube|no view count recorded), (published \d+ days? ago|no publication date recorded) \(score \d+\.\d{2}\)\.$/);
    expect(slots.find((s) => s.pageId === "nothing")!.reason).toContain("no view count recorded");
    expect(slots.map((s) => s.reason).join(" ")).not.toMatch(/watch time|click|engagement|retention|impression/i);
  });

  it("the order is deterministic, with ties broken by newer first and then by id", () => {
    const tied = [c("b", 100, daysAgo(5)), c("a", 100, daysAgo(5)), c("c", 100, daysAgo(1))];
    const first = selectFeatured({ pinned: [], candidates: tied, count: 3, autoFill: true, params: { ...params, recencyWeight: 0 } });
    expect(first.map((s) => s.pageId)).toEqual(["c", "a", "b"]);
    expect(selectFeatured({ pinned: [], candidates: [...tied].reverse(), count: 3, autoFill: true, params: { ...params, recencyWeight: 0 } }).map((s) => s.pageId)).toEqual(["c", "a", "b"]);
  });

  it("the recency weight changes who wins: weight 0 prefers the most viewed, a high weight prefers the newer", () => {
    const two = [c("classic", 100_000, daysAgo(3000)), c("fresh", 3000, daysAgo(2))];
    expect(selectFeatured({ pinned: [], candidates: two, count: 1, autoFill: true, params: { ...params, recencyWeight: 0 } })[0].pageId).toBe("classic");
    expect(selectFeatured({ pinned: [], candidates: two, count: 1, autoFill: true, params: { ...params, recencyWeight: 1, halfLifeDays: 30 } })[0].pageId).toBe("fresh");
  });
});

describe("built-in copy", () => {
  it("only registered blocks have built-in copy", () => {
    for (const slug of Object.keys(BUILT_IN_COPY)) expect(findEditorialBlock(slug), slug).toBeDefined();
  });

  it("each built-in entry is complete for its block, so 'start a draft from the built-in text' is publishable as it stands", () => {
    for (const slug of Object.keys(BUILT_IN_COPY)) {
      const block = findEditorialBlock(slug)!;
      expect(listPublishProblems(block, findBuiltInCopy(slug)!), slug).toEqual([]);
    }
  });

  it("blocks introduced in 6K-3 carry no built-in copy (their words are stored content from the start)", () => {
    expect(findBuiltInCopy("museum-videos-intro")).toBeNull();
    expect(findBuiltInCopy("museum-playlists-intro")).toBeNull();
  });
});

describe("derived navigation", () => {
  it("drops a link whose target block is not on the site, and keeps every other link", () => {
    const nothing = visibleNavLinks(MUSEUM_NAV_LINKS, new Set(["museum-footer-tagline"]));
    expect(nothing.map((l) => l.label)).not.toContain("About");
    expect(nothing.map((l) => l.label)).not.toContain("Playlists");
    expect(nothing).toHaveLength(MUSEUM_NAV_LINKS.length - 2);
    expect(visibleNavLinks(MUSEUM_NAV_LINKS, new Set(["museum-home-story"])).map((l) => l.label)).toContain("About");
    expect(visibleNavLinks(MUSEUM_NAV_LINKS, new Set(["playlists"])).map((l) => l.label)).toContain("Playlists");
    expect(visibleNavLinks(MUSEUM_NAV_LINKS, new Set(["museum-home-story", "playlists"]))).toHaveLength(MUSEUM_NAV_LINKS.length);
  });

  it("includes the Videos catalogue", () => {
    expect(MUSEUM_NAV_LINKS.some((l) => l.href === "/videos" && l.label === "Videos")).toBe(true);
  });
});
