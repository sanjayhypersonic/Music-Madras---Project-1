// Phase 6J-11C — which database the relationship backfill may touch. Pure rules (no fs, no network) plus a run-time
// check that takes an injected query function, so all of it is unit-tested with synthetic values and no credentials.
//
// The invariant: the backfill runs ONLY against a database that was explicitly provided for it through
// BACKFILL_DATABASE_URL, explicitly acknowledged through BACKFILL_TARGET_CONFIRM, and positively proven to be the
// isolated, marked, local integration-test database. There is NO fallback to DATABASE_URL / DIRECT_URL, no inference that
// a database is safe because it is "not called production", and no override flag. In THIS phase a remote database
// cannot be a target at all; a later phase that is authorized to backfill a real database must add an explicit, reviewed
// allowlist here (and nothing else will make it possible).
//
// The validated destination and the actual connection are THE SAME OBJECT. The PostgreSQL driver parses a connection
// string itself, and its parser lets query parameters (`?host=`, `?port=`) override the URL's authority and lets a
// missing port fall back to the PGPORT environment variable. So the raw string is never handed to the driver: it is
// accepted only in a strict, unambiguous form (below), and the driver is given an explicit {host, port, database, user}
// built from the validated fields (`clientConfig`). Nothing the driver would read from the string or from PG* variables can
// change where it connects, because host, port and database are always supplied explicitly.
//
// Independent signals — each one alone stops the run (every message names only a host / port / database, never a credential):
//   1. BACKFILL_DATABASE_URL is set.                               (no implicit fallback, ever)
//   2. The environment is not a production one.
//   3. The URL has the strict form postgresql://user[:password]@host:port/database — no query string, no fragment, a user, an
//      explicit port (1-65535), one single-segment database name, one host.        (no feature that could redirect the driver)
//   4. The host is exactly 127.0.0.1 or ::1.                       (loopback IP literals only: no name resolution is trusted)
//   5. The database name has a "test" word.                        (static positive hint)
//   6. BACKFILL_TARGET_CONFIRM equals host:port/database exactly.  (the operator named the target)
//   7. It is not any configured real database (DATABASE_URL / DIRECT_URL in the shell or in any .env* file).
//   8. At run time the database carries the integration-test marker and has the 6J-11B migration applied.  (proof)

/** The database comment `npm run test:integration:setup` writes. Must equal TEST_DATABASE_MARKER in tests/integration/setup/testDatabaseRules.ts (a unit test asserts it). */
export const BACKFILL_TARGET_MARKER = "music-madras-integration-test";

/** The migration that created the revision-scoped tables; the target must have it applied. */
export const REQUIRED_MIGRATION = "20261020120000_phase6j11b_recording_revision_relationships";

/** Loopback IP LITERALS only (a hostname such as "localhost" depends on name resolution, which is not trusted here). */
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "[::1]"]);
const TEST_NAME = /(^|[^a-z0-9])test([^a-z0-9]|$)/i;

export interface ParsedDatabaseTarget {
  host: string;
  port: string;
  database: string;
}

/**
 * Lenient parse, used ONLY to compare against the configured real databases (whose URLs may carry options) and to describe
 * them; it is never used to decide where to connect.
 */
export function parseBackfillDatabaseUrl(connectionString: string): ParsedDatabaseTarget | null {
  try {
    const url = new URL(connectionString);
    if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") return null;
    const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
    if (!url.hostname || !database) return null;
    return { host: url.hostname.toLowerCase().replace(/-pooler(?=\.|$)/, ""), port: url.port || "5432", database: database.toLowerCase() };
  } catch {
    return null;
  }
}

export function describeTarget(target: ParsedDatabaseTarget): string {
  return `${target.host}:${target.port}/${target.database}`;
}

export type StrictUrlResult = ({ ok: true } & ParsedDatabaseTarget & { user: string; password: string | undefined }) | { ok: false; reason: string };

/**
 * The only accepted form: postgresql://user[:password]@host:port/database. Anything that the driver could interpret
 * differently from this parser — a query string, a fragment, a missing port, a missing user, several hosts, a multi-segment
 * path — is refused rather than interpreted.
 */
