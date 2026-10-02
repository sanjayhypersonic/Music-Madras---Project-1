import { describeConnectionHost } from "../../../modules/jobs/syncRunLock";

// Phase 6J-1 — the rule behind the integration-test database guard. The
// integration suite CREATES AND DELETES rows, so it must never run against a
// database the operator has not knowingly named as a test target.
//
//  - A production process (NODE_ENV / VERCEL_ENV = production) is always refused.
//  - DATABASE_URL and DIRECT_URL must be the same database (a pooled and a
//    direct endpoint of ONE database differ only by "-pooler"); two different
//    databases mean the environment is misconfigured, so nothing runs.
//  - A local database is allowed. Any other host must be acknowledged by name
//    in ALLOW_INTEGRATION_TESTS_ON_HOST, so pointing the suite at a different
//    database is a deliberate act, never an accident of a copied .env.
// It reads and prints host names only — never credentials.

export interface IntegrationGuardEnvironment {
  DATABASE_URL?: string;
  DIRECT_URL?: string;
  ALLOW_INTEGRATION_TESTS_ON_HOST?: string;
  NODE_ENV?: string;
  VERCEL_ENV?: string;
}

export type IntegrationGuardVerdict = { allowed: true; host: string } | { allowed: false; reason: string };

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function endpointHost(connectionString: string): string | null {
  try {
    return new URL(connectionString).hostname.toLowerCase().replace(/-pooler(?=\.|$)/, "");
  } catch {
    return null;
  }
}

export function checkIntegrationDatabase(env: IntegrationGuardEnvironment): IntegrationGuardVerdict {
  if (env.NODE_ENV === "production" || env.VERCEL_ENV === "production") {
    return { allowed: false, reason: "Refusing to run the integration suite in a production environment (NODE_ENV/VERCEL_ENV is production)." };
  }
  if (!env.DATABASE_URL) return { allowed: false, reason: "DATABASE_URL is not set, so there is no database to test against." };

  const host = endpointHost(env.DATABASE_URL);
  if (!host) return { allowed: false, reason: "DATABASE_URL could not be parsed." };

  if (env.DIRECT_URL) {
    const directHost = endpointHost(env.DIRECT_URL);
    if (directHost !== host) {
      return {
        allowed: false,
        reason: `DATABASE_URL (${describeConnectionHost(env.DATABASE_URL)}) and DIRECT_URL (${describeConnectionHost(env.DIRECT_URL)}) point at different databases; refusing to guess which one the tests may write to.`,
      };
    }
  }

  if (LOCAL_HOSTS.has(host)) return { allowed: true, host };

  if (env.ALLOW_INTEGRATION_TESTS_ON_HOST?.trim().toLowerCase() === host) return { allowed: true, host };

  return {
    allowed: false,
    reason:
      `The integration suite creates and deletes rows, and DATABASE_URL points at the non-local database "${host}". ` +
      `If that is a database you intend to run the tests against, set ALLOW_INTEGRATION_TESTS_ON_HOST=${host} for this run. Nothing was run.`,
  };
}
