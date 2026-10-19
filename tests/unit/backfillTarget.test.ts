import { readFileSync, readdirSync } from "fs";
import path from "path";
import { Client } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readConfiguredRealDatabaseUrls, type EnvFileSystem } from "../../modules/backfill/revisionRelationships/backfillRealDatabases";
import {
  BACKFILL_TARGET_MARKER,
  REQUIRED_MIGRATION,
  describeClientDestination,
  describeTarget,
  parseBackfillDatabaseUrl,
  resolveBackfillTarget,
  verifyBackfillTargetDatabase,
  type Queryable,
} from "../../modules/backfill/revisionRelationships/backfillTarget";
import { TEST_DATABASE_MARKER } from "../integration/setup/testDatabaseRules";

// Phase 6J-11C — which database the backfill may touch. Synthetic URLs only (a fake password is used to prove it never leaks).

const LOCAL = "postgresql://postgres:s3cretpw@127.0.0.1:54329/music_madras_test";
const CONFIRM = "127.0.0.1:54329/music_madras_test";
const REAL_REMOTE = "postgresql://owner:realpw@ep-real-db-pooler.eu.example.com/neondb?sslmode=require";

const resolve = (env: Record<string, string | undefined>, realUrls: string[] = [REAL_REMOTE]) => resolveBackfillTarget({ env, realUrls });

