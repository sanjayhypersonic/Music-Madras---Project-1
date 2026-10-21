import { readFileSync } from "fs";
import path from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// F8 — the Museum frame's database use: bounded, shared, remembered briefly, never fatal, and absent for the site-wide 404.

const repo = vi.hoisted(() => ({
  resolveEditorialBlocks: vi.fn(),
  hasPublishedPlaylistPage: vi.fn(),
}));
vi.mock("../../modules/db/repositories/editorialContentRepository", () => ({ resolveEditorialBlocks: repo.resolveEditorialBlocks }));
vi.mock("../../modules/db/repositories/playlistPageRepository", () => ({ hasPublishedPlaylistPage: repo.hasPublishedPlaylistPage }));
vi.mock("../../app/fonts", () => ({ sansFont: { variable: "sans" }, serifFont: { variable: "serif" } }));
vi.mock("next/link", () => ({ default: () => null }));
vi.mock("next/image", () => ({ default: () => null }));
vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

import { CHROME_TTL_MS, STATIC_CHROME, getMuseumChrome, resetMuseumChromeForTests } from "../../modules/mmke/chrome/museumChrome";
import { MuseumShell } from "../../components/museum/MuseumShell";

const blocks = (slugs: string[], tagline?: string) => new Map(slugs.map((slug) => [slug, { slug, title: slug === "museum-footer-tagline" ? (tagline ?? "Tagline") : "T", body: null, seoTitle: null, seoDescription: null, source: "published" as const }]));
const root = path.resolve(__dirname, "../..");

beforeEach(() => {
  resetMuseumChromeForTests();
  repo.resolveEditorialBlocks.mockReset().mockResolvedValue(blocks(["museum-footer-tagline", "museum-home-story"], "Our tagline"));
  repo.hasPublishedPlaylistPage.mockReset().mockResolvedValue(true);
});

describe("getMuseumChrome", () => {
  it("reads at most two queries' worth (one editorial lookup, one playlist presence check) and reports what exists", async () => {
    const chrome = await getMuseumChrome(1_000);
    expect(repo.resolveEditorialBlocks).toHaveBeenCalledTimes(1);
    expect(repo.hasPublishedPlaylistPage).toHaveBeenCalledTimes(1);
    expect(chrome.tagline).toBe("Our tagline");
    expect([...chrome.availableContent].sort()).toEqual(["museum-footer-tagline", "museum-home-story", "playlists"]);
  });

  it("serves a burst of requests — including a scan of random URLs — from one refresh, and refreshes after the TTL", async () => {
    for (let i = 0; i < 200; i++) await getMuseumChrome(1_000 + i); // 200 requests inside the TTL
    expect(repo.resolveEditorialBlocks).toHaveBeenCalledTimes(1);
    expect(repo.hasPublishedPlaylistPage).toHaveBeenCalledTimes(1);
    await getMuseumChrome(1_000 + CHROME_TTL_MS + 1);
    expect(repo.resolveEditorialBlocks).toHaveBeenCalledTimes(2);
  });

  it("concurrent callers share the single refresh in flight", async () => {
    let release!: () => void;
    repo.resolveEditorialBlocks.mockReturnValue(new Promise((resolve) => { release = () => resolve(blocks([])); }));
    const calls = Promise.all(Array.from({ length: 50 }, () => getMuseumChrome(5_000)));
    release();
    await calls;
    expect(repo.resolveEditorialBlocks).toHaveBeenCalledTimes(1);
    expect(repo.hasPublishedPlaylistPage).toHaveBeenCalledTimes(1);
  });

  it("a failed read never breaks the page and is not remembered: the optional pieces are omitted, and the next request tries again", async () => {
    repo.hasPublishedPlaylistPage.mockRejectedValueOnce(new Error("database unavailable"));
    const failed = await getMuseumChrome(10_000);
    expect(failed).toBe(STATIC_CHROME);
    expect(failed.availableContent.size).toBe(0);
    const recovered = await getMuseumChrome(10_001);
    expect(recovered.availableContent.has("playlists")).toBe(true);
    expect(repo.hasPublishedPlaylistPage).toHaveBeenCalledTimes(2);
  });

  it("holds only navigation chrome: nothing about any video, page or approval", async () => {
    const chrome = await getMuseumChrome(20_000);
    expect(Object.keys(chrome).sort()).toEqual(["availableContent", "tagline"]);
  });
});

describe("MuseumShell", () => {
  it("the static frame touches no database at all", async () => {
    await MuseumShell({ children: null, chrome: "static" });
    expect(repo.resolveEditorialBlocks).not.toHaveBeenCalled();
    expect(repo.hasPublishedPlaylistPage).not.toHaveBeenCalled();
  });

  it("the dynamic frame uses the shared, cached chrome (one refresh for many page views)", async () => {
    for (let i = 0; i < 25; i++) await MuseumShell({ children: null });
    expect(repo.resolveEditorialBlocks).toHaveBeenCalledTimes(1);
    expect(repo.hasPublishedPlaylistPage).toHaveBeenCalledTimes(1);
  });

  it("the site-wide 404 (addresses that match no route) is rendered with the static frame, and the shell imports no repository of its own", () => {
    const notFound = readFileSync(path.join(root, "app/not-found.tsx"), "utf8");
    expect(notFound).toMatch(/<MuseumShell chrome="static">/);
    const shell = readFileSync(path.join(root, "components/museum/MuseumShell.tsx"), "utf8");
    expect(shell).not.toMatch(/repositories/);
  });
});
