import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // legacy-prototype is a separate, standalone Vite app preserved for
    // reference (see legacy-prototype/LEGACY_NOTICE.md) — it has its own
    // tooling and is not part of this application.
    "legacy-prototype/**",
  ]),
]);

export default eslintConfig;
