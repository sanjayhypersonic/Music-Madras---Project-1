import { prisma } from "../db/client";
import type { AuditLogEntry, Prisma } from "@prisma/client";

// Read side of the append-only audit log (ADR §20). Lives alongside
// writeAuditLog.ts rather than under modules/db/repositories, matching
// that file's existing precedent of importing modules/db/client directly
// for this one cross-cutting concern.
//
// Phase 6G-15 — extends this file (never a second audit read-side module)
// with the filtering/pagination/detail-lookup the Studio Audit Log page
// needs. No new AuditLogEntry columns, no new event taxonomy: everything
// here reads the exact same table and fields that already existed.

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

/**
 * Phase 6G-15: capped at `limit` (default 20) — a "lightweight
 * chronological list" for an entity-page Activity section, never the
 * entity's entire history unbounded.
 */
export function listAuditLogEntriesForEntity(
  entityType: string,
  entityId: string,
  limit = 20
): Promise<AuditLogEntryWithActor[]> {
  return prisma.auditLogEntry.findMany({
    where: { entityType, entityId },
    orderBy: { timestamp: "desc" },
    take: limit,
    include: { actor: { select: { id: true, name: true, email: true } } },
  });
}

export function findAuditLogEntryById(id: string): Promise<AuditLogEntryWithActor | null> {
  return prisma.auditLogEntry.findUnique({
    where: { id },
    include: { actor: { select: { id: true, name: true, email: true } } },
  });
}

export const AUDIT_LOG_PAGE_SIZE = 50;

export interface AuditLogFilters {
  /** Matches against actor name/email or the raw entityId (case-insensitive contains). */
  q?: string;
  entityType?: string;
  action?: string;
  actorId?: string;
  /** Inclusive start of the timestamp range. */
  from?: Date;
  /** Inclusive end of the timestamp range (the caller is responsible for widening to end-of-day if that's the intent). */
  to?: Date;
}

export interface AuditLogPage {
  items: AuditLogEntryWithActor[];
  total: number;
  page: number;
  pageSize: number;
}

function clampPage(page: number): number {
  return Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
}

/**
 * The Studio Audit Log page's sole data source — server-side filtered and
 * paginated (brief §7: "avoid loading the entire AuditLog table into
 * memory"), using the table's existing [entityType, entityId] and
 * [timestamp] indexes. No new index added: `action`/`actorId` filters run
 * as plain equality predicates, acceptable for this table's realistic
 * size without a speculative index (brief §7: "do not add speculative
 * indexes unless required").
 */
export async function listAuditLogEntriesPage(
  filters: AuditLogFilters,
  page = 1,
  pageSize = AUDIT_LOG_PAGE_SIZE
): Promise<AuditLogPage> {
  const currentPage = clampPage(page);

  const where: Prisma.AuditLogEntryWhereInput = {
    entityType: filters.entityType || undefined,
    action: filters.action || undefined,
    actorId: filters.actorId || undefined,
    timestamp:
      filters.from || filters.to
        ? { gte: filters.from, lte: filters.to }
        : undefined,
    ...(filters.q
      ? {
          OR: [
            { entityId: { contains: filters.q, mode: "insensitive" } },
            { actor: { name: { contains: filters.q, mode: "insensitive" } } },
            { actor: { email: { contains: filters.q, mode: "insensitive" } } },
          ],
        }
      : {}),
  };

  const [items, total] = await Promise.all([
    prisma.auditLogEntry.findMany({
      where,
      orderBy: { timestamp: "desc" },
      skip: (currentPage - 1) * pageSize,
      take: pageSize,
      include: { actor: { select: { id: true, name: true, email: true } } },
    }),
    prisma.auditLogEntry.count({ where }),
  ]);

  return { items, total, page: currentPage, pageSize };
}

/** Bounded distinct-value lookups for the filter dropdowns — never the full table. */
export async function listDistinctAuditEntityTypes(): Promise<string[]> {
  const rows = await prisma.auditLogEntry.findMany({
    distinct: ["entityType"],
    select: { entityType: true },
    orderBy: { entityType: "asc" },
  });
  return rows.map((r) => r.entityType);
}

export async function listDistinctAuditActions(): Promise<string[]> {
  const rows = await prisma.auditLogEntry.findMany({
    distinct: ["action"],
    select: { action: true },
    orderBy: { action: "asc" },
  });
  return rows.map((r) => r.action);
}
