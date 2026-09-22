import { defineConfig } from "vitest/config";
import path from "path";

// Separate from vitest.config.ts (which stays DB-free and is what `npm
// test` runs) because these tests need a real, reachable DATABASE_URL —
// see tests/integration/README.md. Run explicitly with
// `npm run test:integration` once a development database is configured;
// never part of the default `npm test`.
export default defineConfig({
  test: {
    include: ["tests/integration/**/*.test.ts"],
    environment: "node",
    // Phase 6G-4A: multiple files now create/count real global-scope rows
    // (Recording, Collection, MediaResource) against the same shared
    // database — running test files in parallel let one file's fixture
    // rows transiently appear inside another file's before/after count
    // assertion. Integration tests against one real database must run one
    // file at a time to stay deterministic; this is a test-runner setting,
    // not an application behavior change.
    fileParallelism: false,
    testTimeout: 20000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