describe("resolveBackfillTarget", () => {
  it("accepts exactly the explicitly configured, acknowledged, loopback test database", () => {
    const result = resolve({ BACKFILL_DATABASE_URL: LOCAL, BACKFILL_TARGET_CONFIRM: CONFIRM });
    expect(result).toMatchObject({
      ok: true,
      host: "127.0.0.1",
      port: "54329",
      database: "music_madras_test",
      clientConfig: { host: "127.0.0.1", port: 54329, database: "music_madras_test", user: "postgres", password: "s3cretpw" },
    });
    expect(result).not.toHaveProperty("connectionString"); // the raw string is not carried forward: only validated fields are
    expect(describeTarget(result as never)).toBe(CONFIRM);
    expect(resolve({ BACKFILL_DATABASE_URL: LOCAL, BACKFILL_TARGET_CONFIRM: CONFIRM.toUpperCase() }).ok).toBe(true); // the acknowledgement is case-insensitive
  });

  it("NEVER falls back to DATABASE_URL / DIRECT_URL / TEST_DATABASE_URL: without BACKFILL_DATABASE_URL it refuses", () => {
    for (const fallbackKey of ["DATABASE_URL", "DIRECT_URL", "TEST_DATABASE_URL", "POSTGRES_URL"]) {
      const result = resolve({ [fallbackKey]: LOCAL, BACKFILL_TARGET_CONFIRM: CONFIRM });
      expect(result.ok, fallbackKey).toBe(false);
      expect((result as { reason: string }).reason).toMatch(/BACKFILL_DATABASE_URL is not set/);
    }
    expect(resolve({}).ok).toBe(false);
    expect(resolve({ BACKFILL_DATABASE_URL: "   " }).ok).toBe(false);
  });

  it("refuses a production environment, a malformed URL and a non-postgres URL", () => {
    expect(resolve({ BACKFILL_DATABASE_URL: LOCAL, BACKFILL_TARGET_CONFIRM: CONFIRM, NODE_ENV: "production" }).ok).toBe(false);
    expect(resolve({ BACKFILL_DATABASE_URL: LOCAL, BACKFILL_TARGET_CONFIRM: CONFIRM, VERCEL_ENV: "production" }).ok).toBe(false);
    expect(resolve({ BACKFILL_DATABASE_URL: "not a url", BACKFILL_TARGET_CONFIRM: "x" }).ok).toBe(false);
    expect(resolve({ BACKFILL_DATABASE_URL: "mysql://u@127.0.0.1/music_madras_test", BACKFILL_TARGET_CONFIRM: "127.0.0.1:5432/music_madras_test" }).ok).toBe(false);
    expect(resolve({ BACKFILL_DATABASE_URL: "postgresql://u@127.0.0.1:54329/", BACKFILL_TARGET_CONFIRM: "x" }).ok).toBe(false); // no database name
  });

  it("refuses EVERY remote host — even one named like a test database, even with a matching acknowledgement", () => {
    const remotes = [
      "postgresql://u:p@ep-anything.eu.example.com:5432/music_madras_test",
      "postgresql://u:p@10.0.0.5:5432/music_madras_test",
      "postgresql://u:p@staging.example.com:5432/music_madras_test",
      "postgresql://u:p@ep-real-db-pooler.eu.example.com:5432/neondb",
    ];
    for (const url of remotes) {
      const parsed = parseBackfillDatabaseUrl(url)!;
      const result = resolve({ BACKFILL_DATABASE_URL: url, BACKFILL_TARGET_CONFIRM: describeTarget(parsed) });
      expect(result.ok, url).toBe(false);
      expect((result as { reason: string }).reason).toMatch(/not a loopback IP address/);
    }
  });

  it("accepts only loopback IP literals: host names and alternative spellings of an address are refused", () => {
    for (const host of ["localhost", "LOCALHOST", "127.1", "0x7f.0.0.1", "2130706433", "127.0.0.1.", "0.0.0.0", "127.0.0.2", "[::]", "[::ffff:7f00:1]"]) {
      const url = `postgresql://u@${host}:54329/music_madras_test`;
      const result = resolve({ BACKFILL_DATABASE_URL: url, BACKFILL_TARGET_CONFIRM: `${host.toLowerCase()}:54329/music_madras_test` });
      expect(result.ok, host).toBe(false);
    }
    const v6 = resolve({ BACKFILL_DATABASE_URL: "postgresql://u@[::1]:54329/music_madras_test", BACKFILL_TARGET_CONFIRM: "[::1]:54329/music_madras_test" });
    expect(v6).toMatchObject({ ok: true, clientConfig: { host: "::1", port: 54329 } });
    expect(resolve({ BACKFILL_DATABASE_URL: "postgresql://u@[0:0:0:0:0:0:0:1]:54329/music_madras_test", BACKFILL_TARGET_CONFIRM: "[::1]:54329/music_madras_test" }).ok).toBe(true); // same address, normalised
  });

  it("does not infer safety from a name: a loopback database without a test word is refused", () => {
    for (const name of ["music_madras", "postgres", "production", "latest", "contest"]) {
      const url = `postgresql://u@127.0.0.1:54329/${name}`;
      expect(resolve({ BACKFILL_DATABASE_URL: url, BACKFILL_TARGET_CONFIRM: `127.0.0.1:54329/${name}` }).ok, name).toBe(false);
    }
  });

  it("requires the operator to name the target: a missing or different BACKFILL_TARGET_CONFIRM refuses", () => {
    expect(resolve({ BACKFILL_DATABASE_URL: LOCAL }).ok).toBe(false);
    for (const wrong of ["", "127.0.0.1:54329/other_test", "127.0.0.1:5432/music_madras_test", "localhost:54329/music_madras_test", "yes"]) {
      const result = resolve({ BACKFILL_DATABASE_URL: LOCAL, BACKFILL_TARGET_CONFIRM: wrong });
      expect(result.ok, wrong).toBe(false);
      expect((result as { reason: string }).reason).toContain(CONFIRM);
    }
  });

  it("refuses the same database as a configured real one (identical URL, or same host:port/database), whatever else is right", () => {
    expect(resolve({ BACKFILL_DATABASE_URL: LOCAL, BACKFILL_TARGET_CONFIRM: CONFIRM }, [LOCAL]).ok).toBe(false);
    expect(resolve({ BACKFILL_DATABASE_URL: LOCAL, BACKFILL_TARGET_CONFIRM: CONFIRM }, ["postgresql://other:pw@127.0.0.1:54329/music_madras_test"]).ok).toBe(false);
    expect(resolve({ BACKFILL_DATABASE_URL: LOCAL, BACKFILL_TARGET_CONFIRM: CONFIRM }, ["postgresql://other@127.0.0.1:54329/different_db"]).ok).toBe(true); // a different local database is not the same one
    expect(resolve({ BACKFILL_DATABASE_URL: LOCAL, BACKFILL_TARGET_CONFIRM: CONFIRM }, ["not a url"]).ok).toBe(true); // an unparsable real URL names nothing
  });

  it("never puts a credential or a connection string into a refusal message", () => {
    const attempts = [
      resolve({ BACKFILL_DATABASE_URL: REAL_REMOTE, BACKFILL_TARGET_CONFIRM: "x" }),
      resolve({ BACKFILL_DATABASE_URL: LOCAL }),
      resolve({ BACKFILL_DATABASE_URL: LOCAL, BACKFILL_TARGET_CONFIRM: CONFIRM }, [LOCAL]),
      resolve({ BACKFILL_DATABASE_URL: "postgresql://u:s3cretpw@127.0.0.1:54329/music_madras", BACKFILL_TARGET_CONFIRM: "x" }),
      resolve({ BACKFILL_DATABASE_URL: `${LOCAL}?host=remote.example.com`, BACKFILL_TARGET_CONFIRM: CONFIRM }),
      resolve({ BACKFILL_DATABASE_URL: "postgresql://u:s3cretpw@127.0.0.1/music_madras_test", BACKFILL_TARGET_CONFIRM: CONFIRM }),
    ];
    for (const attempt of attempts) {
      expect(attempt.ok).toBe(false);
      expect((attempt as { reason: string }).reason).not.toMatch(/s3cretpw|realpw|remote\.example|postgres(ql)?:\/\/(?!user@host:port\/database)/i); // only the literal format template may appear
    }
  });
});

