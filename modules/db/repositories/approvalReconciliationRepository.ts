import { writeAuditLog } from "../../audit/writeAuditLog";
import { decideReconciliation, type ReconcileDecision } from "../../mmke/catalogue/approvalReconciliation";
import { prisma } from "../client";
import { endMetadataReviewIn, recordMetadataBaselineIn } from "./videoMetadataReviewRepository";
import type { Prisma } from "@prisma/client";

// Phase 6K fix (F3) — reconcile the recorded exposure approvals with the legacy approval flag. See modules/mmke/catalogue/approvalReconciliation.ts
// for the rules and docs/runbooks/exposure-approvals-rollout.md for when to run it.
//
// `planApprovalReconciliation` is READ ONLY. `applyApprovalReconciliation` re-derives each page's decision inside its own transaction under the
// page's row lock (so it can never act on a stale plan, and it is safe to run while editors are working), writes an audit entry per change, and is
// idempotent: a second run finds nothing to do. It never touches YouTube, never approves a video that was not approved before, and never creates
// an approval for a video under a hold. It is only ever invoked by an operator (scripts/reconcileExposureApprovals.ts) or by tests — never by
// application start-up, a Studio page, or a scheduler.

type Client = Prisma.TransactionClient | typeof prisma;

export interface PlannedPage {
  videoPageId: string;
  decision: Exclude<ReconcileDecision, { kind: "NONE" }>;
}

export interface ReconcilePlan {
  pagesInspected: number;
  actions: PlannedPage[];
  counts: { addLegacyApprovals: number; revokeOrphanedApprovals: number; clearStaleFlags: number; blockedByHold: number };
}

async function stateOf(client: Client, videoPageId: string) {
  const page = await client.youTubeVideoPage.findUnique({
    where: { id: videoPageId },
    include: { youtubeVideo: { select: { privacyStatus: true, observabilityState: true, exposureReview: { select: { holdReason: true } } } }, exposureApprovals: { where: { revokedAt: null }, select: { id: true, scope: true, playlistPageId: true } } },
  });
  if (!page) return null;
  return {
    page,
    state: {
      flag: page.unlistedPublicationApprovedAt !== null,
      activeScopes: page.exposureApprovals.map((a) => ({ scope: a.scope, playlistPageId: a.playlistPageId })),
      hold: (page.youtubeVideo.exposureReview?.holdReason ?? null) !== null,
      published: page.status === "PUBLISHED",
      lifecycle: { privacyStatus: page.youtubeVideo.privacyStatus, observabilityState: page.youtubeVideo.observabilityState, archived: page.archivedAt !== null },
    },
  };
}

