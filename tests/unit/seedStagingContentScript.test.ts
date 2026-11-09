import { spawnSync } from "child_process";
import path from "path";
import { describe, expect, it } from "vitest";

// The operator script's behaviour BEFORE it connects to anything: every case below ends at a refusal or at the dry run, and none of them can open a database
// connection (the dry run connects to nothing by design; the host below is synthetic and not reachable). The environment handed to the script is minimal and
// explicit, so nothing from the developer's shell or .env can leak in.

const root = path.resolve(__dirname, "../..");
const tsx = path.join(root, "node_modules/tsx/dist/cli.mjs");
const PASSWORD = "S3cretPassw0rd-DO-NOT-LEAK";
const URL_OK = `postgresql://app_user:${PASSWORD}@ep-quiet-wave-123456.us-east-2.aws.neon.tech:5432/music_madras_staging`;
const CONFIRM = "ep-quiet-wave-123456.us-east-2.aws.neon.tech:5432/music_madras_staging";

function run(env: Record<string, string>, ...args: string[]) {
  const result = spawnSync(process.execPath, [tsx, "scripts/seedStagingContent.ts", ...args], {
    cwd: root,
    env: { PATH: process.env.PATH ?? "", SystemRoot: process.env.SystemRoot ?? "", ...env } as unknown as NodeJS.ProcessEnv,
    encoding: "utf8",
    timeout: 90_000,
  });
  return { code: result.status, out: `${result.stdout}\n${result.stderr}` };
}

describe("scripts/seedStagingContent.ts", () => {
  it("refuses without --confirm-host (exit 4), naming the value to type, and never prints the password", () => {
    const r = run({ STAGING_DATABASE_URL: URL_OK });
    expect(r.code).toBe(4);
    expect(r.out).toMatch(/REFUSED: .*--confirm-host is required/);
    expect(r.out).toContain(`--confirm-host ${CONFIRM}`);
    expect(r.out).not.toContain(PASSWORD);
  }, 100_000);

  it("refuses an incorrect --confirm-host (exit 4)", () => {
    const r = run({ STAGING_DATABASE_URL: URL_OK }, "--confirm-host", "ep-quiet-wave-123456.us-east-2.aws.neon.tech:5432/music_madras_production", "--execute");
    expect(r.code).toBe(4);
    expect(r.out).toMatch(/REFUSED: .*does not match/);
    expect(r.out).not.toContain(PASSWORD);
  }, 100_000);

  it("never falls back to DATABASE_URL or DIRECT_URL when STAGING_DATABASE_URL is unset (exit 4)", () => {
    const r = run({ DATABASE_URL: URL_OK, DIRECT_URL: URL_OK }, "--confirm-host", CONFIRM, "--execute");
    expect(r.code).toBe(4);
    expect(r.out).toMatch(/STAGING_DATABASE_URL is not set/);
    expect(r.out).not.toContain(PASSWORD);
  }, 100_000);

  it("refuses a staging URL that is also the configured DATABASE_URL (exit 4)", () => {
    const r = run({ STAGING_DATABASE_URL: URL_OK, DATABASE_URL: URL_OK }, "--confirm-host", CONFIRM, "--execute");
    expect(r.code).toBe(4);
    expect(r.out).toMatch(/same database as a configured DATABASE_URL/);
  }, 100_000);

  it.each([
    ["localhost", "postgresql://u:p@localhost:5432/music_madras_staging", "localhost:5432/music_madras_staging"],
    ["a test database", "postgresql://u:p@ep-a.us-east-2.aws.neon.tech:5432/music_madras_test", "ep-a.us-east-2.aws.neon.tech:5432/music_madras_test"],
    ["a production environment", URL_OK, CONFIRM],
  ])("refuses %s (exit 4)", (label, url, confirm) => {
    const r = run({ STAGING_DATABASE_URL: url, ...(label === "a production environment" ? { NODE_ENV: "production" } : {}) }, "--confirm-host", confirm, "--execute");
    expect(r.code).toBe(4);
    expect(r.out).toMatch(/REFUSED/);
  }, 100_000);

  it.each([["is missing", []], ["is not a known mode", ["--mirror", "sync"]], ["has no value", ["--mirror"]]])("refuses when --mirror %s: the YouTube mirror is always an explicit choice (exit 4)", (_label, extra) => {
    const r = run({ STAGING_DATABASE_URL: URL_OK }, "--confirm-host", CONFIRM, ...extra);
    expect(r.code).toBe(4);
    expect(r.out).toMatch(/REFUSED: --mirror is required and must be `existing`.*`fixtures`/);
    expect(r.out).not.toContain(PASSWORD);
  }, 100_000);

  it("--mirror existing: the dry run states that nothing is imported and the video must come from the full sync", () => {
    const r = run({ STAGING_DATABASE_URL: URL_OK }, "--confirm-host", CONFIRM, "--mirror", "existing");
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/YouTube mirror: nothing is imported; video zEQmnmwr5UE must already be in the database from the full sync, public and OBSERVED/);
    expect(r.out).toContain("DRY RUN: nothing was connected to or written");
  }, 100_000);

  it("with the right target and no --execute: prints the target without credentials, validates the content, and connects to nothing (exit 0)", () => {
    const r = run({ STAGING_DATABASE_URL: URL_OK }, "--confirm-host", CONFIRM, "--mirror", "fixtures");
    expect(r.code).toBe(0);
    expect(r.out).toContain(`Target: ${CONFIRM} (staging, confirmed)`);
    expect(r.out).toMatch(/YouTube mirror: INSERT 5 videos and 2 playlists from the exported fixtures/);
    expect(r.out).toMatch(/Composer "Traditional", Work "Dingiri Dingalae", Programme "Dingiri Dingalae: South Asian Symphony Orchestra and The Chennai Chorale"\./);
    expect(r.out).toContain("not loaded: Venue type");
    expect(r.out).toContain("DRY RUN: nothing was connected to or written");
    expect(r.out).not.toContain(PASSWORD);
    expect(r.out).not.toContain("app_user");
  }, 100_000);

  it("refuses a content file that does not exist, even on a dry run (exit 4)", () => {
    const r = run({ STAGING_DATABASE_URL: URL_OK }, "--confirm-host", CONFIRM, "--mirror", "fixtures", "--content", "tests/fixtures/__does_not_exist__.json");
    expect(r.code).toBe(4);
    expect(r.out).toMatch(/does not exist/);
  }, 100_000);
});
