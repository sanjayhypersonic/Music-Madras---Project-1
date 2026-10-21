import { deriveApprovalLifecycleStatus, lifecycleInvalidation, type ApprovalLifecycleStatus, type LifecycleInvalidation } from "../../mmke/catalogue/videoLifecycle";
import { prisma } from "../client";
import { observeMetadataIn, type ObserveOutcome } from "./videoMetadataReviewRepository";
import { revokeExposureIn } from "./videoExposureRepository";
import type { ObservabilityState, Prisma, VideoExposureRevokeReason } from "@prisma/client";

// Phase 6K lifecycle hardening (F11) — enforcement of the approval lifecycle policy (modules/mmke/catalogue/videoLifecycle.ts says what the policy is).
//
//   applyLifecycleAfterVideoChangeIn   the STATE-TRANSITION BOUNDARY. Called inside the same transaction as every write to a video's privacy or
//                                       observability (youtubeVideoRepository.ts), so a private video never keeps an approval for even one moment
//                                       after the change commits. It also notices material metadata changes (F12).
//   revokeForArchiveIn                 the same, for archiving a page (youtubeVideoPageRepository.ts).
//   runLifecycleInvariantSweep         a repeatable check that finds any active approval on an archived page or a private video (written
//                                       by something that bypassed the boundary) and repairs it, so such an approval can never be resurrected by a later
//                                       return to unlisted or a restore.
//   loadApprovalLifecycleStatus        what Studio shows.
// Uncertainty is not a transition: NOT_OBSERVED and SYNC_ERROR never revoke anything, and neither do UNAVAILABLE or DELETED (see videoLifecycle.ts).

type Tx = Prisma.TransactionClient;

const lockPage = (tx: Tx, id: string) => tx.$queryRaw`select id from youtube_video_pages where id = ${id} for update`;

const NOTE: Record<LifecycleInvalidation, string> = {
  VIDEO_PRIVATE: "The video became private on YouTube, so its public-exposure approvals ended. If it becomes unlisted again it needs a fresh approval.",
  PAGE_ARCHIVED: "The page was archived, so its public-exposure approvals ended. Restoring the page does not bring them back: approve it again afterwards.",
};

export interface LifecycleEffects {
  revoked: number;
  reason: LifecycleInvalidation | null;
  metadata: ObserveOutcome | null;
}

/**
 * Re-evaluates the lifecycle of the page behind a video after the video row changed, in the caller's transaction. Idempotent: running it again on an
 * unchanged video does nothing. A video with no page has nothing to revoke.
 */
export async function applyLifecycleAfterVideoChangeIn(tx: Tx, youtubeVideoId: string): Promise<LifecycleEffects> {
  const page = await tx.youTubeVideoPage.findUnique({
    where: { youtubeVideoId },
    select: {
      id: true,
      archivedAt: true,
      unlistedPublicationApprovedAt: true,
      youtubeVideo: { select: { privacyStatus: true, observabilityState: true } },
      _count: { select: { exposureApprovals: { where: { revokedAt: null } }, metadataChanges: { where: { status: "PENDING" } } } },
    },
  });
  if (!page) return { revoked: 0, reason: null, metadata: null };
  const hasApproval = page._count.exposureApprovals > 0 || page.unlistedPublicationApprovedAt !== null;
  const reason = lifecycleInvalidation({ privacyStatus: page.youtubeVideo.privacyStatus, observabilityState: page.youtubeVideo.observabilityState, archived: page.archivedAt !== null });
  if (reason) {
    if (!hasApproval && page._count.metadataChanges === 0) return { revoked: 0, reason, metadata: null };
    const { revoked } = await revokeExposureIn(tx, { videoPageId: page.id, scope: "PAGE", actorId: null, reason, note: NOTE[reason] });
    return { revoked, reason, metadata: null };
  }
  if (!hasApproval && page._count.metadataChanges === 0) return { revoked: 0, reason: null, metadata: null };
  return { revoked: 0, reason: null, metadata: await observeMetadataIn(tx, page.id) };
}

