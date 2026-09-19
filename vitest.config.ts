import { defineConfig } from "vitest/config";
import path from "path";

// Phase 1 scope: unit tests only (tests/unit), runnable without any
// external database. tests/integration and tests/e2e are documented
// placeholders — see their README files — until a real database/running
// app exists to test against.
export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
