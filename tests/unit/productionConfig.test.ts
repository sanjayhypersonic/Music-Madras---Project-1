import { describe, expect, it } from "vitest";
import { assertProductionConfig, assessProductionConfig, isProductionRuntime, ProductionConfigurationError } from "../../modules/config/productionConfig";
import { SUPPORTED_AI_PROVIDER_NAMES } from "../../modules/ai/provider/aiProviderRegistry";

// Phase 6J-9A — start-up validation of security-critical production configuration.
// None of these tests needs a database, a network or a real secret.

const SECRET_SENTINEL = "SECRET-SENTINEL-do-not-print-0123456789";

const GOOD_ENV = {
  NODE_ENV: "production",
  DATABASE_URL: `postgresql://user:${SECRET_SENTINEL}@db.example.org/app?sslmode=require`,
  PUBLIC_SITE_URL: "https://www.example.org",
  AUTH_URL: "https://www.example.org",
  AUTH_SECRET: `${SECRET_SENTINEL}-0123456789abcdef`,
  EMAIL_PROVIDER: "smtp",
  SMTP_URL: `smtps://mailer:${SECRET_SENTINEL}@smtp.example.org:465`,
  EMAIL_FROM: "Music Madras <studio@example.org>",
  CRON_SECRET: `${SECRET_SENTINEL}-cron-0123456789abcdef`,
  ALERT_WEBHOOK_URL: `https://hooks.example.org/services/${SECRET_SENTINEL}-webhook-token`,
};

const problemsFor = (overrides: Record<string, string | undefined>) => assessProductionConfig({ ...GOOD_ENV, ...overrides }).problems.map((p) => p.variable);

describe("isProductionRuntime", () => {
  it("is true only for NODE_ENV=production outside the build phase", () => {
    expect(isProductionRuntime({ NODE_ENV: "production" })).toBe(true);
    expect(isProductionRuntime({ NODE_ENV: "production", NEXT_PHASE: "phase-production-build" })).toBe(false);
    expect(isProductionRuntime({ NODE_ENV: "development" })).toBe(false);
    expect(isProductionRuntime({ NODE_ENV: "test" })).toBe(false);
    expect(isProductionRuntime({})).toBe(false);
  });
});

describe("assessProductionConfig", () => {
  it("accepts a complete, correct production configuration", () => {
    expect(assessProductionConfig(GOOD_ENV)).toEqual({ problems: [], warnings: [] });
  });

  it.each(["DATABASE_URL", "PUBLIC_SITE_URL", "AUTH_URL", "AUTH_SECRET"])("requires %s", (name) => {
    expect(problemsFor({ [name]: undefined })).toContain(name);
    expect(problemsFor({ [name]: "   " })).toContain(name);
  });

  it("rejects an unusable database URL without echoing it", () => {
    expect(problemsFor({ DATABASE_URL: "not a url" })).toContain("DATABASE_URL");
    expect(problemsFor({ DATABASE_URL: `mysql://u:${SECRET_SENTINEL}@h/db` })).toContain("DATABASE_URL");
  });

  it("requires https, non-local public origins", () => {
    for (const bad of ["http://www.example.org", "https://localhost:3000", "https://127.0.0.1", "not a url"]) {
      expect(problemsFor({ PUBLIC_SITE_URL: bad })).toContain("PUBLIC_SITE_URL");
      expect(problemsFor({ AUTH_URL: bad })).toContain("AUTH_URL");
    }
  });

  it("rejects a placeholder or short AUTH_SECRET", () => {
    expect(problemsFor({ AUTH_SECRET: "replace-with-a-long-random-string" })).toContain("AUTH_SECRET");
    expect(problemsFor({ AUTH_SECRET: "short" })).toContain("AUTH_SECRET");
  });

  it("refuses the fake AI provider and any unsupported AI provider", () => {
    expect(problemsFor({ AI_PROVIDER: "fake" })).toContain("AI_PROVIDER");
    expect(problemsFor({ AI_PROVIDER: " FAKE " })).toContain("AI_PROVIDER");
    expect(problemsFor({ AI_PROVIDER: "openai" })).toContain("AI_PROVIDER");
  });

  it("only knows provider names the registry supports", () => {
    expect(SUPPORTED_AI_PROVIDER_NAMES).toContain("anthropic");
  });

  it("keeps AI-disabled operation valid: no AI_PROVIDER and no ANTHROPIC_API_KEY is neither a problem nor a warning", () => {
    const report = assessProductionConfig({ ...GOOD_ENV, AI_PROVIDER: undefined, ANTHROPIC_API_KEY: undefined });
    expect(report.problems).toEqual([]);
    expect(report.warnings.map((w) => w.variable)).not.toContain("ANTHROPIC_API_KEY");
  });

  it("warns (does not fail) when anthropic is selected without a key", () => {
    const report = assessProductionConfig({ ...GOOD_ENV, AI_PROVIDER: "anthropic" });
    expect(report.problems).toEqual([]);
    expect(report.warnings.map((w) => w.variable)).toEqual(["ANTHROPIC_API_KEY"]);
    expect(assessProductionConfig({ ...GOOD_ENV, AI_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "k" }).warnings).toEqual([]);
  });

  it("does not force email: unset is a warning; console/unknown is refused; smtp must be complete", () => {
    const off = assessProductionConfig({ ...GOOD_ENV, EMAIL_PROVIDER: undefined, SMTP_URL: undefined, EMAIL_FROM: undefined });
    expect(off.problems).toEqual([]);
    expect(off.warnings.map((w) => w.variable)).toEqual(["EMAIL_PROVIDER"]);
    expect(problemsFor({ EMAIL_PROVIDER: "console" })).toContain("EMAIL_PROVIDER");
    expect(problemsFor({ EMAIL_PROVIDER: "carrier-pigeon" })).toContain("EMAIL_PROVIDER");
    expect(problemsFor({ SMTP_URL: undefined })).toContain("SMTP_URL");
    expect(problemsFor({ EMAIL_FROM: undefined })).toContain("EMAIL_FROM");
  });

  it("requires Google sign-in variables together or not at all", () => {
    expect(problemsFor({ GOOGLE_CLIENT_ID: "id" })).toContain("GOOGLE_CLIENT_ID");
    expect(problemsFor({ GOOGLE_CLIENT_SECRET: "secret" })).toContain("GOOGLE_CLIENT_ID");
    expect(problemsFor({ GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "secret" })).toEqual([]);
  });

  it("refuses test-database variables in a deployed environment", () => {
    expect(problemsFor({ TEST_DATABASE_URL: "postgresql://x@127.0.0.1/x_test" })).toContain("TEST_DATABASE_URL");
    expect(problemsFor({ TEST_DIRECT_URL: "postgresql://x@127.0.0.1/x_test" })).toContain("TEST_DATABASE_URL");
  });

  it("never needs DIRECT_URL, YouTube or analytics variables at runtime", () => {
    expect(problemsFor({ DIRECT_URL: undefined, YOUTUBE_API_KEY: undefined, YOUTUBE_CHANNEL_ID: undefined, GA4_MEASUREMENT_ID: undefined })).toEqual([]);
  });
});

