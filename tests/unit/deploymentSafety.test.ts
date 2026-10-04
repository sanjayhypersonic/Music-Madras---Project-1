import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "fs";
import path from "path";
import { GET as healthGET } from "../../app/api/health/route";

// Phase 6J-1 — build/deployment safety: the health probe and the
// environment-variable hygiene of the repository. (The integration-test database
// guard is covered by tests/unit/testDatabaseIsolation.test.ts.)

const root = path.resolve(__dirname, "../..");
const read = (relative: string) => readFileSync(path.join(root, relative), "utf8");

describe("health probe", () => {
  it("answers ok, is never cached, and reveals nothing else", async () => {
    const response = healthGET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it("does not touch the database or read configuration", () => {
    const source = read("app/api/health/route.ts");
    expect(source).not.toMatch(/prisma|process\.env|\$queryRaw/);
    expect(source).toContain('export const dynamic = "force-dynamic"');
  });
});

describe("build and environment hygiene", () => {
  const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };

  it("the production build regenerates the Prisma client first, so it can never compile against a stale one", () => {
    expect(pkg.scripts.build).toMatch(/^prisma generate && next build$/);
  });

  it("migrations are a separate, explicit release step — never run implicitly by build or start", () => {
    expect(pkg.scripts.build).not.toMatch(/migrate/);
    expect(pkg.scripts.start).not.toMatch(/migrate/);
    expect(pkg.scripts["prisma:migrate:deploy"]).toBe("prisma migrate deploy");
  });

  it(".gitignore keeps every real env file out of the repository but leaves the example", () => {
    const ignore = read(".gitignore").split(/\r?\n/).map((l) => l.trim());
    expect(ignore).toContain(".env");
    expect(ignore).toContain(".env.*");
    expect(ignore).toContain("!.env.example");
  });

  describe(".env.example", () => {
    const example = read(".env.example");
    const declared = new Set([...example.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]));

    it("documents every variable the deployment needs, including the founder bootstrap and the public origin", () => {
      for (const name of [
        "DATABASE_URL", "DIRECT_URL", "AUTH_SECRET", "AUTH_URL", "PUBLIC_SITE_URL",
        "EMAIL_PROVIDER", "SMTP_URL", "EMAIL_FROM", "FOUNDER_EMAIL", "FOUNDER_NAME",
        "YOUTUBE_API_KEY", "YOUTUBE_CHANNEL_ID",
      ]) expect(declared.has(name), name).toBe(true);
    });

    it("lists no variable that no code reads (obsolete placeholders are removed)", () => {
      for (const name of ["BLOB_READ_WRITE_TOKEN", "CRON_SECRET", "EMAIL_PROVIDER_API_KEY"]) expect(declared.has(name), name).toBe(false);
    });

    it("contains placeholders only — no value that looks like a real secret or connection string", () => {
      for (const line of example.split(/\r?\n/)) {
        if (!/^[A-Z][A-Z0-9_]*=/.test(line)) continue;
        const value = line.slice(line.indexOf("=") + 1).trim();
        // A connection string may appear only with the literal USER:PASSWORD placeholder credentials.
        const credentials = value.match(/^[a-z]+:\/\/([^:\s/]+:[^@\s]+)@/)?.[1];
        if (credentials) expect(credentials, line).toBe("USER:PASSWORD");
        expect(value, line).not.toMatch(/AIza[0-9A-Za-z_-]{20,}|sk-[A-Za-z0-9_-]{20,}/);
      }
    });
  });

  it("the committed operator script exists and is the documented npm entry point", () => {
    expect(existsSync(path.join(root, "scripts/runYouTubeFullSync.ts"))).toBe(true);
    expect(pkg.scripts["youtube:full-sync"]).toBe("tsx scripts/runYouTubeFullSync.ts");
  });
});