/** Archiving a page ends its approvals (a lifecycle invalidation); called inside the archive transaction. Returns how many approvals ended. */
export async function revokeForArchiveIn(tx: Tx, videoPageId: string, actorId: string): Promise<number> {
  const { revoked } = await revokeExposureIn(tx, { videoPageId, scope: "PAGE", actorId, reason: "PAGE_ARCHIVED", note: NOTE.PAGE_ARCHIVED });
  return revoked;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The invariant sweep
// ---------------------------------------------------------------------------------------------------------------------------------

/** Pages that hold an approval (or the legacy flag) although they are archived or their video is private. (Unavailable/deleted videos are NOT violations.) */
const VIOLATION_WHERE: Prisma.YouTubeVideoPageWhereInput = {
  AND: [
    { OR: [{ exposureApprovals: { some: { revokedAt: null } } }, { unlistedPublicationApprovedAt: { not: null } }] },
    { OR: [{ archivedAt: { not: null } }, { youtubeVideo: { privacyStatus: "private" } }, { youtubeVideo: { observabilityState: "PRIVATE" } }] },
  ],
};

export function findLifecycleViolations(limit = 500): Promise<Array<{ id: string }>> {
  return prisma.youTubeVideoPage.findMany({ where: VIOLATION_WHERE, select: { id: true }, orderBy: { id: "asc" }, take: limit });
}

/** A technical bound: pages repaired per batch (each page is its own short transaction). */
export const LIFECYCLE_SWEEP_BATCH = 50;

export interface LifecycleSweepResult {
  examined: number;
  revoked: number;
  failed: number;
  batches: number;
  completed: boolean;
}

export async function runLifecycleInvariantSweep(options: { batchSize?: number; deadline?: Date } = {}): Promise<LifecycleSweepResult> {
  const batchSize = options.batchSize ?? LIFECYCLE_SWEEP_BATCH;
  const result: LifecycleSweepResult = { examined: 0, revoked: 0, failed: 0, batches: 0, completed: true };
  let cursor: string | undefined;
  for (;;) {
    if (options.deadline && Date.now() > options.deadline.getTime()) {
      result.completed = false;
      break;
    }
    // Keyset pagination (id greater than the last one handled), not a cursor with an offset: pages repaired in a batch leave the filter, and an offset from a row that no longer matches would skip the next one.
    const ids = await prisma.youTubeVideoPage.findMany({ where: cursor ? { AND: [VIOLATION_WHERE, { id: { gt: cursor } }] } : VIOLATION_WHERE, select: { id: true }, orderBy: { id: "asc" }, take: batchSize });
    if (ids.length === 0) break;
    result.batches += 1;
    for (const { id } of ids) {
      cursor = id;
      try {
        const revoked = await prisma.$transaction(async (tx) => {
          await lockPage(tx, id);
          // Re-derived under the lock: a page repaired (or restored) meanwhile is left alone.
          const page = await tx.youTubeVideoPage.findUnique({ where: { id }, select: { archivedAt: true, youtubeVideo: { select: { privacyStatus: true, observabilityState: true } } } });
          if (!page) return 0;
          const reason = lifecycleInvalidation({ privacyStatus: page.youtubeVideo.privacyStatus, observabilityState: page.youtubeVideo.observabilityState, archived: page.archivedAt !== null });
          if (!reason) return 0;
          return (await revokeExposureIn(tx, { videoPageId: id, scope: "PAGE", actorId: null, reason, note: NOTE[reason] })).revoked;
        }, { timeout: 15_000 });
        result.examined += 1;
        result.revoked += revoked;
      } catch (err) {
        result.failed += 1;
        console.error("Lifecycle invariant repair failed for one page:", err instanceof Error ? err.name : "unknown error");
      }
    }
    if (ids.length < batchSize) break;
  }
  return result;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// What Studio shows
// ---------------------------------------------------------------------------------------------------------------------------------

export interface ApprovalLifecycleView {
  status: ApprovalLifecycleStatus;
  /** When the metadata review became pending, and which fields changed (only when the status says so). */
  pendingSince: Date | null;
  changedFields: string[];
  /** When and why the last page approval ended (for the lifecycle statuses). */
  lastRevokedAt: Date | null;
}

/** The same status for many pages in three queries (the review queue shows one per video). Pages are given with their video's current situation. */
export async function loadApprovalLifecycleStatuses(
  pages: ReadonlyArray<{ videoPageId: string; privacyStatus: string | null; observabilityState: ObservabilityState; archived: boolean }>,
  client: Tx | typeof prisma = prisma
): Promise<Map<string, ApprovalLifecycleView>> {
  const out = new Map<string, ApprovalLifecycleView>();
  if (pages.length === 0) return out;
  const ids = pages.map((p) => p.videoPageId);
  const [active, pending, revoked] = await Promise.all([
    client.videoExposureApproval.findMany({ where: { videoPageId: { in: ids }, scope: "PAGE", revokedAt: null }, select: { videoPageId: true } }),
    client.videoMetadataChange.findMany({ where: { videoPageId: { in: ids }, status: "PENDING" }, select: { videoPageId: true, detectedAt: true, changedFields: true } }),
    client.videoExposureApproval.findMany({ where: { videoPageId: { in: ids }, scope: "PAGE", revokedAt: { not: null } }, orderBy: [{ revokedAt: "desc" }, { id: "asc" }], select: { videoPageId: true, revokedReason: true, revokedAt: true } }),
  ]);
  const activeSet = new Set(active.map((a) => a.videoPageId));
  const pendingBy = new Map(pending.map((p) => [p.videoPageId, p]));
  const lastRevoked = new Map<string, { revokedReason: VideoExposureRevokeReason | null; revokedAt: Date | null }>();
  for (const row of revoked) if (!lastRevoked.has(row.videoPageId)) lastRevoked.set(row.videoPageId, row); // ordered newest first
  for (const p of pages) {
    const pend = pendingBy.get(p.videoPageId);
    const last = lastRevoked.get(p.videoPageId);
    out.set(p.videoPageId, {
      status: deriveApprovalLifecycleStatus({
        activePageApproval: activeSet.has(p.videoPageId),
        metadataReviewPending: pend !== undefined,
        lastPageRevokedReason: last?.revokedReason ?? null,
        state: { privacyStatus: p.privacyStatus, observabilityState: p.observabilityState, archived: p.archived },
      }),
      pendingSince: pend?.detectedAt ?? null,
      changedFields: pend?.changedFields ?? [],
      lastRevokedAt: last?.revokedAt ?? null,
    });
  }
  return out;
}

export async function loadApprovalLifecycleStatus(videoPageId: string, client: Tx | typeof prisma = prisma): Promise<ApprovalLifecycleView | null> {
  const page = await client.youTubeVideoPage.findUnique({
    where: { id: videoPageId },
    select: { archivedAt: true, youtubeVideo: { select: { privacyStatus: true, observabilityState: true } } },
  });
  if (!page) return null;
  const [active, pending, lastRevoked] = await Promise.all([
    client.videoExposureApproval.findFirst({ where: { videoPageId, scope: "PAGE", revokedAt: null }, select: { id: true } }),
    client.videoMetadataChange.findFirst({ where: { videoPageId, status: "PENDING" }, select: { detectedAt: true, changedFields: true } }),
    client.videoExposureApproval.findFirst({ where: { videoPageId, scope: "PAGE", revokedAt: { not: null } }, orderBy: [{ revokedAt: "desc" }, { id: "asc" }], select: { revokedReason: true, revokedAt: true } }),
  ]);
  const status = deriveApprovalLifecycleStatus({
    activePageApproval: active !== null,
    metadataReviewPending: pending !== null,
    lastPageRevokedReason: lastRevoked?.revokedReason ?? null,
    state: { privacyStatus: page.youtubeVideo.privacyStatus, observabilityState: page.youtubeVideo.observabilityState, archived: page.archivedAt !== null },
  });
  return { status, pendingSince: pending?.detectedAt ?? null, changedFields: pending?.changedFields ?? [], lastRevokedAt: lastRevoked?.revokedAt ?? null };
}
