import { prisma } from "../db/client";
import type { Prisma, PrismaClient } from "@prisma/client";

// The one place AuditLogEntry rows are written (ADR §20). Every mutating
// repository call in modules/db/repositories is expected to call this
// alongside its write, ideally inside the same transaction via the
// optional `client` parameter.

export interface WriteAuditLogInput {
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  beforeSnapshot?: unknown;
  afterSnapshot?: unknown;
}

type TransactionClient = Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">;

export async function writeAuditLog(
  input: WriteAuditLogInput,
  client: TransactionClient | PrismaClient = prisma
): Promise<void> {
  await client.auditLogEntry.create({
    data: {
      actorId: input.actorId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      beforeSnapshot: (input.beforeSnapshot ?? undefined) as Prisma.InputJsonValue | undefined,
      afterSnapshot: (input.afterSnapshot ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });
}
