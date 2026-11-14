import { prisma } from "../client";
import { readVideoCreditsExportBatch, type VideoCreditsExportRow } from "./videoCreditsExportQuery";

// Credits extraction, route 2: opens the ONE transaction the staging export runs in. Everything inside it is in videoCreditsExportQuery.ts, whose
// first statement makes the transaction read-only. Imported only by scripts/exportVideoCreditsSource.ts, after that script has bound the database
// client to the checked staging target.

export async function exportVideoCreditsSource(options: { limit: number | null; offset: number }): Promise<{ totalMatching: number; rows: VideoCreditsExportRow[] }> {
  return prisma.$transaction((tx) => readVideoCreditsExportBatch(tx, options), { timeout: 60_000, maxWait: 10_000 });
}

export async function disconnectVideoCreditsExport(): Promise<void> {
  await prisma.$disconnect();
}
