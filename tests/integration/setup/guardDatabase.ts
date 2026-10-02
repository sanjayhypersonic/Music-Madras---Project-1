import "dotenv/config";
import { checkIntegrationDatabase } from "./databaseGuardRules";

// Runs before every integration test file (vitest.integration.config.ts
// setupFiles). Throwing here fails the file before any test — and before the
// Prisma client — can touch the database. See databaseGuardRules.ts.
const verdict = checkIntegrationDatabase(process.env);
if (!verdict.allowed) throw new Error(`Integration database guard: ${verdict.reason}`);
