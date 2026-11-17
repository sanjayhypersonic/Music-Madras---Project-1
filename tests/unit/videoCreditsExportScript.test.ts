import { spawnSync } from "child_process";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { afterAll, describe, expect, it } from "vitest";
import { isPathInside } from "../../modules/jobs/videoCreditsRunner";

// Credits extraction, route 2: runs the REAL export script through tsx (as `npm run ai:video-credits-export` does) with DUMMY settings files, to
// prove how --settings-file and Node's own --env-file behave. Every run is refused before the script imports the database client:
//   - every dummy DATABASE_URL points at a host under ".invalid", a name that can never resolve, so not even a connection attempt can reach a server;
//   - the dummies live in a fresh folder under the system temp directory, never in the repository and never in a secrets folder.

const root = path.resolve(__dirname, "../..");
const tsxCli = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");
const script = path.join(root, "scripts", "exportVideoCreditsSource.ts");

const dir = mkdtempSync(path.join(os.tmpdir(), "mm-export-settings-test-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const PASSWORD = "dummy-password-not-real";
const PROBE = "probe-value-that-must-not-leak";
function dummy(name: string, database: string): string {
  const file = path.join(dir, name);
  writeFileSync(file, `DATABASE_URL=postgresql://dummy_user:${PASSWORD}@dummy-host.invalid:5432/${database}\nCREDITS_EXPORT_PROBE=${PROBE}\n`);
  return file;
}
const prodSettings = dummy("prod.env", "music_madras_prod");
const stagingSettings = dummy("staging.env", "music_madras_staging");

/** Runs node + tsx with a clean environment: no database variables from the shell, no NODE_OPTIONS, no probe. */
function run(args: string[]): { status: number | null; output: string } {
  const env: NodeJS.ProcessEnv = { ...process.env, NODE_NO_WARNINGS: "1" };
  for (const key of ["DATABASE_URL", "DIRECT_URL", "TEST_DATABASE_URL", "TEST_DIRECT_URL", "STAGING_DATABASE_URL", "DOTENV_CONFIG_PATH", "NODE_OPTIONS", "CREDITS_EXPORT_PROBE"]) delete env[key];
  const r = spawnSync(process.execPath, [tsxCli, ...args], { cwd: root, env, encoding: "utf8", timeout: 60_000 });
  return { status: r.status, output: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

const expectNoSecretsIn = (output: string) => {
  expect(output).not.toContain(PASSWORD);
  expect(output).not.toContain(PROBE);
  expect(output).not.toContain("dummy_user");
};

describe("the export script, run through tsx with dummy settings files (no database)", () => {
  it("keeps its dummies out of the repository and out of any secrets folder", () => {
    for (const file of [prodSettings, stagingSettings]) {
      expect(isPathInside(root, file)).toBe(false);
      expect(file.toLowerCase()).not.toContain("secrets");
    }
  });

  it("reads --settings-file itself, takes only DATABASE_URL, and refuses a production database before touching anything", () => {
    const r = run([script, "--settings-file", prodSettings]);
    expect(r.status).toBe(4);
    expect(r.output).toContain('REFUSED: The database dummy-host.invalid/music_madras_prod looks like a production database ("prod" in its name).');
    expect(r.output).not.toContain("already in the environment");
    expectNoSecretsIn(r.output);
  }, 60_000);

  it("refuses when Node's own --env-file has loaded the same file into the environment, naming the settings but not their values", () => {
    const r = run([`--env-file=${stagingSettings}`, script, "--settings-file", stagingSettings]);
    expect(r.status).toBe(4);
    expect(r.output).toContain("REFUSED: 2 setting(s) from the settings file are already in the environment (CREDITS_EXPORT_PROBE, DATABASE_URL)");
    expectNoSecretsIn(r.output);
  }, 60_000);

  it("--env-file after the script name reaches the script, which refuses it and names --settings-file; nothing from the file leaks", () => {
    const r = run([script, "--env-file", prodSettings]);
    expect(r.status).toBe(4);
    expect(r.output).toContain("REFUSED: --env-file is Node's own option name");
    expect(r.output).toContain("Use --settings-file <file>");
    expectNoSecretsIn(r.output);
  }, 60_000);

  it("--env-file naming a MISSING file is stopped by Node itself before the script runs (the 'not found' message seen on the first attempt)", () => {
    const r = run([script, "--env-file", path.join(dir, "missing.env")]);
    expect(r.status).toBe(9);
    expect(r.output).toMatch(/missing\.env: not found/);
    expect(r.output).not.toContain("REFUSED");
  }, 60_000);

  it("refuses a settings file that does not exist", () => {
    const r = run([script, "--settings-file", path.join(dir, "missing.env")]);
    expect(r.status).toBe(4);
    expect(r.output).toContain("REFUSED: the --settings-file file does not exist.");
  }, 60_000);
});