export function parseStrictBackfillUrl(connectionString: string): StrictUrlResult {
  const fail = (reason: string): StrictUrlResult => ({ ok: false, reason });
  if (/[?#]/.test(connectionString)) {
    return fail(
      "BACKFILL_DATABASE_URL must be a plain postgresql://user@host:port/database URL: a query string or fragment is refused, because the " +
        "PostgreSQL driver lets URL parameters (for example host= or port=) override the host and port that were validated."
    );
  }
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    return fail("BACKFILL_DATABASE_URL is not a valid postgresql:// URL with a host and a database name.");
  }
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") return fail("BACKFILL_DATABASE_URL must use the postgresql:// scheme.");
  if (!url.hostname) return fail("BACKFILL_DATABASE_URL has no host.");
  if (!url.port) {
    return fail("BACKFILL_DATABASE_URL must give the port explicitly (for example :54329); a missing port is refused because the driver would take it from the PGPORT environment variable.");
  }
  const port = Number(url.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return fail("BACKFILL_DATABASE_URL has an invalid port.");
  let user: string;
  let password: string | undefined;
  let database: string;
  try {
    user = decodeURIComponent(url.username);
    password = url.password ? decodeURIComponent(url.password) : undefined;
    const path = url.pathname.replace(/^\//, "");
    if (path.includes("/") || /%2f/i.test(path)) return fail("BACKFILL_DATABASE_URL must name exactly one database (a single path segment).");
    database = decodeURIComponent(path);
  } catch {
    return fail("BACKFILL_DATABASE_URL contains an invalid percent-encoding.");
  }
  if (!user) return fail("BACKFILL_DATABASE_URL must name the database user explicitly (postgresql://user@host:port/database).");
  if (!database) return fail("BACKFILL_DATABASE_URL has no database name.");
  if (!/^[A-Za-z0-9_.-]+$/.test(database)) return fail("BACKFILL_DATABASE_URL has a database name with characters other than letters, digits, underscore, dot and hyphen; refusing an ambiguous name.");
  return { ok: true, host: url.hostname.toLowerCase(), port: String(port), database: database.toLowerCase(), user, password };
}

/** What the driver is given: every destination field explicit, so neither the URL nor a PG* environment variable can alter it. */
export interface BackfillClientConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string | undefined;
}

export interface BackfillTargetInput {
  /** Only these keys are read. Never DATABASE_URL / DIRECT_URL (those are compared against, via realUrls). */
  env: Readonly<Record<string, string | undefined>>;
  /** Connection strings of the REAL database(s): DATABASE_URL / DIRECT_URL from the shell and from .env* files. */
  realUrls: readonly string[];
}

export type BackfillTargetResolution = ({ ok: true; clientConfig: BackfillClientConfig } & ParsedDatabaseTarget) | { ok: false; reason: string };

export function resolveBackfillTarget(input: BackfillTargetInput): BackfillTargetResolution {
  const { env } = input;
  const fail = (reason: string): BackfillTargetResolution => ({ ok: false, reason });

  const connectionString = env.BACKFILL_DATABASE_URL?.trim();
  if (!connectionString) {
    return fail(
      "BACKFILL_DATABASE_URL is not set. The backfill never falls back to DATABASE_URL or DIRECT_URL: it needs its own explicitly " +
        "configured, intended non-production database (see docs/recording-publication-safety.md, 'Revision relationship backfill')."
    );
  }
  if (env.NODE_ENV === "production" || env.VERCEL_ENV === "production") {
    return fail("Refusing to run in a production environment (NODE_ENV/VERCEL_ENV is production).");
  }

  const strict = parseStrictBackfillUrl(connectionString);
  if (!strict.ok) return fail(strict.reason);
  const target: ParsedDatabaseTarget = { host: strict.host, port: strict.port, database: strict.database };

  if (!LOOPBACK_HOSTS.has(target.host)) {
    return fail(
      `The target host "${target.host}" is not a loopback IP address (127.0.0.1 or ::1). In this phase the backfill can only run against the ` +
        "local, isolated integration-test database; remote databases (production, staging or otherwise) and host names are refused."
    );
  }
  if (!TEST_NAME.test(target.database)) {
    return fail(`The database name "${target.database}" does not look like a test database (it needs a "test" word, for example music_madras_test); refusing.`);
  }

  const expectedConfirmation = describeTarget(target);
  if ((env.BACKFILL_TARGET_CONFIRM ?? "").trim().toLowerCase() !== expectedConfirmation) {
    return fail(
      `BACKFILL_TARGET_CONFIRM must be set to exactly "${expectedConfirmation}" to acknowledge this target. ` +
        (env.BACKFILL_TARGET_CONFIRM ? "It is set to a different value." : "It is not set.")
    );
  }

  for (const real of input.realUrls) {
    if (real.trim() === connectionString) return fail("BACKFILL_DATABASE_URL is identical to a configured real database connection string.");
    const parsed = parseBackfillDatabaseUrl(real);
    if (parsed && parsed.host === target.host && parsed.port === target.port && parsed.database === target.database) {
      return fail(`The target (${expectedConfirmation}) is the same database as a configured real database.`);
    }
  }

  return {
    ok: true,
    ...target,
    clientConfig: {
      // the validated fields, verbatim; IPv6 is passed to the driver without URL brackets
      host: target.host.replace(/^\[(.*)\]$/, "$1"),
      port: Number(target.port),
      // the original-case name (the driver connects to exactly what the operator wrote; the comparison above is case-insensitive)
      database: strict.database,
      user: strict.user,
      password: strict.password,
    },
  };
}

/** The environment variable names (and the noun used in messages) of one operator tool that shares these target rules. */
export interface TargetVariableNames {
  url: string;
  confirm: string;
  noun: string;
}

/**
 * The same target rules for another operator tool (Phase 6J-12B re-projection), under that tool's OWN variable names. Only those two
 * variables (plus NODE_ENV / VERCEL_ENV) are read: a tool never borrows another tool's variables, DATABASE_URL, or DIRECT_URL.
 * Nothing about the rules differs — it is the same function, with the names substituted in the refusal messages.
 */
export function resolveLoopbackTestTarget(names: TargetVariableNames, input: BackfillTargetInput): BackfillTargetResolution {
  const result = resolveBackfillTarget({
    env: { BACKFILL_DATABASE_URL: input.env[names.url], BACKFILL_TARGET_CONFIRM: input.env[names.confirm], NODE_ENV: input.env.NODE_ENV, VERCEL_ENV: input.env.VERCEL_ENV },
    realUrls: input.realUrls,
  });
  if (result.ok) return result;
  return {
    ok: false,
    reason: result.reason
      .replaceAll("BACKFILL_DATABASE_URL", names.url)
      .replaceAll("BACKFILL_TARGET_CONFIRM", names.confirm)
      .replaceAll("The backfill", `The ${names.noun}`)
      .replaceAll("the backfill", `the ${names.noun}`),
  };
}
/** The destination exactly as the driver will use it, in the same `host:port/database` form as the acknowledgement. */
export function describeClientDestination(config: BackfillClientConfig): string {
  const host = config.host.includes(":") ? `[${config.host}]` : config.host;
  return `${host}:${config.port}/${config.database}`;
}

export interface Queryable {
  query<Row = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: Row[]; rowCount: number | null }>;
}