/** Pages that could possibly need reconciling: those with the flag set or with any active approval. */
async function candidatePageIds(client: Client): Promise<string[]> {
  const rows = await client.youTubeVideoPage.findMany({
    where: { OR: [{ unlistedPublicationApprovedAt: { not: null } }, { exposureApprovals: { some: { revokedAt: null } } }] },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  return rows.map((r) => r.id);
}

export async function planApprovalReconciliation(client: Client = prisma): Promise<ReconcilePlan> {
  const ids = await candidatePageIds(client);
  const actions: PlannedPage[] = [];
  for (const id of ids) {
    const found = await stateOf(client, id);
    if (!found) continue;
    const decision = decideReconciliation(found.state);
    if (decision.kind !== "NONE") actions.push({ videoPageId: id, decision });
  }
  return {
    pagesInspected: ids.length,
    actions,
    counts: {
      addLegacyApprovals: actions.filter((a) => a.decision.kind === "ADD_LEGACY_APPROVALS").length,
      revokeOrphanedApprovals: actions.filter((a) => a.decision.kind === "REVOKE_ORPHANED_APPROVALS").length,
      clearStaleFlags: actions.filter((a) => a.decision.kind === "CLEAR_STALE_FLAG").length,
      blockedByHold: actions.filter((a) => a.decision.kind === "BLOCKED_BY_HOLD").length,
    },
  };
}

export interface ReconcileResult {
  plan: ReconcilePlan;
  applied: { addedLegacyApprovals: number; revokedApprovals: number; clearedStaleFlags: number; skippedByHold: number };
}

/** Applies reconciliation page by page. `actorId` is the operator (a Studio user) recorded in every audit entry. */
export async function applyApprovalReconciliation(input: { actorId: string; now?: Date }): Promise<ReconcileResult> {
  const plan = await planApprovalReconciliation();
  const applied = { addedLegacyApprovals: 0, revokedApprovals: 0, clearedStaleFlags: 0, skippedByHold: 0 };
  const now = input.now ?? new Date();

  for (const planned of plan.actions) {
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`select id from youtube_video_pages where id = ${planned.videoPageId} for update`;
      const found = await stateOf(tx, planned.videoPageId);
      if (!found) return;
      const decision = decideReconciliation(found.state); // re-derived under the lock: a stale plan can never be applied
      const { page } = found;

      if (decision.kind === "ADD_LEGACY_APPROVALS") {
        // No approver is recorded: the legacy flag stored none, and the page's last editor is not evidence of who approved.
        const note = "Carried over by reconciliation: an earlier version of the software recorded this approval with the legacy flag only, which stores no approver, so none is recorded here. Reconsider it in Studio (Unlisted videos > Carried-over approvals).";
        const created: string[] = [];
        const approvedAt = page.unlistedPublicationApprovedAt ?? now;
        const pageRow = await tx.videoExposureApproval.create({ data: { videoPageId: page.id, scope: "PAGE", approvedById: null, approvedAt, note, origin: "RECONCILED_LEGACY" } });
        created.push(pageRow.id);
        if (decision.addDiscovery) {
          const discoveryRow = await tx.videoExposureApproval.create({ data: { videoPageId: page.id, scope: "DISCOVERY", approvedById: null, approvedAt, note, origin: "RECONCILED_LEGACY" } });
          created.push(discoveryRow.id);
        }
        await recordMetadataBaselineIn(tx, page.id);
        await writeAuditLog({ actorId: input.actorId, action: "VIDEO_EXPOSURE_RECONCILED", entityType: "YouTubeVideoPage", entityId: page.id, afterSnapshot: { decision: "ADD_LEGACY_APPROVALS", approvals: created, listed: decision.addDiscovery } }, tx);
        applied.addedLegacyApprovals += created.length;
      } else if (decision.kind === "CLEAR_STALE_FLAG") {
        await tx.youTubeVideoPage.update({ where: { id: page.id }, data: { unlistedPublicationApprovedAt: null } });
        await writeAuditLog({ actorId: input.actorId, action: "VIDEO_EXPOSURE_RECONCILED", entityType: "YouTubeVideoPage", entityId: page.id, afterSnapshot: { decision: "CLEAR_STALE_FLAG", reason: "The page is archived or the video is private or unavailable, so it cannot hold an approval." } }, tx);
        applied.clearedStaleFlags += 1;
      } else if (decision.kind === "REVOKE_ORPHANED_APPROVALS") {
        const moved = await tx.videoExposureApproval.updateMany({
          where: { videoPageId: page.id, revokedAt: null },
          data: { revokedAt: now, revokedById: input.actorId, revokedReason: "RECONCILED", revokeNote: "Reconciled: the legacy approval flag had been cleared (the approval was revoked by an earlier version of the software)." },
        });
        await endMetadataReviewIn(tx, page.id, "The approval ended (reconciled) before this change was reviewed.");
        await writeAuditLog({ actorId: input.actorId, action: "VIDEO_EXPOSURE_RECONCILED", entityType: "YouTubeVideoPage", entityId: page.id, afterSnapshot: { decision: "REVOKE_ORPHANED_APPROVALS", revoked: moved.count } }, tx);
        applied.revokedApprovals += moved.count;
      } else if (decision.kind === "BLOCKED_BY_HOLD") {
        await writeAuditLog({ actorId: input.actorId, action: "VIDEO_EXPOSURE_RECONCILE_SKIPPED", entityType: "YouTubeVideoPage", entityId: page.id, afterSnapshot: { reason: "A rights, copyright or privacy hold is in place; no approval was created." } }, tx);
        applied.skippedByHold += 1;
      }
    });
  }
  return { plan, applied };
}
