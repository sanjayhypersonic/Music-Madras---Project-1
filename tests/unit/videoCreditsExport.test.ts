import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  buildVideoCreditsExportFile,
  defaultExportPath,
  describeExportTarget,
  parseVideoCreditsExportArgs,
  resolveVideoCreditsExportTarget,
  toExportedVideo,
} from "../../modules/jobs/videoCreditsExport";
import {
  READ_ONLY_STATEMENT,
  VIDEO_CREDITS_EXPORT_WHERE,
  readVideoCreditsExportBatch,
  type VideoCreditsExportClient,
} from "../../modules/db/repositories/videoCreditsExportQuery";

// Credits extraction, route 2: the staging export. FAKE data only: every URL below is invented, and the read is exercised against a fake
// transaction client that records what it is asked to do. No database is touched.

const root = path.resolve(__dirname, "../..");
const FAKE_PASSWORD = "fake-pw-not-real";
const url = (database: string, extra = "") => `postgresql://fake_user:${FAKE_PASSWORD}@ep-fake-host-pooler.example.test/${database}${extra}`;

describe("parseVideoCreditsExportArgs", () => {
  it("requires --env-file and defaults to counts only", () => {
    expect(parseVideoCreditsExportArgs([]).ok).toBe(false);
    expect(parseVideoCreditsExportArgs(["--env-file", "s.env"])).toEqual({ ok: true, args: { envFile: "s.env", limit: null, offset: 0, write: false, outFile: null } });
  });

  it("takes --limit, --offset, --write and --out", () => {
    expect(parseVideoCreditsExportArgs(["--env-file", "s.env", "--limit", "25", "--offset", "50", "--write", "--out", "reports/x.json"])).toEqual({
      ok: true,
      args: { envFile: "s.env", limit: 25, offset: 50, write: true, outFile: "reports/x.json" },
    });
  });

  it("refuses bad numbers, unknown flags, a flag without a value, and --out without --write", () => {
    for (const argv of [
      ["--env-file", "s.env", "--limit", "0"],
      ["--env-file", "s.env", "--limit", "2.5"],
      ["--env-file", "s.env", "--offset", "-1"],
      ["--env-file", "s.env", "--execute"],
      ["--env-file"],
      ["--env-file", "s.env", "--out", "reports/x.json"],
    ]) {
      expect(parseVideoCreditsExportArgs(argv).ok, argv.join(" ")).toBe(false);
    }
  });
});

