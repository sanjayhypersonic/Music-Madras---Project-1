import { assessProductionConfig, type ConfigIssue, type ProductionConfigReport } from "./productionConfig";

// DEPLOYMENT-time configuration preflight (launch readiness; docs/deployment-readiness-gate.md §1). The runtime guard (productionConfig.ts) decides whether a server may
// START and deliberately asks only for what the running app cannot be safe without. A DEPLOYMENT needs more: migrations need the direct connection string, and several
// mistakes that are legal at runtime are almost certainly wrong for a launch (a test-named database, one connection string used for both roles, an origin that differs
// between the site and Studio). This module adds exactly those, on top of the runtime rules, and NEVER includes a value in a message (names and reasons only).
// PURE: it reads the environment it is given and opens nothing.

type Env = Readonly<Record<string, string | undefined>>;

const isSet = (v: string | undefined): v is string => typeof v === "string" && v.trim().length > 0;
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\]|::1|0\.0\.0\.0)$/i;

function parse(value: string | undefined): URL | null {
  if (!isSet(value)) return null;
  try {
    return new URL(value.trim());
  } catch {
    return null;
  }
}

export function assessDeploymentConfig(env: Env): ProductionConfigReport {
  const base = assessProductionConfig(env);
  const problems: ConfigIssue[] = [...base.problems];
  const warnings: ConfigIssue[] = [...base.warnings];

  // --- database roles ---------------------------------------------------------------------------------------------
  const database = parse(env.DATABASE_URL);
  const direct = parse(env.DIRECT_URL);
  if (!isSet(env.DIRECT_URL)) {
    problems.push({ variable: "DIRECT_URL", problem: "is not set (the direct, non-pooled connection string: migrations, the build's prisma generate and the YouTube sync lock use it)." });
  } else if (!direct) {
    problems.push({ variable: "DIRECT_URL", problem: "is not a valid connection string." });
  } else if (direct.protocol !== "postgresql:" && direct.protocol !== "postgres:") {
    problems.push({ variable: "DIRECT_URL", problem: "must be a postgresql:// connection string." });
  }
  if (database) {
    const name = decodeURIComponent(database.pathname.replace(/^\//, ""));
    if (/test/i.test(name)) problems.push({ variable: "DATABASE_URL", problem: "names a database that looks like a TEST database; a deployment must never point at one." });
    if (LOCAL_HOST.test(database.hostname)) warnings.push({ variable: "DATABASE_URL", problem: "points at this machine (localhost); a hosted deployment should use the managed database's pooled host." });
    if (direct && database.href === direct.href) {
      warnings.push({ variable: "DATABASE_URL", problem: "is identical to DIRECT_URL; on a serverless host the running app should use the POOLED connection string and only migrations the direct one." });
    }
    if (direct && decodeURIComponent(direct.pathname) !== decodeURIComponent(database.pathname)) {
      problems.push({ variable: "DIRECT_URL", problem: "names a different database from DATABASE_URL; the two must be the SAME database (pooled and direct routes to it)." });
    }
  }
  if (direct) {
    const name = decodeURIComponent(direct.pathname.replace(/^\//, ""));
    if (/test/i.test(name)) problems.push({ variable: "DIRECT_URL", problem: "names a database that looks like a TEST database; a deployment must never point at one." });
  }

  // --- origins ------------------------------------------------------------------------------------------------------
  const site = parse(env.PUBLIC_SITE_URL);
  const auth = parse(env.AUTH_URL);
  if (site && auth && site.origin !== auth.origin) {
    warnings.push({ variable: "AUTH_URL", problem: "has a different origin from PUBLIC_SITE_URL. That is only right if Studio is deliberately served from another address; otherwise sign-in cookies and email links will not line up." });
  }

  // --- email ----------------------------------------------------------------------------------------------------------
  if (isSet(env.SMTP_URL)) {
    const smtp = parse(env.SMTP_URL);
    if (!smtp || (smtp.protocol !== "smtp:" && smtp.protocol !== "smtps:")) problems.push({ variable: "SMTP_URL", problem: "is not a valid smtp:// or smtps:// URL." });
  }

  // --- things a LAUNCH needs that the runtime merely tolerates ---------------------------------------------------------
  if (!isSet(env.EMAIL_PROVIDER)) {
    // already a runtime warning; for a launch it blocks invitations and password reset
    const existing = warnings.find((w) => w.variable === "EMAIL_PROVIDER");
    if (existing) existing.problem += " (A launch needs this: Studio invitations and password reset cannot work without it.)";
  }
  return { problems, warnings };
}