describe("the validated destination is the actual destination (query parameters and PG* variables cannot redirect the driver)", () => {
  afterEach(() => vi.unstubAllEnvs());
  const refused = (url: string, confirm = CONFIRM) => resolve({ BACKFILL_DATABASE_URL: url, BACKFILL_TARGET_CONFIRM: confirm });

  it("characterisation: the PostgreSQL driver, given a raw string, IS redirected by ?host= / ?port= and by PGPORT — which is why the raw string is never given to it", () => {
    // pg's Client only parses its configuration here; nothing connects.
    const viaHost = new Client({ connectionString: `${LOCAL}?host=remote.example.com` });
    expect(viaHost.host).toBe("remote.example.com");
    expect(new Client({ connectionString: `${LOCAL}?port=6543` }).port).toBe(6543);
    vi.stubEnv("PGPORT", "6543");
    expect(new Client({ connectionString: "postgresql://postgres@127.0.0.1/music_madras_test" }).port).toBe(6543);
  });

  it("?host= cannot redirect to another host: the URL is refused, even with a matching acknowledgement and a loopback authority", () => {
    for (const suffix of ["?host=ep-real.eu.example.com", "?host=10.0.0.5", "?hostaddr=10.0.0.5", "?HOST=remote.example.com", "?options=-c%20search_path%3Dx"]) {
      const result = refused(`${LOCAL}${suffix}`);
      expect(result.ok, suffix).toBe(false);
      expect(result).not.toHaveProperty("clientConfig");
      expect((result as { reason: string }).reason, suffix).toMatch(/query string or fragment is refused/);
    }
  });

  it("?port= cannot override the port", () => {
    for (const suffix of ["?port=5432", "?port=1", "?PORT=5432", "?host=127.0.0.1&port=5432"]) {
      expect(refused(`${LOCAL}${suffix}`).ok, suffix).toBe(false);
    }
  });

  it("any other query string, an empty one or a fragment is refused (unsupported URL features are not interpreted)", () => {
    for (const suffix of ["?sslmode=require", "?application_name=x", "?", "?&", "#fragment", "#", "?a=b#c"]) {
      expect(refused(`${LOCAL}${suffix}`).ok, suffix).toBe(false);
    }
  });

  it("a URL without an explicit port is refused — it cannot inherit PGPORT", () => {
    for (const pgPort of [undefined, "5432", "54329", "6543"]) {
      vi.unstubAllEnvs();
      if (pgPort) vi.stubEnv("PGPORT", pgPort);
      for (const confirm of [CONFIRM, "127.0.0.1:5432/music_madras_test", `127.0.0.1:${pgPort}/music_madras_test`]) {
        const result = resolveBackfillTarget({ env: { BACKFILL_DATABASE_URL: "postgresql://postgres@127.0.0.1/music_madras_test", BACKFILL_TARGET_CONFIRM: confirm, PGPORT: pgPort }, realUrls: [] });
        expect(result.ok, `PGPORT=${pgPort} confirm=${confirm}`).toBe(false);
        expect((result as { reason: string }).reason).toMatch(/port explicitly/);
      }
    }
    expect(refused("postgresql://postgres@127.0.0.1:/music_madras_test").ok).toBe(false); // an empty port is a missing port
  });

  it("ambiguous or unsupported URL forms are refused", () => {
    const cases: Record<string, string> = {
      "no user": "postgresql://127.0.0.1:54329/music_madras_test",
      "empty user": "postgresql://:pw@127.0.0.1:54329/music_madras_test",
      "several hosts": "postgresql://u@127.0.0.1:54329,10.0.0.5:5432/music_madras_test",
      "several hosts (second named first)": "postgresql://u@10.0.0.5:5432,127.0.0.1:54329/music_madras_test",
      "host hidden in the user info": "postgresql://127.0.0.1:54329@remote.example.com:5432/music_madras_test",
      "a second @": "postgresql://u@127.0.0.1:54329@remote.example.com:5432/music_madras_test",
      "backslash trick": "postgresql://u@127.0.0.1:54329\\@remote.example.com:5432/music_madras_test",
      "multi-segment path": "postgresql://u@127.0.0.1:54329/music_madras_test/other",
      "encoded slash in the path": "postgresql://u@127.0.0.1:54329/music_madras_test%2Fother",
      "encoded query marker in the name": "postgresql://u@127.0.0.1:54329/music_madras_test%3Fhost%3Dremote.example.com",
      "encoded space in the name": "postgresql://u@127.0.0.1:54329/music_madras%20test",
      "no database": "postgresql://u@127.0.0.1:54329",
      "empty database": "postgresql://u@127.0.0.1:54329/",
      "port zero": "postgresql://u@127.0.0.1:0/music_madras_test",
      "port too large": "postgresql://u@127.0.0.1:65536/music_madras_test",
      "no scheme": "u@127.0.0.1:54329/music_madras_test",
      "unix socket form": "postgresql://u@%2Fvar%2Frun%2Fpostgresql:54329/music_madras_test",
      "wrong scheme": "mysql://u@127.0.0.1:54329/music_madras_test",
    };
    for (const [label, url] of Object.entries(cases)) {
      expect(refused(url, "127.0.0.1:54329/music_madras_test").ok, label).toBe(false);
    }
  });

  it("a database name with a path separator, a query marker, a space or other odd characters is refused even when the operator acknowledges that exact name", () => {
    for (const encoded of ["music_madras_test/other", "music_madras_test%2Fother", "music_madras_test%3Fhost%3Dremote.example.com", "music_madras%20test", "music_madras_test%23x", "music_madras_test%00", "music_madras_test%27"]) {
      const decoded = decodeURIComponent(encoded);
      const result = refused(`postgresql://u@127.0.0.1:54329/${encoded}`, `127.0.0.1:54329/${decoded.toLowerCase()}`);
      expect(result.ok, encoded).toBe(false);
      expect((result as { reason: string }).reason, encoded).toMatch(/single path segment|characters other than/);
    }
  });

  it("the client configuration carries exactly the validated destination, and describes as the confirmed target", () => {
    const result = refused(LOCAL);
    if (!result.ok) throw new Error(result.reason);
    expect(describeClientDestination(result.clientConfig)).toBe(CONFIRM);
    expect(describeClientDestination(result.clientConfig)).toBe(describeTarget(result));
    const v6 = refused("postgresql://u@[::1]:54329/music_madras_test", "[::1]:54329/music_madras_test");
    if (!v6.ok) throw new Error(v6.reason);
    expect(describeClientDestination(v6.clientConfig)).toBe("[::1]:54329/music_madras_test");
  });

  it("the real driver, built from the client configuration, targets that destination — whatever PG* variables say", () => {
    const result = refused(LOCAL);
    if (!result.ok) throw new Error(result.reason);
    for (const [name, value] of Object.entries({ PGHOST: "remote.example.com", PGPORT: "6543", PGDATABASE: "neondb", PGUSER: "someone_else", PGHOSTADDR: "10.0.0.5" })) vi.stubEnv(name, value);
    const client = new Client(result.clientConfig);
    expect({ host: client.host, port: client.port, database: client.database, user: client.user }).toEqual({
      host: "127.0.0.1",
      port: 54329,
      database: "music_madras_test",
      user: "postgres",
    });
  });

  it("the script gives the driver the validated configuration only (never a connection string) and checks it equals the confirmed target", () => {
    const script = readFileSync(path.join(process.cwd(), "scripts", "backfillRevisionRelationships.ts"), "utf8");
    expect(script).toContain("new Client(target.clientConfig)");
    expect(script).not.toMatch(/connectionString/);
    expect(script).toMatch(/describeClientDestination\(target\.clientConfig\)/);
  });
});

