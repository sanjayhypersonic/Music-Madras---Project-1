import { parsePublicSiteUrl } from "./siteOrigin";

// Phase 6J-9A — fail-fast validation of the security-critical configuration a PRODUCTION
// server cannot run safely without. Called once at server start (instrumentation.ts). Verified on
// Next.js 16.4: when it throws, the framework logs the error (variable NAMES only) and then answers
// EVERY request with HTTP 500, including /api/health, so a misconfigured deployment fails its
// health check and cannot look healthy, instead of failing on the first sign-in, email or request.
//
// Hard rules:
//   - it NEVER reads a value into a message: problems name the variable and what is wrong with
//     it, never the value (no URL, secret, key or token can reach a log or an error page);
//   - it runs only for a production RUNTIME. It does nothing in development, in tests, or during
//     `next build` (NEXT_PHASE=phase-production-build), and it never opens a database connection
//     or makes a network call, so a build stays independent of any live service;
//   - it requires only what the application cannot be safe without. Optional capabilities
//     (email, AI, Google sign-in, GA4, YouTube) are NOT required: when intentionally left unset
//     they are reported as warnings at most; when set they must be set correctly.
//
// What this does NOT prove (needs the live platform or console): that credentials are valid,
// that the domain resolves, that email is deliverable, that the database is reachable.

export interface ConfigIssue {
  /** The environment variable's NAME — never its value. */
  variable: string;
  problem: string;
}

export interface ProductionConfigReport {
  problems: ConfigIssue[];
  warnings: ConfigIssue[];
}

type Env = Readonly<Record<string, string | undefined>>;

const MIN_AUTH_SECRET_LENGTH = 32;
const MIN_CRON_SECRET_LENGTH = 32;
const PLACEHOLDER_AUTH_SECRET = "replace-with-a-long-random-string";

const isSet = (value: string | undefined): value is string => typeof value === "string" && value.trim().length > 0;

export function isProductionRuntime(env: Env): boolean {
  return env.NODE_ENV === "production" && env.NEXT_PHASE !== "phase-production-build";
}

