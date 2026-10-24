import { prisma } from "../client";
import type { ReadinessFacts } from "../../ops/readiness";

// The two facts the readiness probe needs: can the database answer, and which migrations has it applied. READ-ONLY: two SELECTs, no write, no lock, no data from any
// application table (only the migration bookkeeping table Prisma itself maintains).
export async function loadReadinessFacts(): Promise<ReadinessFacts> {
  try {
    await prisma.$queryRaw`select 1 as ok`;
  } catch {
    return { databaseReachable: false };
  }
  try {
    const rows = await prisma.$queryRaw<Array<{ migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }>>`select migration_name, finished_at, rolled_back_at from _prisma_migrations`;
    return { databaseReachable: true, migrationRows: rows.map((r) => ({ name: r.migration_name, finishedAt: r.finished_at, rolledBackAt: r.rolled_back_at })) };
  } catch {
    return { databaseReachable: true, migrationRows: null };
  }
}
