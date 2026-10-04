import os from "os";
import path from "path";

// Phase 6J-2 — pure helpers for the OPTIONAL local test database
// (scripts/testDatabase.ts). A local PostgreSQL is only one way to get a
// TEST_DATABASE_URL; any dedicated Postgres works (a CI service container, a
// separate Neon branch). Nothing here is needed to run the tests themselves.

export const LOCAL_TEST_DATABASE_NAME = "music_madras_test";
export const LOCAL_TEST_DATABASE_PORT = 54329;

export function localTestDataDirectory(env: Readonly<Record<string, string | undefined>> = process.env): string {
  // Outside the repository (which lives on a synced drive): a database directory must never be synced.
  return env.MM_TEST_DB_DIR?.trim() || path.join(os.homedir(), ".music-madras", "test-postgres");
}

export function localTestDatabasePort(env: Readonly<Record<string, string | undefined>> = process.env): number {
  const port = Number(env.MM_TEST_DB_PORT);
  return Number.isInteger(port) && port > 1023 && port < 65536 ? port : LOCAL_TEST_DATABASE_PORT;
}

/** Trust authentication on 127.0.0.1 only, so there is no password to configure or leak. */
export function localTestDatabaseUrl(port: number = LOCAL_TEST_DATABASE_PORT): string {
  return `postgresql://postgres@127.0.0.1:${port}/${LOCAL_TEST_DATABASE_NAME}`;
}

/** The embedded-postgres platform package that ships the binaries for this machine, e.g. "windows-x64". */
export function embeddedPostgresPlatform(platform: NodeJS.Platform = process.platform, arch: string = process.arch): string {
  const os = platform === "win32" ? "windows" : platform;
  return `${os}-${arch}`;
}

export function postgresBinaryName(name: "initdb" | "pg_ctl", platform: NodeJS.Platform = process.platform): string {
  return platform === "win32" ? `${name}.exe` : name;
}

export type TestDatabaseCommand = "start" | "stop" | "status" | "setup" | "reset";

export function parseTestDatabaseCommand(argv: readonly string[]): TestDatabaseCommand | null {
  const [command, ...rest] = argv;
  if (rest.length > 0) return null;
  return command === "start" || command === "stop" || command === "status" || command === "setup" || command === "reset" ? command : null;
}