export interface TargetVerification {
  ok: boolean;
  problems: string[];
}

/** The run-time proof: what the database IS. It must be the marked integration-test database with the 11B tables in place. */
export async function verifyBackfillTargetDatabase(db: Queryable): Promise<TargetVerification> {
  const problems: string[] = [];

  const marker = await db.query<{ comment: string | null }>(
    "select shobj_description(d.oid, 'pg_database') as comment from pg_database d where d.datname = current_database()"
  );
  if (marker.rows[0]?.comment !== BACKFILL_TARGET_MARKER) {
    problems.push("The database is not marked as the integration-test database (npm run test:integration:setup marks an empty one); refusing to treat it as a safe target.");
  }

  const migrations = await db.query<{ exists: boolean }>("select to_regclass('public._prisma_migrations') is not null as exists");
  if (!migrations.rows[0]?.exists) {
    problems.push("The schema has not been applied (no _prisma_migrations table).");
  } else {
    const applied = await db.query<{ migration_name: string }>(
      "select migration_name from _prisma_migrations where finished_at is not null and rolled_back_at is null and migration_name = $1",
      [REQUIRED_MIGRATION]
    );
    if (applied.rows.length === 0) problems.push(`The migration ${REQUIRED_MIGRATION} is not applied to this database.`);
  }
  return { ok: problems.length === 0, problems };
}
