// R-34: the staging guard and client binding shared by the pipeline's operator scripts (pipeline:seed-aliases, pipeline:reconcile-staging).
// The same rules as the staging content loader (modules/seed/stagingTarget.ts, scripts/seedStagingContent.ts): the target comes ONLY from
// STAGING_DATABASE_URL, must be a direct Neon host with "staging" in the database name, --confirm-host must match exactly, and it must not be
// any configured real database. Only host, port and database are printed.
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { parse } from "dotenv";
import { buildStagingConnectionString, describeStagingTarget, resolveStagingTarget } from "../../modules/seed/stagingTarget";

const ROOT = path.resolve(__dirname, "..", "..");

export function realDatabaseUrls(): string[] {
  const urls: string[] = [];
  for (const key of ["DATABASE_URL", "DIRECT_URL"]) if (process.env[key]) urls.push(process.env[key] as string);
  for (const name of readdirSync(ROOT).filter((n) => /^\.env/.test(n) && !/\.example$/.test(n))) {
    try {
      const parsed = parse(readFileSync(path.join(ROOT, name)));
      for (const key of ["DATABASE_URL", "DIRECT_URL"]) if (parsed[key]) urls.push(parsed[key]);
    } catch {
      // an unreadable env file cannot be compared; the other signals still apply
    }
  }
  return urls;
}

/** Checks the target and binds the application's database client to it (call before importing anything that imports the client). */
export function bindStagingTarget(confirmHost: string | undefined): { ok: true; described: string } | { ok: false; reason: string } {
  const target = resolveStagingTarget({ env: { STAGING_DATABASE_URL: process.env.STAGING_DATABASE_URL, NODE_ENV: process.env.NODE_ENV }, confirmHost, realUrls: realDatabaseUrls() });
  if (!target.ok) return target;
  const connection = buildStagingConnectionString(target.clientConfig);
  const emptyEnv = path.join(mkdtempSync(path.join(os.tmpdir(), "mm-pipeline-")), ".env");
  writeFileSync(emptyEnv, "");
  process.env.DOTENV_CONFIG_PATH = emptyEnv;
  process.env.DOTENV_CONFIG_QUIET = "true";
  process.env.DATABASE_URL = connection;
  process.env.DIRECT_URL = connection;
  delete process.env.TEST_DATABASE_URL;
  delete process.env.TEST_DIRECT_URL;
  return { ok: true, described: describeStagingTarget(target) };
}

export const flag = (args: readonly string[], name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
