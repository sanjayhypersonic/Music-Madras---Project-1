import { parseBackfillDatabaseUrl, parseStrictBackfillUrl, type ParsedDatabaseTarget } from "../backfill/revisionRelationships/backfillTarget";

// Which database the STAGING CONTENT LOADER (scripts/seedStagingContent.ts) may write to. Pure rules (no fs, no network, no environment reads), so all of it is
// unit-tested with synthetic values. It follows the conventions of the backfill's target guard (modules/backfill/revisionRelationships/backfillTarget.ts):
//
//   1. The target comes ONLY from STAGING_DATABASE_URL. There is no fallback to DATABASE_URL, DIRECT_URL or anything else, ever.
//   2. The environment is not a production one (NODE_ENV).
//   3. The URL has the strict form postgresql://user[:password]@host:port/database (no query string, fragment or missing port, so the driver can never be steered
//      somewhere other than what was validated). The loader builds the connection from these validated fields, never from the raw string.
//   4. The host is a Neon host (*.neon.tech) and the DIRECT one (no "-pooler"): a loopback, private or unrecognised host is refused.
//   5. The database name carries the word "staging", and neither "test" nor "prod"/"production".
//   6. --confirm-host equals host:port/database exactly (the operator typed the target).
//   7. It is not any configured real database (DATABASE_URL / DIRECT_URL in the shell or in a .env* file; "-pooler" ignored when comparing).
//
// Every message names only a host, port and database, never a credential.

const NEON_HOST = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.neon\.tech$/;
const WORD = (word: string) => new RegExp(`(^|[^a-z0-9])${word}([^a-z0-9]|$)`, "i");

export interface StagingTargetInput {
  /** Only STAGING_DATABASE_URL and NODE_ENV are read. */
  env: Readonly<Record<string, string | undefined>>;
  /** The value following --confirm-host, if given. */
  confirmHost: string | undefined;
  /** Connection strings of the REAL database(s): DATABASE_URL / DIRECT_URL from the shell and from .env* files. */
  realUrls: readonly string[];
}

export interface StagingClientConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string | undefined;
}

export type StagingTargetResolution = ({ ok: true; clientConfig: StagingClientConfig } & ParsedDatabaseTarget) | { ok: false; reason: string };

export const describeStagingTarget = (target: ParsedDatabaseTarget): string => `${target.host}:${target.port}/${target.database}`;

export function resolveStagingTarget(input: StagingTargetInput): StagingTargetResolution {
  const fail = (reason: string): StagingTargetResolution => ({ ok: false, reason });
  const raw = input.env.STAGING_DATABASE_URL?.trim();
  if (!raw) return fail("STAGING_DATABASE_URL is not set. The loader never falls back to DATABASE_URL, DIRECT_URL or any other variable: name the staging database explicitly.");
  if (input.env.NODE_ENV === "production") return fail("NODE_ENV is production. The staging loader does not run in a production environment.");

  const strict = parseStrictBackfillUrl(raw);
  if (!strict.ok) return fail(strict.reason.replaceAll("BACKFILL_DATABASE_URL", "STAGING_DATABASE_URL"));
  const target: ParsedDatabaseTarget = { host: strict.host, port: strict.port, database: strict.database };
  const named = describeStagingTarget(target);

  if (!NEON_HOST.test(target.host)) return fail(`The host ${target.host} is not a Neon host (*.neon.tech). Loopback, private and unrecognised hosts are refused.`);
  if (target.host.split(".")[0].endsWith("-pooler")) return fail(`The host ${target.host} is a pooled endpoint. Use the DIRECT (non-pooled) staging connection string.`);
  if (WORD("test").test(target.database) || WORD("prod").test(target.database) || WORD("production").test(target.database)) {
    return fail(`The database name "${target.database}" looks like a test or production database. A staging database must not be named like one.`);
  }
  if (!WORD("staging").test(target.database)) {
    return fail(`The database name "${target.database}" does not contain the word "staging". Create the staging database with a name such as music_madras_staging, so that its identity is unambiguous.`);
  }

  if (!input.confirmHost?.trim()) return fail(`--confirm-host is required. Re-run with --confirm-host ${named} to confirm that this is the staging database you mean.`);
  if (input.confirmHost.trim().toLowerCase() !== named) return fail(`--confirm-host does not match the target in use (${named}). Nothing was changed.`);

  for (const real of input.realUrls) {
    const parsed = parseBackfillDatabaseUrl(real);
    if (parsed && parsed.host === target.host && parsed.port === target.port && parsed.database === target.database) {
      return fail(`The target ${named} is the same database as a configured DATABASE_URL / DIRECT_URL. The staging loader refuses any configured real database.`);
    }
  }

  return { ok: true, ...target, clientConfig: { host: target.host, port: Number(target.port), database: target.database, user: strict.user, password: strict.password } };
}

/** The connection string handed to the application's database client: built from the validated fields only, with TLS required (Neon refuses clear text). */
export function buildStagingConnectionString(config: StagingClientConfig): string {
  const auth = config.password === undefined ? encodeURIComponent(config.user) : `${encodeURIComponent(config.user)}:${encodeURIComponent(config.password)}`;
  return `postgresql://${auth}@${config.host}:${config.port}/${encodeURIComponent(config.database)}?sslmode=require`;
}
