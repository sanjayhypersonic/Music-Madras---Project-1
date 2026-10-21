import { createHash } from "crypto";
import { writeAuditLog } from "../../audit/writeAuditLog";
import { prisma } from "../client";
import { raiseNotification, resolveNotification } from "./studioNotificationRepository";
import type { VideoExposureOrigin } from "@prisma/client";

// Phase 6K fix (F2) — the review path for approvals that were CARRIED OVER from the old single approval flag (by the migration, or by the
// reconciliation procedure) instead of being decided in Studio. They keep a video's earlier exposure so nothing was silently delisted; this is where
// an editor reconsiders them at their own pace:
//   - keep   (confirm): records who looked and decided to keep the approval; the item leaves this list. The approval's origin stays visible in history.
//   - stop listing / withdraw: the ordinary revocations (revokeExposure) — one scope at a time, or the page and everything with it.
// Nothing here approves anything, and nothing changes while an item waits: the carried-over approval stands until someone decides.

export const CARRIED_OVER_NOTIFICATION_KEY = "carried-over-approvals";
export const CARRIED_OVER_HREF = "/studio/catalogue/unlisted-review";

export interface CarriedOverItem {
  videoPageId: string;
  videoId: string;
  title: string | null;
  slug: string;
  privacyStatus: string | null;
  /** `approvedByName` is null for a carried-over approval: the legacy flag recorded no approver, and none is invented. */
  approvals: Array<{ id: string; scope: "PAGE" | "DISCOVERY" | "PLAYLIST"; origin: VideoExposureOrigin; approvedAt: Date; approvedByName: string | null }>;
}

/** Pages with an ACTIVE carried-over approval nobody has reconsidered yet. */
export async function listCarriedOverApprovals(): Promise<CarriedOverItem[]> {
  const rows = await prisma.videoExposureApproval.findMany({
    where: { revokedAt: null, confirmedAt: null, origin: { in: ["MIGRATED_LEGACY", "RECONCILED_LEGACY"] } },
    orderBy: [{ approvedAt: "asc" }, { id: "asc" }],
    include: { approvedBy: { select: { name: true } }, videoPage: { select: { id: true, slug: true, youtubeVideo: { select: { id: true, title: true, privacyStatus: true } } } } },
  });
  const byPage = new Map<string, CarriedOverItem>();
  for (const row of rows) {
    const item = byPage.get(row.videoPageId) ?? {
      videoPageId: row.videoPageId,
      videoId: row.videoPage.youtubeVideo.id,
      title: row.videoPage.youtubeVideo.title,
      slug: row.videoPage.slug,
      privacyStatus: row.videoPage.youtubeVideo.privacyStatus,
      approvals: [],
    };
    item.approvals.push({ id: row.id, scope: row.scope, origin: row.origin, approvedAt: row.approvedAt, approvedByName: row.approvedBy?.name ?? null });
    byPage.set(row.videoPageId, item);
  }
  return [...byPage.values()];
}

/** Records that an editor reconsidered this page's carried-over approvals and chose to KEEP them. Returns how many were confirmed. */
export async function confirmCarriedOverApprovals(input: { videoPageId: string; actorId: string }): Promise<{ confirmed: number }> {
  return prisma.$transaction(async (tx) => {
    const moved = await tx.videoExposureApproval.updateMany({
      where: { videoPageId: input.videoPageId, revokedAt: null, confirmedAt: null, origin: { in: ["MIGRATED_LEGACY", "RECONCILED_LEGACY"] } },
      data: { confirmedAt: new Date(), confirmedById: input.actorId },
    });
    if (moved.count > 0) {
      await writeAuditLog({ actorId: input.actorId, action: "VIDEO_EXPOSURE_CARRIED_OVER_CONFIRMED", entityType: "YouTubeVideoPage", entityId: input.videoPageId, afterSnapshot: { confirmed: moved.count } }, tx);
    }
    return { confirmed: moved.count };
  });
}

/**
 * Keeps ONE standing, quiet notification while carried-over approvals await reconsideration: it is raised when the set changes, never repeated
 * while it is unchanged, and resolved when the last one is kept or withdrawn. It asks for nothing urgent: the approvals stand until decided.
 */
export async function syncCarriedOverNotification(): Promise<"RAISED" | "UNCHANGED" | "RESOLVED" | "NONE"> {
  const items = await listCarriedOverApprovals();
  if (items.length === 0) return (await resolveNotification(CARRIED_OVER_NOTIFICATION_KEY, "No carried-over approval is waiting to be reconsidered.")) ? "RESOLVED" : "NONE";
  const fingerprint = createHash("sha256").update(JSON.stringify(items.map((i) => [i.videoPageId, i.approvals.map((a) => a.id).sort()]).sort())).digest("hex").slice(0, 32);
  const raised = await raiseNotification({
    kind: "CARRIED_OVER_APPROVALS",
    dedupeKey: CARRIED_OVER_NOTIFICATION_KEY,
    title: `${items.length} unlisted video${items.length === 1 ? "" : "s"} kept their earlier public approval`,
    body: `${items.length === 1 ? "This video was" : "These videos were"} approved under the old single approval, and that approval was carried over so nothing disappeared from the site. Decide whether to keep each one, stop listing it, or withdraw it. Nothing changes until you do.\n\n${items
      .slice(0, 5)
      .map((i) => `- ${(i.title ?? "(untitled video)").slice(0, 80)}`)
      .join("\n")}${items.length > 5 ? `\n…and ${items.length - 5} more.` : ""}`,
    href: CARRIED_OVER_HREF,
    contentFingerprint: fingerprint,
  });
  return raised.outcome === "UNCHANGED" ? "UNCHANGED" : "RAISED";
}
