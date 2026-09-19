import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

// This is the ONLY file in the application that may import `@prisma/client`
// or `@prisma/adapter-pg` (ADR §3 boundary rule). Every other module reaches
// the database through a repository in modules/db/repositories, never
// through this client directly.
//
// The runtime uses DATABASE_URL (pooled — see ADR §6.3) via a driver
// adapter, distinct from prisma.config.ts's DIRECT_URL, which the CLI uses
// for schema/migration operations only.

declare global {
  var __musicMadrasPrisma: PrismaClient | undefined;
}

function createPrismaClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env.local and configure " +
        "it before any code path that touches the database runs. See " +
        "docs/phase-1-foundation.md."
    );
  }

  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

// Reuse a single instance across hot reloads in development, matching the
// standard Next.js + Prisma guidance, since Next.js dev mode re-evaluates
// modules on every change and would otherwise exhaust connections.
export const prisma = globalThis.__musicMadrasPrisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__musicMadrasPrisma = prisma;
}
