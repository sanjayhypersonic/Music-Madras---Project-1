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
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