/** Pure. Reports problems for a production environment (call isProductionRuntime first). Never includes a value. */
export function assessProductionConfig(env: Env): ProductionConfigReport {
  const problems: ConfigIssue[] = [];
  const warnings: ConfigIssue[] = [];

  // --- database -----------------------------------------------------------------------------
  if (!isSet(env.DATABASE_URL)) {
    problems.push({ variable: "DATABASE_URL", problem: "is not set." });
  } else {
    try {
      const protocol = new URL(env.DATABASE_URL.trim()).protocol;
      if (protocol !== "postgresql:" && protocol !== "postgres:") problems.push({ variable: "DATABASE_URL", problem: "must be a postgresql:// connection string." });
    } catch {
      problems.push({ variable: "DATABASE_URL", problem: "is not a valid connection string." });
    }
  }
  if (isSet(env.TEST_DATABASE_URL) || isSet(env.TEST_DIRECT_URL)) {
    problems.push({ variable: "TEST_DATABASE_URL", problem: "(or TEST_DIRECT_URL) is set; test-database variables must never exist in a deployed environment." });
  }

  // --- public origin and authentication ---------------------------------------------------------
  if (!isSet(env.PUBLIC_SITE_URL)) {
    problems.push({ variable: "PUBLIC_SITE_URL", problem: "is not set (the public https:// origin of the site)." });
  } else {
    const parsed = parsePublicSiteUrl(env.PUBLIC_SITE_URL, { requireHttpsNonLocal: true });
    if (!parsed.ok) problems.push({ variable: "PUBLIC_SITE_URL", problem: parsed.reason });
  }
  if (!isSet(env.AUTH_URL)) {
    problems.push({ variable: "AUTH_URL", problem: "is not set (the https:// address Studio is served from)." });
  } else {
    const parsed = parsePublicSiteUrl(env.AUTH_URL, { requireHttpsNonLocal: true });
    if (!parsed.ok) problems.push({ variable: "AUTH_URL", problem: parsed.reason });
  }
  if (!isSet(env.AUTH_SECRET)) {
    problems.push({ variable: "AUTH_SECRET", problem: "is not set." });
  } else if (env.AUTH_SECRET.trim() === PLACEHOLDER_AUTH_SECRET) {
    problems.push({ variable: "AUTH_SECRET", problem: "still has the placeholder value from .env.example." });
  } else if (env.AUTH_SECRET.trim().length < MIN_AUTH_SECRET_LENGTH) {
    problems.push({ variable: "AUTH_SECRET", problem: `is too short (use at least ${MIN_AUTH_SECRET_LENGTH} random characters).` });
  }
  if (isSet(env.GOOGLE_CLIENT_ID) !== isSet(env.GOOGLE_CLIENT_SECRET)) {
    problems.push({ variable: "GOOGLE_CLIENT_ID", problem: "and GOOGLE_CLIENT_SECRET must be set together or both left unset." });
  }

  // --- AI (optional capability) ------------------------------------------------------------------
  const aiProvider = env.AI_PROVIDER?.trim().toLowerCase();
  if (aiProvider === "fake") {
    problems.push({ variable: "AI_PROVIDER", problem: 'must not be "fake" in production (the fake provider returns canned output).' });
  } else if (isSet(aiProvider) && aiProvider !== "anthropic") {
    problems.push({ variable: "AI_PROVIDER", problem: 'is not a supported provider (leave it unset, or use "anthropic").' });
  } else if (aiProvider === "anthropic" && !isSet(env.ANTHROPIC_API_KEY)) {
    warnings.push({ variable: "ANTHROPIC_API_KEY", problem: "is not set although AI_PROVIDER selects anthropic; editorial generation will report that AI is unavailable." });
  }

  // --- email (optional capability; but if selected it must be complete) ---------------------------
  const emailProvider = env.EMAIL_PROVIDER?.trim().toLowerCase();
  if (!isSet(emailProvider)) {
    warnings.push({ variable: "EMAIL_PROVIDER", problem: "is not set; Studio invitations and password-reset emails cannot be sent." });
  } else if (emailProvider !== "smtp") {
    problems.push({ variable: "EMAIL_PROVIDER", problem: 'must be "smtp" in production (the console provider is development-only).' });
  } else {
    if (!isSet(env.SMTP_URL)) problems.push({ variable: "SMTP_URL", problem: "is not set although EMAIL_PROVIDER is smtp." });
    if (!isSet(env.EMAIL_FROM)) problems.push({ variable: "EMAIL_FROM", problem: "is not set although EMAIL_PROVIDER is smtp." });
  }

  // --- scheduled maintenance (optional capability; but a weak secret on a live endpoint is refused) --------------
  if (!isSet(env.CRON_SECRET)) {
    warnings.push({
      variable: "CRON_SECRET",
      problem: "is not set; the scheduled maintenance endpoint (/api/cron/stewardship) is disabled, so notification emails are never sent and the unlisted-video review and playlist checks run only when someone opens Studio.",
    });
  } else if (env.CRON_SECRET.trim().length < MIN_CRON_SECRET_LENGTH) {
    problems.push({ variable: "CRON_SECRET", problem: `is too short (use at least ${MIN_CRON_SECRET_LENGTH} random characters).` });
  }

  return { problems, warnings };
}

export class ProductionConfigurationError extends Error {
  readonly problems: ConfigIssue[];
  constructor(problems: ConfigIssue[]) {
    super(
      `Refusing to serve requests: the production configuration is not safe. Fix these environment variables (names only; values are never shown):\n` +
        problems.map((p) => `  - ${p.variable}: ${p.problem}`).join("\n")
    );
    this.name = "ProductionConfigurationError";
    this.problems = problems;
  }
}

/**
 * Throws ProductionConfigurationError when a production RUNTIME has unsafe configuration; otherwise does nothing
 * (development, tests and `next build` are never affected). Returns the warnings so the caller can log them.
 */
export function assertProductionConfig(env: Env = process.env): ConfigIssue[] {
  if (!isProductionRuntime(env)) return [];
  const report = assessProductionConfig(env);
  if (report.problems.length > 0) throw new ProductionConfigurationError(report.problems);
  return report.warnings;
}
