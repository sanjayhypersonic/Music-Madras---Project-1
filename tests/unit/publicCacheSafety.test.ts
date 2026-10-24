import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

// Public cache safety for Recording holds (project register R-22).
//
// VERIFIED 2026-10-24 on a production build (`next build` + `next start`, test database, no restart and no invalidation between steps): the public
// Museum routes are NOT cached by the application. Every Recording-related surface followed a hold being imposed and lifted on the very next request: the
// Recording page and the work, performance, programme, venue, composer and occasion pages (200 -> 404 -> 200), the collection page, the video page's link to
// the Recording, archive search and the sitemap (mentioned -> not mentioned -> mentioned). Pages answer `private, no-cache, no-store` and the sitemap
// `public, max-age=0, must-revalidate`; the prerender manifest lists no Museum route and no ISR entry.
//
// That holds only while NO public route opts into caching. The architecture decision (ADR-0001 §10) plans SSG + on-demand ISR on Vercel for these routes. The day
// any caching construct appears under a public route, every visibility change (publish, unpublish, archive, restore, Recording hold, video hold and approval...)
// must revalidate the affected paths, or a held Recording would keep being served. These tests make that day impossible to miss: they fail when a caching
// construct is introduced, and they require the hold actions to revalidate public paths if one ever is.

const root = path.resolve(__dirname, "../..");
const read = (relative: string) => readFileSync(path.join(root, relative), "utf8");
const code = (relative: string) => read(relative).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(path.join(root, dir))) {
    const relative = `${dir}/${name}`;
    if (statSync(path.join(root, relative)).isDirectory()) out.push(...sourceFiles(relative));
    else if (/\.(ts|tsx)$/.test(name)) out.push(relative);
  }
  return out;
}

/** Constructs that make a response (or a data read) outlive the request that produced it. */
const CACHING = /\bexport\s+const\s+revalidate\b|\bgenerateStaticParams\b|\bunstable_cache\b|["']use cache["']|\bcacheLife\b|\bcacheTag\b|\bnext:\s*\{[^}]*revalidate|\bexport\s+const\s+dynamic\s*=\s*["'](?:force-static|error)["']|\bexport\s+const\s+fetchCache\b/;

// Everything a visitor can reach, plus the data layer those routes read through.
const PUBLIC_FILES = [...sourceFiles("app/(museum)"), "app/sitemap.ts", "app/robots.ts", ...sourceFiles("modules/db"), ...sourceFiles("modules/mmke")];

const cachingFound = () => PUBLIC_FILES.filter((file) => CACHING.test(code(file)));

describe("public routes are uncached today (verified on a production build)", () => {
  it("no public route, sitemap, robots file or public data reader opts into caching", () => {
    expect(cachingFound(), "A caching construct was added under a public route or reader. Before it ships, every visibility change must revalidate the affected paths — see register R-22.").toEqual([]);
  });

  it("the framework is not configured to cache or retain public responses either", () => {
    const config = code("next.config.ts");
    expect(config).not.toMatch(/cacheComponents|cacheHandler|cacheMaxMemorySize|staleTimes|isrMemoryCacheSize|ppr\b|incrementalCacheHandlerPath/);
  });

  it("the Museum has no middleware or proxy that could cache or rewrite responses", () => {
    for (const file of ["middleware.ts", "proxy.ts", "src/middleware.ts", "src/proxy.ts"]) {
      expect(() => statSync(path.join(root, file)), file).toThrow();
    }
  });

  it("the server-side readers keep no process-level memory of a Recording's visibility (module-level Map/Set/cache objects)", () => {
    for (const file of ["modules/db/repositories/recordingRepository.ts", "modules/db/repositories/entityRelationshipsRepository.ts", "modules/db/repositories/archiveSearchRepository.ts", "modules/db/repositories/sitemapRepository.ts", "modules/db/repositories/publicEligibility.ts", "modules/db/repositories/occasionPageRepository.ts", "modules/db/repositories/mediaResourceRepository.ts"]) {
      expect(code(file), file).not.toMatch(/^(?:export\s+)?const\s+\w*[Cc]ache\w*\s*=|^(?:export\s+)?const\s+\w+\s*=\s*new\s+(?:Map|Set|WeakMap|LRUCache)\b/m);
    }
  });
});

describe("if public caching is ever introduced, holds must invalidate it", () => {
  it("is a no-op while nothing is cached, and otherwise requires the hold actions to revalidate the Recording's public path and the pages that list it", () => {
    const actions = code("app/(studio)/studio/(protected)/recordings/[id]/review/actions.ts");
    const hold = (name: string) => {
      const body = actions.slice(actions.indexOf(`export async function ${name}`));
      const end = body.indexOf("export async function", 10);
      return end === -1 ? body : body.slice(0, end);
    };
    const revalidatesPublic = (fn: string) => /revalidate(?:Path|Tag)\(\s*[`"']\/(?:recordings|archive|sitemap|performances|works|venues|programmes|occasions|collections)|revalidateTag\(/.test(fn) || /revalidatePublic/.test(fn);
    if (cachingFound().length === 0) return; // nothing is cached: there is nothing to invalidate (the other tests pin that)
    expect(revalidatesPublic(hold("imposeHoldAction")), "imposeHoldAction must revalidate public paths once public caching exists (R-22)").toBe(true);
    expect(revalidatesPublic(hold("liftHoldAction")), "liftHoldAction must revalidate public paths once public caching exists (R-22)").toBe(true);
  });
});
