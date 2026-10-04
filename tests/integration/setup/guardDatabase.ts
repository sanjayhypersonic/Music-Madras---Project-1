import path from "path";
import { findConfiguredRealDatabaseUrls } from "./loadIntegrationEnvironment";
import { resolveIntegrationDatabase } from "./testDatabaseRules";

// Phase 6J-2 — runs before EVERY integration test file (vitest.integration.config.ts
// setupFiles), as the last line of defence: whatever DATABASE_URL this worker ended
// up with must be the verified test database, and must not be a configured real one.
// The config injects both; this proves nothing (a stray runner, a different config,
// a changed env) replaced them. Throwing here fails the file before any test — and
// before the Prisma client — can touch a database.

const root = path.resolve(__dirname, "../../..");
const verdict = resolveIntegrationDatabase({
  env: { TEST_DATABASE_URL: process.env.DATABASE_URL, TEST_DIRECT_URL: process.env.DIRECT_URL, NODE_ENV: process.env.NODE_ENV, VERCEL_ENV: process.env.VERCEL_ENV },
  productionUrls: findConfiguredRealDatabaseUrls(root),
});

if (!verdict.ok) throw new Error(`Integration database guard: ${verdict.reason}`);
if (process.env.MM_INTEGRATION_DATABASE !== `${verdict.host}:${verdict.port}/${verdict.database}`) {
  throw new Error("Integration database guard: this process was not prepared by vitest.integration.config.ts, so its database cannot be trusted. Run `npm run test:integration`.");
}