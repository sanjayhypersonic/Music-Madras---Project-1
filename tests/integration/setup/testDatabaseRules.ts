// Phase 6J-2 — the rules that decide which database the integration suite may
// use. Pure functions only (no fs, no network), so the safety logic itself is
// unit-tested with synthetic fixtures and never needs real credentials.
//
// The invariant: the integration suite writes ONLY to a database that was
// explicitly provided for testing (TEST_DATABASE_URL), and can never be pointed
// at the real Music Madras database. There is deliberately NO fallback to
// DATABASE_URL, and there is no override flag.
//
// Independent signals, any one of which stops the suite:
//   1. TEST_DATABASE_URL must be set.                        (no implicit fallback)
//   2. The environment must not be a production one.
//   3. The database NAME must be a test name (a "test" word). (positive proof)
//   4. It must not be the same server+port as any configured real database, and,
//      for a local server, not the same database either.     (negative proof)
//   5. At run time (verifyTestDatabase.ts) the database must carry the explicit
//      marker that only the setup command writes.            (explicit marker)
// Only host names and database names are ever reported — never credentials.

/** The database comment the setup command writes and the run-time check requires. */
export const TEST_DATABASE_MARKER = "music-madras-integration-test";

export interface IntegrationDatabaseInput {
  /** The process environment (and/or .env.test) — only the keys below are read. */
  env: Readonly<Record<string, string | undefined>>;
  /** Connection strings of the REAL database(s): DATABASE_URL / DIRECT_URL from the shell and from .env* files. */
  productionUrls: readonly string[];
}

export interface IntegrationDatabaseTarget {
  databaseUrl: string;
  /** A direct (non-pooled) URL for the SAME database; defaults to databaseUrl. */
  directUrl: string;
  host: string;
  port: string;
  database: string;
  local: boolean;
}

export type IntegrationDatabaseResolution = ({ ok: true } & IntegrationDatabaseTarget) | { ok: false; reason: string };

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
/** A "test" word: music_madras_test, mm-test, test_db — but not "latest" or "contest". */
const TEST_NAME = /(^|[^a-z0-9])test([^a-z0-9]|$)/i;

interface ParsedTarget {
  host: string;
  port: string;
  database: string;
}

export function parseDatabaseUrl(connectionString: string): ParsedTarget | null {
  try {
    const url = new URL(connectionString);
    if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") return null;
    const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
    if (!url.hostname || !database) return null;
    return {
      // A pooled and a direct endpoint of ONE Neon database differ only by "-pooler".
      host: url.hostname.toLowerCase().replace(/-pooler(?=\.|$)/, ""),
      port: url.port || "5432",
      database: database.toLowerCase(),
    };
  } catch {
    return null;
  }
}

export function isLocalHost(host: string): boolean {
  return LOCAL_HOSTS.has(host);
}

export function resolveIntegrationDatabase(input: IntegrationDatabaseInput): IntegrationDatabaseResolution {
  const { env } = input;
  const fail = (reason: string): IntegrationDatabaseResolution => ({ ok: false, reason });

  const databaseUrl = env.TEST_DATABASE_URL?.trim();
  if (!databaseUrl) {
    return fail(
      "Integration tests require TEST_DATABASE_URL (a dedicated test database; DATABASE_URL is never used as a fallback). " +
        "Set it in the shell or in .env.test — see tests/integration/README.md (npm run test:integration:db:start prints a local one)."
    );
  }

  if (env.NODE_ENV === "production" || env.VERCEL_ENV === "production") {
    return fail("Refusing to run the integration suite in a production environment (NODE_ENV/VERCEL_ENV is production).");
  }

  const target = parseDatabaseUrl(databaseUrl);
  if (!target) return fail("TEST_DATABASE_URL is not a valid postgresql:// URL with a host and a database name.");

  if (!TEST_NAME.test(target.database)) {
    return fail(
      `The database name "${target.database}" does not look like a test database. ` +
        'A test database must have a "test" word in its name (for example music_madras_test); refusing to run.'
    );
  }

  const local = isLocalHost(target.host);
  for (const productionUrl of input.productionUrls) {
    const production = parseDatabaseUrl(productionUrl);
    if (!production) continue;
    if (production.host !== target.host || production.port !== target.port) continue;
    if (!local) {
      return fail(
        `TEST_DATABASE_URL points at the same server (${target.host}) as a configured real database. ` +
          "Use a separate server or a separate Neon branch for tests, never a second database on the production endpoint."
      );
    }
    if (production.database === target.database) {
      return fail(`TEST_DATABASE_URL is the same local database ("${target.database}") as a configured real database.`);
    }
  }

  let directUrl = databaseUrl;
  const directRaw = env.TEST_DIRECT_URL?.trim();
  if (directRaw) {
    const direct = parseDatabaseUrl(directRaw);
    if (!direct || direct.host !== target.host || direct.port !== target.port || direct.database !== target.database) {
      return fail("TEST_DIRECT_URL must be a direct URL for the SAME database as TEST_DATABASE_URL (same host, port and name).");
    }
    directUrl = directRaw;
  }

  return { ok: true, databaseUrl, directUrl, host: target.host, port: target.port, database: target.database, local };
}

/**
 * The environment every integration worker runs with. It REPLACES whatever the
 * shell or a .env file supplied for the database and for every external service,
 * so a test can neither reach the real database nor spend a real API key.
 */
export function buildIntegrationWorkerEnv(target: IntegrationDatabaseTarget, emptyDotenvPath: string): Record<string, string> {
  return {
    DATABASE_URL: target.databaseUrl,
    DIRECT_URL: target.directUrl,
    // Read by setup/guardDatabase.ts: proves the config (not a stray runner) prepared this process.
    MM_INTEGRATION_DATABASE: `${target.host}:${target.port}/${target.database}`,
    // modules/db/client.ts and prisma.config.ts import "dotenv/config"; pointing it at a file that
    // does not exist means the repository's real .env is never read inside a test.
    DOTENV_CONFIG_PATH: emptyDotenvPath,
    DOTENV_CONFIG_QUIET: "true",
    // Deterministic, non-secret values the code needs; and every external service switched off.
    AUTH_SECRET: "integration-test-secret-not-a-real-secret",
    AUTH_URL: "http://localhost:3000",
    PUBLIC_SITE_URL: "",
    EMAIL_PROVIDER: "",
    SMTP_URL: "",
    EMAIL_FROM: "",
    YOUTUBE_API_KEY: "",
    YOUTUBE_CHANNEL_ID: "",
    ANTHROPIC_API_KEY: "",
    AI_PROVIDER: "",
    AI_MODEL: "",
    GA4_MEASUREMENT_ID: "",
    GA4_API_SECRET: "",
    GOOGLE_CLIENT_ID: "",
    GOOGLE_CLIENT_SECRET: "",
    FOUNDER_EMAIL: "",
    FOUNDER_NAME: "",
  };
}

/** Safe diagnostics for the start of a run: server and database name only. */
export function describeIntegrationTarget(target: Pick<IntegrationDatabaseTarget, "host" | "port" | "database" | "local">): string[] {
  return ["Integration database:", `  ${target.host}:${target.port}${target.local ? " (local)" : ""}`, `  database: ${target.database}`];
}
