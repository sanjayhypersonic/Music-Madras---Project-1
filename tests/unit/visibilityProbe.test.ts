import { describe, expect, it } from "vitest";
import { cacheConcerns, evaluateObservations, linksRecording, pickCacheHeaders, type Observation } from "../../modules/ops/visibilityProbe";

const obs = (surface: Observation["surface"], shown: boolean, extra: Partial<Observation> = {}): Observation => ({ surface, shown, inconclusive: false, status: 200, cache: {}, ...extra });

describe("evaluateObservations", () => {
  it("PRESENT needs every surface to show the Recording; ABSENT needs none to", () => {
    expect(evaluateObservations("PRESENT", [obs("page", true), obs("search", true), obs("sitemap", true)]).consistent).toBe(true);
    expect(evaluateObservations("ABSENT", [obs("page", false), obs("search", false), obs("sitemap", false)]).consistent).toBe(true);
  });

  it("names the surfaces that disagree (a stale sitemap after a hold, for instance)", () => {
    const result = evaluateObservations("ABSENT", [obs("page", false), obs("search", false), obs("sitemap", true)]);
    expect(result).toEqual({ consistent: false, wrong: ["sitemap"] });
  });

  it("an inconclusive observation (a 5xx, no answer) is never taken as agreement, and a missing surface is not consistent", () => {
    expect(evaluateObservations("ABSENT", [obs("page", false), obs("search", false), obs("sitemap", false, { inconclusive: true, status: 503 })])).toEqual({ consistent: false, wrong: ["sitemap"] });
    expect(evaluateObservations("ABSENT", [obs("page", false), obs("search", false)]).consistent).toBe(false);
  });
});

describe("cache reporting", () => {
  it("picks only cache-related headers", () => {
    const headers = new Headers({ "Cache-Control": "private, no-store", Age: "0", "Set-Cookie": "session=secret", "X-Vercel-Cache": "MISS" });
    expect(pickCacheHeaders(headers)).toEqual({ "cache-control": "private, no-store", age: "0", "x-vercel-cache": "MISS" });
  });

  it("flags a shared cache having served an answer, without deciding pass or fail", () => {
    const concerns = cacheConcerns([obs("page", true, { cache: { age: "42", "x-vercel-cache": "HIT", "cache-control": "public, s-maxage=60" } }), obs("sitemap", true, { cache: { "cache-control": "public, max-age=0, must-revalidate" } })]);
    expect(concerns.some((c) => c.startsWith("page: the answer carries Age: 42"))).toBe(true);
    expect(concerns.some((c) => c.includes("HIT"))).toBe(true);
    expect(concerns.some((c) => c.includes("allows shared caching"))).toBe(true);
    expect(concerns.some((c) => c.startsWith("sitemap"))).toBe(false); // max-age=0 revalidate is the documented sitemap setting
  });

  it("raises nothing for the documented no-store answers", () => {
    expect(cacheConcerns([obs("page", true, { cache: { "cache-control": "private, no-cache, no-store, max-age=0, must-revalidate" } })])).toEqual([]);
  });
});

describe("linksRecording", () => {
  it("matches the Recording's own path, not a longer slug that starts the same", () => {
    expect(linksRecording('<a href="/recordings/aria-one">', "aria-one")).toBe(true);
    expect(linksRecording("<loc>https://x.example/recordings/aria-one</loc>", "aria-one")).toBe(true);
    expect(linksRecording('<a href="/recordings/aria-one-live">', "aria-one")).toBe(false);
    expect(linksRecording('<a href="/works/aria-one">', "aria-one")).toBe(false);
  });
  it("treats regular-expression characters in a slug literally", () => {
    expect(linksRecording('<a href="/recordings/a.b">', "a.b")).toBe(true);
    expect(linksRecording('<a href="/recordings/axb">', "a.b")).toBe(false);
  });
});