describe("readConfiguredRealDatabaseUrls (comparison with the real database fails closed)", () => {
  const ROOT = path.join("repo", "root");
  const at = (name: string) => path.join(ROOT, name);
  const join = path.join;
  const parseLines = (text: string): Record<string, string> => {
    if (text.includes("MALFORMED")) throw new Error("parse failure containing SECRET-VALUE");
    return Object.fromEntries(text.split("\n").filter(Boolean).map((line) => line.split("=") as [string, string]));
  };
  function fakeFs(files: Record<string, string>, options: { listing?: string[]; listError?: boolean; unreadable?: string[] } = {}): EnvFileSystem & { reads: string[]; listed: string[] } {
    const reads: string[] = [];
    const listed: string[] = [];
    return {
      reads,
      listed,
      readdir(directory: string) {
        listed.push(directory);
        if (options.listError || directory !== ROOT) throw Object.assign(new Error("EPERM secret-path"), { code: "EPERM" });
        return options.listing ?? ["package.json", ...Object.keys(files)];
      },
      readFile(file: string) {
        reads.push(file);
        if (options.unreadable?.some((name) => at(name) === file)) throw Object.assign(new Error("EACCES secret-path"), { code: "EACCES" });
        const content = files[path.basename(file)];
        if (content === undefined) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
        return content;
      },
    };
  }

  it("collects DATABASE_URL / DIRECT_URL from every .env* file (not .env.example) and from the shell, resolved under the given root", () => {
    const fs = fakeFs({ ".env": "DATABASE_URL=postgres://a\nOTHER=x", ".env.local": "DIRECT_URL=postgres://b", ".env.test": "DATABASE_URL=postgres://c", ".env.example": "DATABASE_URL=postgres://example" });
    const result = readConfiguredRealDatabaseUrls(ROOT, { DATABASE_URL: "postgres://shell", DIRECT_URL: undefined }, fs, parseLines, join);
    expect(result).toEqual({ ok: true, urls: ["postgres://a", "postgres://b", "postgres://c", "postgres://shell"] });
    expect(fs.listed).toEqual([ROOT]);
    expect(fs.reads.sort()).toEqual([at(".env"), at(".env.local"), at(".env.test")]); // only files under the root; never the example file
  });

  it("fails closed when the root cannot be listed or is not recognised as the repository root", () => {
    expect(readConfiguredRealDatabaseUrls(ROOT, {}, fakeFs({}, { listError: true }), parseLines, join)).toMatchObject({ ok: false, reason: expect.stringMatching(/cannot list the repository root/) });
    expect(readConfiguredRealDatabaseUrls(path.join("somewhere", "else"), {}, fakeFs({ ".env": "DATABASE_URL=postgres://a" }), parseLines, join).ok).toBe(false); // e.g. a wrong working directory
    expect(readConfiguredRealDatabaseUrls(ROOT, {}, fakeFs({ ".env": "DATABASE_URL=postgres://a" }, { listing: [".env"] }), parseLines, join)).toMatchObject({ ok: false, reason: expect.stringMatching(/package\.json/) });
  });

  it("fails closed when any .env* file cannot be read, is not a file, or cannot be parsed — it does not skip it", () => {
    const readError = readConfiguredRealDatabaseUrls(ROOT, {}, fakeFs({ ".env": "DATABASE_URL=postgres://a", ".env.local": "x" }, { unreadable: [".env.local"] }), parseLines, join);
    expect(readError).toMatchObject({ ok: false, reason: expect.stringMatching(/\.env\.local.*EACCES/) });
    const missing = readConfiguredRealDatabaseUrls(ROOT, {}, fakeFs({ ".env": "DATABASE_URL=postgres://a" }, { listing: ["package.json", ".env", ".env.vanished"] }), parseLines, join);
    expect(missing).toMatchObject({ ok: false, reason: expect.stringMatching(/\.env\.vanished/) });
    const malformed = readConfiguredRealDatabaseUrls(ROOT, {}, fakeFs({ ".env": "MALFORMED" }), parseLines, join);
    expect(malformed).toMatchObject({ ok: false, reason: expect.stringMatching(/cannot safely inspect \.env/) });
  });

  it("never puts a value, a path from an error or a parser message into a refusal", () => {
    const attempts = [
      readConfiguredRealDatabaseUrls(ROOT, { DATABASE_URL: "postgres://shell-secret" }, fakeFs({ ".env": "MALFORMED" }), parseLines, join),
      readConfiguredRealDatabaseUrls(ROOT, { DATABASE_URL: "postgres://shell-secret" }, fakeFs({ ".env": "DATABASE_URL=postgres://file-secret" }, { unreadable: [".env"] }), parseLines, join),
      readConfiguredRealDatabaseUrls(ROOT, {}, fakeFs({}, { listError: true }), parseLines, join),
    ];
    for (const attempt of attempts) {
      expect(attempt.ok).toBe(false);
      expect((attempt as { reason: string }).reason).not.toMatch(/secret|SECRET|postgres:\/\//);
    }
  });

  it("with the real file system, finds the repository's own env files from the root regardless of the working directory", async () => {
    const { readdirSync: realReaddir, readFileSync: realRead } = await import("fs");
    const { parse } = await import("dotenv");
    const root = path.resolve(__dirname, "..", "..");
    const result = readConfiguredRealDatabaseUrls(root, {}, { readdir: (d) => realReaddir(d), readFile: (f) => realRead(f, "utf8") }, parse, path.join);
    expect(result.ok).toBe(true); // package.json is found and every .env* file here could be inspected
  });
});

describe("verifyBackfillTargetDatabase (run-time proof)", () => {
  function fake(options: { comment: string | null; hasMigrationsTable: boolean; migrationApplied: boolean }): Queryable {
    return {
      async query(text: string) {
        if (text.includes("shobj_description")) return { rows: [{ comment: options.comment }] as never, rowCount: 1 };
        if (text.includes("to_regclass")) return { rows: [{ exists: options.hasMigrationsTable }] as never, rowCount: 1 };
        if (text.includes("_prisma_migrations")) return { rows: (options.migrationApplied ? [{ migration_name: REQUIRED_MIGRATION }] : []) as never, rowCount: 0 };
        throw new Error(`unexpected query: ${text}`);
      },
    };
  }

  it("passes only for a database carrying the integration-test marker with the 11B migration applied", async () => {
    expect(await verifyBackfillTargetDatabase(fake({ comment: BACKFILL_TARGET_MARKER, hasMigrationsTable: true, migrationApplied: true }))).toEqual({ ok: true, problems: [] });
  });

  it("refuses an unmarked database (a name that looks like a test is not proof)", async () => {
    for (const comment of [null, "", "some other comment", "production"]) {
      const result = await verifyBackfillTargetDatabase(fake({ comment, hasMigrationsTable: true, migrationApplied: true }));
      expect(result.ok, String(comment)).toBe(false);
      expect(result.problems.join(" ")).toMatch(/not marked/);
    }
  });

  it("refuses a database without the schema or without the 11B migration", async () => {
    expect((await verifyBackfillTargetDatabase(fake({ comment: BACKFILL_TARGET_MARKER, hasMigrationsTable: false, migrationApplied: false }))).problems.join(" ")).toMatch(/schema has not been applied/);
    expect((await verifyBackfillTargetDatabase(fake({ comment: BACKFILL_TARGET_MARKER, hasMigrationsTable: true, migrationApplied: false }))).problems.join(" ")).toContain(REQUIRED_MIGRATION);
  });
});

describe("constants stay in step with the repository", () => {
  it("the marker equals the integration suite's marker", () => {
    expect(BACKFILL_TARGET_MARKER).toBe(TEST_DATABASE_MARKER);
  });
  it("the required migration is one of the repository's migrations", () => {
    const migrations = readdirSync(path.join(process.cwd(), "prisma", "migrations"));
    expect(migrations).toContain(REQUIRED_MIGRATION);
  });
});