describe("resolveVideoCreditsExportTarget (the database guard)", () => {
  const resolve = (databaseUrl: string | undefined, nodeEnv?: string) => resolveVideoCreditsExportTarget({ databaseUrl, nodeEnv });

  it("accepts a staging database, drops the original query string and requires TLS", () => {
    const r = resolve(url("music_madras_staging", "?sslmode=require&channel_binding=require"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(describeExportTarget(r.target)).toBe("ep-fake-host-pooler.example.test/music_madras_staging");
    expect(r.target.connectionString).toBe(`postgresql://fake_user:${FAKE_PASSWORD}@ep-fake-host-pooler.example.test:5432/music_madras_staging?sslmode=require`);
  });

  it("refuses production-, test- and non-staging-named databases, whatever the letter case", () => {
    for (const name of ["music_madras_prod", "music_madras_staging_production", "Music_Madras_PROD_copy", "music_madras_staging_test", "music_madras_TEST", "music_madras", "neondb"]) {
      expect(resolve(url(name)).ok, name).toBe(false);
    }
  });

  it("refuses a missing or unusable DATABASE_URL, another protocol, no user, and NODE_ENV=production", () => {
    expect(resolve(undefined).ok).toBe(false);
    expect(resolve("   ").ok).toBe(false);
    expect(resolve("not a url").ok).toBe(false);
    expect(resolve("mysql://u:p@h/music_madras_staging").ok).toBe(false);
    expect(resolve("postgresql://ep-fake.example.test/music_madras_staging").ok).toBe(false);
    expect(resolve("postgresql://u:p@ep-fake.example.test/").ok).toBe(false);
    expect(resolve(url("music_madras_staging"), "production").ok).toBe(false);
  });

  it("never puts the password or user name in a refusal", () => {
    for (const name of ["music_madras_prod", "music_madras_test", "neondb"]) {
      const r = resolve(url(name));
      expect(r.ok).toBe(false);
      if (r.ok) continue;
      expect(r.reason).not.toContain(FAKE_PASSWORD);
      expect(r.reason).not.toContain("fake_user");
      expect(r.reason).toContain("ep-fake-host-pooler.example.test");
    }
  });
});

describe("readVideoCreditsExportBatch (the read, against a fake transaction)", () => {
  function fakeClient() {
    const calls: string[] = [];
    const client = {
      $executeRawUnsafe: async (sql: string) => {
        calls.push(`execute:${sql}`);
        return 0;
      },
      youTubeVideo: {
        count: async (args: unknown) => {
          calls.push(`count:${JSON.stringify(args)}`);
          return 2;
        },
        findMany: async (args: { skip?: number; take?: number }) => {
          calls.push(`findMany:skip=${args.skip},take=${args.take}`);
          return [
            {
              youtubeVideoId: "FAKEvid0001",
              title: "Fake title",
              description: "Fake description",
              publishedAt: new Date("2024-03-10T10:00:00.000Z"),
              playlistItems: [{ playlist: { title: "Fake B" } }, { playlist: { title: null } }, { playlist: { title: "Fake A" } }],
            },
          ];
        },
      },
    };
    return { calls, client: client as unknown as VideoCreditsExportClient };
  }

  it("makes the transaction read-only FIRST, then only counts and selects", async () => {
    const { calls, client } = fakeClient();
    const result = await readVideoCreditsExportBatch(client, { limit: 25, offset: 50 });
    expect(calls[0]).toBe(`execute:${READ_ONLY_STATEMENT}`);
    expect(READ_ONLY_STATEMENT).toBe("SET TRANSACTION READ ONLY");
    expect(calls.slice(1).map((c) => c.split(":")[0])).toEqual(["count", "findMany"]);
    expect(calls[2]).toBe("findMany:skip=50,take=25");
    expect(result.totalMatching).toBe(2);
    expect(result.rows[0].playlistTitles).toEqual(["Fake B", null, "Fake A"]);
  });

  it("takes everything after the offset when there is no limit", async () => {
    const { calls, client } = fakeClient();
    await readVideoCreditsExportBatch(client, { limit: null, offset: 0 });
    expect(calls[2]).toBe("findMany:skip=0,take=undefined");
  });

  it("selects public, observed videos with a non-empty description", () => {
    expect(VIDEO_CREDITS_EXPORT_WHERE).toEqual({ privacyStatus: "public", observabilityState: "OBSERVED", description: { not: null }, NOT: [{ description: "" }] });
  });
});

describe("the export file", () => {
  const rows = [
    { youtubeVideoId: "FAKEvid0001", title: "T1", description: "D1", publishedAt: new Date("2024-03-10T10:00:00.000Z"), playlistTitles: ["Fake B", null, " Fake A ", "Fake B"] },
    { youtubeVideoId: "FAKEvid0002", title: "T2", description: "  \n ", publishedAt: null, playlistTitles: [] },
  ];

  it("keeps the five fields, sorts and de-duplicates playlist titles, and leaves out blank descriptions", () => {
    const { file, droppedBlankDescriptions } = buildVideoCreditsExportFile({
      generatedAt: new Date("2026-11-14T09:00:00.000Z"),
      target: { host: "ep-fake.example.test", database: "fake_staging" },
      args: { offset: 0, limit: 25 },
      totalMatching: 2,
      rows,
    });
    expect(droppedBlankDescriptions).toBe(1);
    expect(file.videos).toEqual([{ youtubeVideoId: "FAKEvid0001", title: "T1", description: "D1", publishedAt: "2024-03-10T10:00:00.000Z", playlistTitles: ["Fake A", "Fake B"] }]);
    expect(file).toMatchObject({ kind: "video-credits-export", version: 1, source: { host: "ep-fake.example.test", database: "fake_staging" }, offset: 0, limit: 25, totalMatching: 2 });
    expect(JSON.stringify(file)).not.toMatch(/password|postgresql:\/\//i);
  });

  it("maps a missing date to null", () => {
    expect(toExportedVideo({ ...rows[0], publishedAt: null }).publishedAt).toBeNull();
  });

  it("names the default file after the batch", () => {
    expect(defaultExportPath(new Date("2026-11-14T09:00:00.000Z"), 25, 25)).toBe(path.join("reports", "video-credits", "export-o0025-n25-2026-11-14T09-00-00-000Z.json"));
  });
});

describe("static guard: the export can only read", () => {
  const source = (file: string) => readFileSync(path.join(root, file), "utf8");

  it("the query and the repository contain no write and no raw SQL other than SET TRANSACTION READ ONLY", () => {
    for (const file of ["modules/db/repositories/videoCreditsExportQuery.ts", "modules/db/repositories/videoCreditsExportRepository.ts"]) {
      const code = source(file).replace(/\/\/.*$/gm, "");
      expect(code, file).not.toMatch(/\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/);
      expect(code, file).not.toMatch(/\$executeRaw\b|\$queryRaw|\$queryRawUnsafe/);
      expect((code.match(/\$executeRawUnsafe\(/g) ?? []).length, file).toBe(file.endsWith("Query.ts") ? 1 : 0);
    }
    expect(source("modules/db/repositories/videoCreditsExportQuery.ts")).not.toMatch(/from "\.\.\/client"/);
  });

  it("the script takes the database only from the --env-file file, binds the client after the guard, and never prints the URL", () => {
    const code = source("scripts/exportVideoCreditsSource.ts");
    expect(code).toMatch(/parse\(readFileSync\(envFile\)\)\.DATABASE_URL/);
    expect(code.indexOf("resolveVideoCreditsExportTarget(")).toBeLessThan(code.indexOf('await import("../modules/db/repositories/videoCreditsExportRepository")'));
    expect(code).not.toMatch(/^import .*videoCreditsExportRepository/m);
    expect(code).not.toMatch(/console\.(log|error)\([^)]*(connectionString|databaseUrl|DATABASE_URL)/);
    expect(code).not.toMatch(/secrets/i);
    expect(code).toMatch(/error\.name/);
  });
});
