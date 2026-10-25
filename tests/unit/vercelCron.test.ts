import { existsSync, readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

// The repository's Vercel configuration (vercel.json). The free Hobby plan accepts only cron expressions that run once a day (a more frequent one fails the deployment),
// so the stewardship schedule is pinned: one entry, daily, 03:30 UTC (09:00 IST), pointing at a route that exists and authenticates with CRON_SECRET.

const root = path.resolve(__dirname, "../..");
const config = JSON.parse(readFileSync(path.join(root, "vercel.json"), "utf8")) as { crons?: Array<{ path: string; schedule: string }> };

/** Vercel cron expressions are five fields (minute hour day-of-month month day-of-week), UTC. "Once a day" = fixed minute and hour, every other field open. */
const runsOncePerDay = (schedule: string) => /^\d{1,2} \d{1,2} \* \* \*$/.test(schedule.trim());

describe("vercel.json crons", () => {
  it("has exactly one cron, for the stewardship endpoint, at 03:30 UTC daily", () => {
    expect(config.crons).toEqual([{ path: "/api/cron/stewardship", schedule: "30 3 * * *" }]);
  });

  it("every schedule runs at most once a day (the Hobby plan refuses anything more frequent at deploy time)", () => {
    for (const cron of config.crons ?? []) expect(runsOncePerDay(cron.schedule), cron.schedule).toBe(true);
  });

  it("no cron entry uses a sub-daily schedule such as every ten minutes", () => {
    const text = readFileSync(path.join(root, "vercel.json"), "utf8");
    expect(text).not.toMatch(/\*\/\d+/);
  });

  // Vercel calls the cron path with a plain GET on the project's PRODUCTION DEPLOYMENT URL (https://<project>.vercel.app/<path>, per its docs), not on the custom
  // domain, and it does NOT follow redirects: a 3xx answer ends the invocation and the run silently never happens. So nothing in the repository may redirect (or
  // rewrite) the cron path: no redirect or rewrite rules, no trailing-slash normalisation, no middleware or proxy, and no redirect from the route itself. The apex ->
  // www domain redirect is a Vercel dashboard setting, not a repository rule, and Vercel applies it to the custom domain, not to the deployment URL.
  describe("nothing in the repository can redirect the cron request", () => {
    const text = (relative: string) => readFileSync(path.join(root, relative), "utf8");
    const code = (relative: string) => text(relative).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

    it("vercel.json has no redirects, rewrites or trailing-slash rules (a rule added later must exclude /api/cron)", () => {
      const keys = Object.keys(JSON.parse(text("vercel.json")));
      for (const key of ["redirects", "rewrites", "trailingSlash", "cleanUrls", "routes"]) expect(keys, key).not.toContain(key);
    });

    it("next.config.ts has no redirects, rewrites, trailing-slash or base-path setting", () => {
      expect(code("next.config.ts")).not.toMatch(/\bredirects\s*\(|\brewrites\s*\(|trailingSlash|basePath|skipTrailingSlashRedirect/);
    });

    it("there is no middleware or proxy that could answer the request first", () => {
      for (const file of ["middleware.ts", "proxy.ts", "src/middleware.ts", "src/proxy.ts"]) expect(existsSync(path.join(root, file)), file).toBe(false);
    });

    it("every cron path is written without a trailing slash, and its route never redirects and is never cached", () => {
      for (const cron of config.crons ?? []) {
        expect(cron.path.endsWith("/"), cron.path).toBe(false);
        const source = code(path.join("app", ...cron.path.split("/").filter(Boolean), "route.ts"));
        expect(source).not.toMatch(/\bredirect\s*\(|NextResponse\.redirect|Response\.redirect|status:\s*30[1278]/);
        expect(source).toMatch(/export const dynamic = "force-dynamic"/);
      }
    });
  });

  it("each cron path is an existing route handler that authenticates with CRON_SECRET", () => {
    for (const cron of config.crons ?? []) {
      const file = path.join(root, "app", ...cron.path.split("/").filter(Boolean), "route.ts");
      expect(existsSync(file), cron.path).toBe(true);
      const source = readFileSync(file, "utf8");
      expect(source).toMatch(/authoriseCronRequest/);
      expect(source).toMatch(/export const GET = handle/); // Vercel invokes cron paths with GET
    }
  });
});