describe("assertProductionConfig", () => {
  it("does nothing outside a production runtime — development, tests and `next build` are never affected", () => {
    expect(assertProductionConfig({ NODE_ENV: "development" })).toEqual([]);
    expect(assertProductionConfig({ NODE_ENV: "test", AI_PROVIDER: "fake" })).toEqual([]);
    expect(assertProductionConfig({ NODE_ENV: "production", NEXT_PHASE: "phase-production-build" })).toEqual([]); // a dummy/empty build environment passes
  });

  it("returns warnings for a valid production environment", () => {
    expect(assertProductionConfig({ ...GOOD_ENV, EMAIL_PROVIDER: undefined })).toEqual([{ variable: "EMAIL_PROVIDER", problem: expect.any(String) }]);
  });

  it("throws a ProductionConfigurationError listing variable NAMES and problems, never a value", () => {
    let error: unknown;
    try {
      assertProductionConfig({ ...GOOD_ENV, AI_PROVIDER: "fake", AUTH_SECRET: "tiny-secret-xyz", PUBLIC_SITE_URL: `http://${SECRET_SENTINEL}.example.org`, DATABASE_URL: `mysql://u:${SECRET_SENTINEL}@h/db` });
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(ProductionConfigurationError);
    const message = (error as Error).message;
    for (const name of ["AI_PROVIDER", "AUTH_SECRET", "PUBLIC_SITE_URL", "DATABASE_URL"]) expect(message).toContain(name);
    expect(message).not.toContain(SECRET_SENTINEL);
    expect(message).not.toContain("tiny-secret-xyz");
    expect(message).not.toContain("mysql://"); // the offending value is not echoed (the hint text itself names the expected scheme)
  });
});

describe("ALERT_WEBHOOK_URL (operator alerts)", () => {
  it("is optional but warned about when unset, because then the application tells no one", () => {
    const report = assessProductionConfig({ ...GOOD_ENV, ALERT_WEBHOOK_URL: undefined });
    expect(report.problems).toEqual([]);
    expect(report.warnings.map((w) => w.variable)).toEqual(["ALERT_WEBHOOK_URL"]);
  });

  it("refuses a value that cannot work (not https, credentials in the URL, this machine, not a URL) and never echoes it", () => {
    for (const value of ["http://hooks.example.org/x", "https://user:pw@hooks.example.org/x", "https://localhost/x", "not a url"]) {
      const report = assessProductionConfig({ ...GOOD_ENV, ALERT_WEBHOOK_URL: value });
      expect(report.problems.map((p) => p.variable)).toEqual(["ALERT_WEBHOOK_URL"]);
      expect(JSON.stringify(report)).not.toContain(value);
    }
    expect(() => assertProductionConfig({ ...GOOD_ENV, ALERT_WEBHOOK_URL: "http://hooks.example.org/x" })).toThrow(ProductionConfigurationError);
  });

  it("a valid URL is accepted and its secret path never appears in the report", () => {
    expect(JSON.stringify(assessProductionConfig(GOOD_ENV))).not.toContain(SECRET_SENTINEL);
  });
});

describe("CRON_SECRET (the scheduled maintenance endpoint)", () => {
  it("is optional but warned about when unset, because without it emails are never sent and the sweeps run only when Studio is opened", () => {
    const report = assessProductionConfig({ ...GOOD_ENV, CRON_SECRET: undefined });
    expect(report.problems).toEqual([]);
    expect(report.warnings.map((w) => w.variable)).toEqual(["CRON_SECRET"]);
    expect(report.warnings[0].problem).toMatch(/emails are never sent/);
  });

  it("is refused when set but weak, and never printed", () => {
    expect(problemsFor({ CRON_SECRET: "short" })).toEqual(["CRON_SECRET"]);
    expect(() => assertProductionConfig({ ...GOOD_ENV, CRON_SECRET: "short" })).toThrow(ProductionConfigurationError);
    try {
      assertProductionConfig({ ...GOOD_ENV, CRON_SECRET: "short-but-secret-value" });
    } catch (err) {
      expect(String((err as Error).message)).not.toContain("short-but-secret-value");
    }
  });
});