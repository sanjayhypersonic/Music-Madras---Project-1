import { existsSync, readdirSync, readFileSync } from "fs";
import path from "path";
import { parse } from "dotenv";
import { resolveIntegrationDatabase, type IntegrationDatabaseResolution } from "./testDatabaseRules";

// Phase 6J-2 — the file-reading half of the integration database guard. It
// PARSES files but never loads them into process.env: the repository's real
// `.env` is read only to learn which databases are real (so a test target that
// equals one is refused), and its values are never exported anywhere.

/** Files that configure the integration suite. `.env` is deliberately not one of them. */
export const TEST_ENV_FILE = ".env.test";

/** The names of the real databases' variables. */
const REAL_DATABASE_KEYS = ["DATABASE_URL", "DIRECT_URL"] as const;

function readEnvFile(file: string): Record<string, string> {
  try {
    return parse(readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

/** Every real-database connection string the developer's checkout is configured with (.env, .env.local, ...). */
export function findConfiguredRealDatabaseUrls(root: string): string[] {
  const urls: string[] = [];
  for (const name of readdirSync(root)) {
    if (!/^\.env(\..+)?$/.test(name) || name === TEST_ENV_FILE || name === ".env.example") continue;
    const values = readEnvFile(path.join(root, name));
    for (const key of REAL_DATABASE_KEYS) if (values[key]) urls.push(values[key]);
  }
  return urls;
}

/** The migration directories the repository ships; the test database must have all of them applied. */
export function listMigrationNames(root: string): string[] {
  const dir = path.join(root, "prisma", "migrations");
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/**
 * TEST_DATABASE_URL / TEST_DIRECT_URL come from the shell, or else from `.env.test`.
 * Nothing else in any env file is consulted for the test target.
 */
export function resolveIntegrationDatabaseFromDisk(root: string, shellEnv: Readonly<Record<string, string | undefined>> = process.env): IntegrationDatabaseResolution {
  const fromFile = readEnvFile(path.join(root, TEST_ENV_FILE));
  const env = {
    TEST_DATABASE_URL: shellEnv.TEST_DATABASE_URL ?? fromFile.TEST_DATABASE_URL,
    TEST_DIRECT_URL: shellEnv.TEST_DIRECT_URL ?? fromFile.TEST_DIRECT_URL,
    NODE_ENV: shellEnv.NODE_ENV,
    VERCEL_ENV: shellEnv.VERCEL_ENV,
  };
  return resolveIntegrationDatabase({ env, productionUrls: findConfiguredRealDatabaseUrls(root) });
}
