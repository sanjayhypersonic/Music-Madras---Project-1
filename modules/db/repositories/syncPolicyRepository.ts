import { prisma } from "../client";
import { writeAuditLog } from "../../audit/writeAuditLog";
import type { SyncPolicy, SyncProvider, SyncResourceType } from "@prisma/client";

// SyncPolicy persistence (Phase 6B, ADR §15) — deletionEvidenceRequiredPasses
// held as configuration, not a literal constant in the (not-yet-built)
// availability/escalation logic. ADR §15's default is 3; see
// DEFAULT_DELETION_EVIDENCE_REQUIRED_PASSES below — that constant is only
// the seed value used when first creating a policy row for a given
// (provider, resourceType), never a runtime fallback the escalation logic
// substitutes for a missing row. Changing a policy is a Studio Settings
// action (a later phase), so it is always audit-logged.

export const DEFAULT_DELETION_EVIDENCE_REQUIRED_PASSES = 3;

export function findSyncPolicy(provider: SyncProvider, resourceType: SyncResourceType): Promise<SyncPolicy | null> {
  return prisma.syncPolicy.findUnique({ where: { provider_resourceType: { provider, resourceType } } });
}

export function listSyncPolicies(): Promise<SyncPolicy[]> {
  return prisma.syncPolicy.findMany();
}

export interface UpsertSyncPolicyInput {
  provider: SyncProvider;
  resourceType: SyncResourceType;
  deletionEvidenceRequiredPasses?: number;
  isActive?: boolean;
  actorId: string;
}

export async function upsertSyncPolicy(input: UpsertSyncPolicyInput): Promise<SyncPolicy> {
  const before = await findSyncPolicy(input.provider, input.resourceType);

  const updated = await prisma.syncPolicy.upsert({
    where: { provider_resourceType: { provider: input.provider, resourceType: input.resourceType } },
    create: {
      provider: input.provider,
      resourceType: input.resourceType,
      deletionEvidenceRequiredPasses: input.deletionEvidenceRequiredPasses ?? DEFAULT_DELETION_EVIDENCE_REQUIRED_PASSES,
      isActive: input.isActive ?? true,
    },
    update: {
      deletionEvidenceRequiredPasses: input.deletionEvidenceRequiredPasses,
      isActive: input.isActive,
    },
  });

  await writeAuditLog({
    actorId: input.actorId,
    action: "SYNC_POLICY_CHANGED",
    entityType: "SyncPolicy",
    entityId: updated.id,
    beforeSnapshot: before,
    afterSnapshot: updated,
  });

  return updated;
}
