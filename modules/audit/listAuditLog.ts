import { prisma } from "../db/client";
import type { AuditLogEntry } from "@prisma/client";

// Read side of the append-only audit log (ADR §20). Lives alongside
// writeAuditLog.ts rather than under modules/db/repositories, matching
// that file's existing precedent of importing modules/db/client directly
// for this one cross-cutting concern.

export interface AuditLogEntryWithActor extends AuditLogEntry {
  actor: { id: string; name: string; email: string } | null;
}

export function listRecentAuditLogEntries(limit = 20): Promise<AuditLogEntryWithActor[]> {
  return prisma.auditLogEntry.findMany({
    orderBy: { timestamp: "desc" },
    take: limit,
    include: { actor: { select: { id: true, name: true, email: true } } },
  });
}

export function listAuditLogEntriesForEntity(
  entityType: string,
  entityId: string
): Promise<AuditLogEntryWithActor[]> {
  return prisma.auditLogEntry.findMany({
    where: { entityType, entityId },
    orderBy: { timestamp: "desc" },
    include: { actor: { select: { id: true, name: true, email: true } } },
  });
}
