import "dotenv/config";
import { defineConfig, env } from "prisma/config";

// Prisma ORM 7+ configuration. The CLI (validate, generate, migrate, db
// push) uses DIRECT_URL — a non-pooled connection, appropriate for schema
// operations. The application runtime uses DATABASE_URL (pooled) via a
// driver adapter instantiated in modules/db/client.ts, not through this
// file. See ADR §6.3 for why the two are kept separate.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: env("DIRECT_URL"),
  },
});
