import { defineConfig } from "vitest/config";
import os from "os";
import path from "path";
import { resolveIntegrationDatabaseFromDisk } from "./tests/integration/setup/loadIntegrationEnvironment";
import { buildIntegrationWorkerEnv } from "./tests/integration/setup/testDatabaseRules";

// Separate from vitest.config.ts (which stays DB-free and is what `npm test`
// runs). Integration tests need a DEDICATED test database — see
// tests/integration/README.md. Never part of the default `npm test`.
//
// Phase 6J-2 — database isolation. This config resolves TEST_DATABASE_URL
// (shell, or .env.test; never .env, never a fallback to DATABASE_URL) and THROWS
// if it is missing or could be a real database, so a refused run never starts.
// Every worker then runs with DATABASE_URL/DIRECT_URL replaced by the test
// database, the repository's real .env unreadable, and every external service
// (YouTube, AI, email, analytics) switched off. globalSetup proves the database
// is a marked, migrated test database; setupFiles re-checks in each worker.
const target = resolveIntegrationDatabaseFromDisk(__dirname);
if (!target.ok) throw new Error(`Integration database guard: ${target.reason}`);

export default defineConfig({
  test: {
    include: ["tests/integration/**/*.test.ts"],
    environment: "node",
    globalSetup: ["tests/integration/setup/globalSetup.ts"],
    setupFiles: ["tests/integration/setup/guardDatabase.ts"],
    env: buildIntegrationWorkerEnv(target, path.join(os.tmpdir(), "music-madras-no-dotenv", ".env")),
    // Phase 6G-4A: multiple files create/count real global-scope rows (Recording,
    // Collection, MediaResource) in the one test database — running files in
    // parallel let one file's fixtures appear inside another's before/after count
    // assertions. Files therefore run one at a time against the one database; true
    // parallelism would need one database per worker, which is a later optimisation.
    fileParallelism: false,
    testTimeout: 20000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});