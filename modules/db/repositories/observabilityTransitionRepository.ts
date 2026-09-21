import { prisma } from "../client";
import { writeAuditLog } from "../../audit/writeAuditLog";
import type { ObservabilityState, ObservabilityTransition, SyncProvider, SyncResourceType } from "@prisma/client";

// ObservabilityTransition persistence (Phase 6B, ADR §15) — the evidence
// record behind an availability-state change. Reaching DELETED or
// UNAVAILABLE is explicitly called out by the ADR as "a consequential
// system decision," so recording one is always audit-logged, unlike the
// routine field-value syncs in fieldOwnershipRepository.ts. This module
// only stores a transition it is told happened — the escalation
// logic that decides *when* NOT_OBSERVED should become DELETED (counting
// consecutive FULL passes against SyncPolicy) is not implemented here;
// that is the sync engine's job, a later phase.

export interface RecordObservabilityTransitionInput {
  provider: SyncProvider;
  resourceType: SyncResourceType;
  resourceId: string;
  musicMadrasEntityType?: string;
  musicMadrasEntityId?: string;
  fromState: ObservabilityState;
  toState: ObservabilityState;
  reason: string;
  requiredPasses?: number;
  syncJobRunId?: string;
  syncCheckpointId?: string;
}

export async function recordObservabilityTransition(
  input: RecordObservabilityTransitionInput
): Promise<ObservabilityTransition> {
  const transition = await prisma.observabilityTransition.create({ data: input });

  await writeAuditLog({
    actorId: null,
    action: "OBSERVABILITY_TRANSITION_RECORDED",
    entityType: input.resourceType,
    entityId: input.resourceId,
    beforeSnapshot: { state: input.fromState },
    afterSnapshot: { state: input.toState, reason: input.reason },
  });

  return transition;
}

export function listObservabilityTransitionsForResource(
  resourceType: SyncResourceType,
  resourceId: string
): Promise<ObservabilityTransition[]> {
  return prisma.observabilityTransition.findMany({
    where: { resourceType, resourceId },
    orderBy: { detectedAt: "desc" },
  });
}
