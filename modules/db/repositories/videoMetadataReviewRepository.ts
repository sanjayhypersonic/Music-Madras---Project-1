import { createHash } from "crypto";
import { writeAuditLog } from "../../audit/writeAuditLog";
import { diffMaterial, fingerprintMaterial, isComparableSnapshot, materialMetadata, type MaterialMetadata, type VideoMetadataFacts } from "../../mmke/catalogue/metadataFingerprint";
import { prisma } from "../client";
import { raiseNotification, resolveNotification } from "./studioNotificationRepository";
import { Prisma, type VideoMetadataChange } from "@prisma/client";

// Phase 6K lifecycle hardening (F12) — metadata re-review for APPROVED pages.
//
//   - An approved page stays public while its YouTube-side metadata changes. Nothing here revokes or hides anything.
//   - What an editor last reviewed is stored on the page (`metadataReviewedSnapshot`, set when a page approval is created or a change is
//     acknowledged). When the video's material metadata (modules/mmke/catalogue/metadataFingerprint.ts) differs from it, ONE pending change is recorded
//     for the page, with what changed. Further changes while it is pending update that record; a change back to what was reviewed resolves it
//     (REVERTED). Repeating an observation changes nothing, so repeated syncs never multiply reviews.
//   - Only an editor's explicit acknowledgement marks changed metadata as reviewed (the audit entry names who).
//   - When the approval ends (revoked, or lifecycle invalidation) a pending change is VOIDED: the review no longer applies, and the baseline is
//     dropped so a fresh approval records a fresh one. Private/archive rules always win over a pending review.
//   - An already approved page with no baseline yet (it was approved before this existed) gets its baseline recorded the first time it is observed:
//     that is stated in the audit log as a baseline, never presented as a reviewed change.
// Authorization is decided by the calling Server Action (RECORDING_PUBLISH). Nothing here talks to YouTube.

type Tx = Prisma.TransactionClient;

export const METADATA_REVIEW_NOTIFICATION_KEY = "metadata-review-pending";
export const METADATA_REVIEW_HREF = "/studio/catalogue/unlisted-review";

const videoFactsSelect = { title: true, description: true, thumbnailUrl: true, durationSeconds: true, publishedAt: true, embeddable: true, channelId: true } as const;

const lockPage = (tx: Tx, id: string) => tx.$queryRaw`select id from youtube_video_pages where id = ${id} for update`;

const jsonOf = (value: unknown) => value as Prisma.InputJsonValue;

/** Sets the reviewed baseline to the video's CURRENT material metadata. Called when a page approval is created. Runs in the caller's transaction. */
export async function recordMetadataBaselineIn(tx: Tx, videoPageId: string): Promise<void> {
  const page = await tx.youTubeVideoPage.findUnique({ where: { id: videoPageId }, select: { youtubeVideo: { select: videoFactsSelect } } });
  if (!page) return;
  await tx.youTubeVideoPage.update({ where: { id: videoPageId }, data: { metadataReviewedSnapshot: jsonOf(materialMetadata(page.youtubeVideo)), metadataReviewedAt: new Date() } });
  await tx.videoMetadataChange.updateMany({ where: { videoPageId, status: "PENDING" }, data: { status: "VOIDED", resolvedAt: new Date(), resolutionNote: "Superseded by a fresh approval." } });
}

/** The approval ended: any pending review no longer applies, and the baseline goes with it. Runs in the caller's transaction. */
export async function endMetadataReviewIn(tx: Tx, videoPageId: string, note: string): Promise<void> {
  await tx.videoMetadataChange.updateMany({ where: { videoPageId, status: "PENDING" }, data: { status: "VOIDED", resolvedAt: new Date(), resolutionNote: note.slice(0, 500) } });
  await tx.youTubeVideoPage.updateMany({ where: { id: videoPageId }, data: { metadataReviewedSnapshot: Prisma.DbNull, metadataReviewedAt: null } });
}

export type ObserveOutcome = "NO_PAGE" | "NOT_TRACKED" | "BASELINE_RECORDED" | "UNCHANGED" | "DETECTED" | "UPDATED" | "STILL_PENDING" | "REVERTED";

/**
 * Compares an approved page's current material metadata with what was reviewed and records the result. Idempotent and safe under concurrency (the page
 * row is locked). Runs in the caller's transaction so a sync write and its detection commit together.
 */
export async function observeMetadataIn(tx: Tx, videoPageId: string, now: Date = new Date()): Promise<ObserveOutcome> {
  await lockPage(tx, videoPageId);
  const page = await tx.youTubeVideoPage.findUnique({
    where: { id: videoPageId },
    select: { id: true, metadataReviewedSnapshot: true, youtubeVideo: { select: videoFactsSelect }, exposureApprovals: { where: { scope: "PAGE", revokedAt: null }, select: { id: true }, take: 1 } },
  });
  if (!page) return "NO_PAGE";
  const pending = await tx.videoMetadataChange.findFirst({ where: { videoPageId, status: "PENDING" } });

  if (page.exposureApprovals.length === 0) {
    if (pending) await endMetadataReviewIn(tx, videoPageId, "The approval ended before this change was reviewed.");
    return "NOT_TRACKED";
  }

  const current = materialMetadata(page.youtubeVideo as VideoMetadataFacts);
  const baseline = page.metadataReviewedSnapshot;
  if (!isComparableSnapshot(baseline)) {
    await tx.youTubeVideoPage.update({ where: { id: videoPageId }, data: { metadataReviewedSnapshot: jsonOf(current), metadataReviewedAt: now } });
    if (pending) await tx.videoMetadataChange.update({ where: { id: pending.id }, data: { status: "VOIDED", resolvedAt: now, resolutionNote: "The comparison rules changed, so the baseline was recorded again." } });
    await writeAuditLog({ actorId: null, action: "VIDEO_METADATA_BASELINE_RECORDED", entityType: "YouTubeVideoPage", entityId: videoPageId, afterSnapshot: { fingerprint: fingerprintMaterial(current), note: "First observation of an approved page: this is the starting point for later comparison, not a reviewed change." } }, tx);
    return "BASELINE_RECORDED";
  }

  const changes = diffMaterial(baseline as MaterialMetadata, current);
  if (changes.length === 0) {
    if (!pending) return "UNCHANGED";
    await tx.videoMetadataChange.update({ where: { id: pending.id }, data: { status: "REVERTED", resolvedAt: now, resolutionNote: "The metadata went back to what was reviewed." } });
    await writeAuditLog({ actorId: null, action: "VIDEO_METADATA_CHANGE_REVERTED", entityType: "YouTubeVideoPage", entityId: videoPageId, afterSnapshot: { changeId: pending.id } }, tx);
    return "REVERTED";
  }

  const observedFingerprint = fingerprintMaterial(current);
  const changedFields = changes.map((c) => c.field);
  const summary = jsonOf(changes);
  if (pending) {
    if (pending.observedFingerprint === observedFingerprint) return "STILL_PENDING";
    await tx.videoMetadataChange.update({ where: { id: pending.id }, data: { observedFingerprint, changedFields, changeSummary: summary, lastObservedAt: now } });
    await writeAuditLog({ actorId: null, action: "VIDEO_METADATA_CHANGE_UPDATED", entityType: "YouTubeVideoPage", entityId: videoPageId, afterSnapshot: { changeId: pending.id, changedFields } }, tx);
    return "UPDATED";
  }
  const created = await tx.videoMetadataChange.create({
    data: { videoPageId, baselineFingerprint: fingerprintMaterial(baseline as MaterialMetadata), observedFingerprint, changedFields, changeSummary: summary, detectedAt: now, lastObservedAt: now },
  });
  await writeAuditLog({ actorId: null, action: "VIDEO_METADATA_CHANGE_DETECTED", entityType: "YouTubeVideoPage", entityId: videoPageId, afterSnapshot: { changeId: created.id, changedFields, note: "The page stays public; the change awaits editorial review." } }, tx);
  return "DETECTED";
}

export class MetadataReviewError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MetadataReviewError";
  }
}

/** An editor has looked at the changed metadata and accepts it: the current metadata becomes the reviewed baseline. */
export async function acknowledgeMetadataChange(input: { videoPageId: string; actorId: string; note?: string | null }): Promise<{ acknowledged: boolean }> {
  const note = input.note?.trim() ? input.note.trim().slice(0, 1000) : null;
  return prisma.$transaction(async (tx) => {
    await lockPage(tx, input.videoPageId);
    const page = await tx.youTubeVideoPage.findUnique({ where: { id: input.videoPageId }, select: { youtubeVideo: { select: videoFactsSelect }, exposureApprovals: { where: { scope: "PAGE", revokedAt: null }, select: { id: true }, take: 1 } } });
    if (!page) throw new MetadataReviewError("That video page does not exist.");
    if (page.exposureApprovals.length === 0) throw new MetadataReviewError("This page has no active approval, so there is no metadata review to confirm. Approve the page first.");
    const pending = await tx.videoMetadataChange.findFirst({ where: { videoPageId: input.videoPageId, status: "PENDING" } });
    if (!pending) return { acknowledged: false };
    const current = materialMetadata(page.youtubeVideo);
    const now = new Date();
    await tx.youTubeVideoPage.update({ where: { id: input.videoPageId }, data: { metadataReviewedSnapshot: jsonOf(current), metadataReviewedAt: now } });
    await tx.videoMetadataChange.update({ where: { id: pending.id }, data: { status: "ACKNOWLEDGED", resolvedAt: now, resolvedById: input.actorId, resolutionNote: note, observedFingerprint: fingerprintMaterial(current) } });
    await writeAuditLog({ actorId: input.actorId, action: "VIDEO_METADATA_CHANGE_ACKNOWLEDGED", entityType: "YouTubeVideoPage", entityId: input.videoPageId, afterSnapshot: { changeId: pending.id, changedFields: pending.changedFields, note } }, tx);
    return { acknowledged: true };
  });
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------------------------------------------------------------

export interface MetadataChangeView {
  change: VideoMetadataChange;
  resolvedByName: string | null;
}

/** The page's pending change (if any) and its recent history, newest first. */
export async function loadMetadataReviewState(videoPageId: string, historyLimit = 10): Promise<{ pending: VideoMetadataChange | null; history: MetadataChangeView[] }> {
  const rows = await prisma.videoMetadataChange.findMany({ where: { videoPageId }, orderBy: { detectedAt: "desc" }, take: historyLimit, include: { resolvedBy: { select: { name: true } } } });
  const pending = rows.find((r) => r.status === "PENDING") ?? null;
  return { pending, history: rows.map(({ resolvedBy, ...change }) => ({ change, resolvedByName: resolvedBy?.name ?? null })) };
}

export interface PendingMetadataReviewItem {
  videoPageId: string;
  videoId: string;
  title: string | null;
  changedFields: string[];
  detectedAt: Date;
}

export async function listPendingMetadataReviews(limit = 200): Promise<PendingMetadataReviewItem[]> {
  const rows = await prisma.videoMetadataChange.findMany({
    where: { status: "PENDING", videoPage: { exposureApprovals: { some: { scope: "PAGE", revokedAt: null } } } },
    orderBy: [{ detectedAt: "asc" }, { id: "asc" }],
    take: limit,
    include: { videoPage: { select: { id: true, youtubeVideo: { select: { id: true, title: true } } } } },
  });
  return rows.map((r) => ({ videoPageId: r.videoPageId, videoId: r.videoPage.youtubeVideo.id, title: r.videoPage.youtubeVideo.title, changedFields: r.changedFields, detectedAt: r.detectedAt }));
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The catch-up sweep (also establishes baselines for pages approved before this existed)
// ---------------------------------------------------------------------------------------------------------------------------------

/** A technical bound: pages examined per batch. Each page is its own short transaction, so no batch can run into the transaction time limit. */
export const METADATA_SWEEP_BATCH = 50;

export interface MetadataSweepResult {
  examined: number;
  baselinesRecorded: number;
  detected: number;
  updated: number;
  reverted: number;
  failed: number;
  batches: number;
  completed: boolean;
  /** Where the sweep stopped when it did not complete (the last page id handled), for the run record. */
  lastCursor: string | null;
}

export async function runMetadataReviewSweep(options: { now?: Date; batchSize?: number; deadline?: Date } = {}): Promise<MetadataSweepResult> {
  const now = options.now ?? new Date();
  const batchSize = options.batchSize ?? METADATA_SWEEP_BATCH;
  const result: MetadataSweepResult = { examined: 0, baselinesRecorded: 0, detected: 0, updated: 0, reverted: 0, failed: 0, batches: 0, completed: true, lastCursor: null };
  let cursor: string | undefined;
  for (;;) {
    if (options.deadline && Date.now() > options.deadline.getTime()) {
      result.completed = false;
      break;
    }
    // Pages that hold an approval, and pages that still carry a pending change whose approval has ended (so it can be voided), by stable id order.
    // Keyset pagination (id greater than the last one handled): a page that leaves the set while it is processed (its pending review voided, say) never makes the next one skipped.
    const ids = await prisma.youTubeVideoPage.findMany({
      where: { AND: [{ OR: [{ exposureApprovals: { some: { scope: "PAGE", revokedAt: null } } }, { metadataChanges: { some: { status: "PENDING" } } }] }, ...(cursor ? [{ id: { gt: cursor } }] : [])] },
      select: { id: true },
      orderBy: { id: "asc" },
      take: batchSize,
    });
    if (ids.length === 0) break;
    result.batches += 1;
    for (const { id } of ids) {
      cursor = id;
      result.lastCursor = id;
      try {
        const outcome = await prisma.$transaction((tx) => observeMetadataIn(tx, id, now), { timeout: 15_000 });
        result.examined += 1;
        if (outcome === "BASELINE_RECORDED") result.baselinesRecorded += 1;
        else if (outcome === "DETECTED") result.detected += 1;
        else if (outcome === "UPDATED") result.updated += 1;
        else if (outcome === "REVERTED") result.reverted += 1;
      } catch (err) {
        result.failed += 1;
        console.error("Metadata review check failed for one page:", err instanceof Error ? err.name : "unknown error");
      }
    }
    if (ids.length < batchSize) break;
  }
  if (result.completed) result.lastCursor = null;
  return result;
}

/**
 * Keeps ONE standing notification while approved pages await a metadata review: raised when the set changes, not repeated while unchanged, resolved
 * when the last is confirmed. The pages stay public meanwhile; this asks for a look, not for urgency.
 */
export async function syncMetadataReviewNotification(): Promise<"RAISED" | "UNCHANGED" | "RESOLVED" | "NONE"> {
  const items = await listPendingMetadataReviews(1000);
  if (items.length === 0) return (await resolveNotification(METADATA_REVIEW_NOTIFICATION_KEY, "No approved video has metadata changes awaiting review.")) ? "RESOLVED" : "NONE";
  const fingerprint = createHash("sha256").update(JSON.stringify(items.map((i) => [i.videoPageId, i.changedFields]).sort())).digest("hex").slice(0, 32);
  const raised = await raiseNotification({
    kind: "METADATA_REVIEW_PENDING",
    dedupeKey: METADATA_REVIEW_NOTIFICATION_KEY,
    title: `${items.length} approved video${items.length === 1 ? " has" : "s have"} metadata changes awaiting review`,
    body: `${items.length === 1 ? "This video's" : "These videos'"} title, description, thumbnail or other page-defining details changed on YouTube after they were reviewed. The pages stay public; look at each change and confirm it.\n\n${items
      .slice(0, 5)
      .map((i) => `- ${(i.title ?? "(untitled video)").slice(0, 80)} (${i.changedFields.join(", ")})`)
      .join("\n")}${items.length > 5 ? `\n…and ${items.length - 5} more.` : ""}`,
    href: METADATA_REVIEW_HREF,
    contentFingerprint: fingerprint,
  });
  return raised.outcome === "UNCHANGED" ? "UNCHANGED" : "RAISED";
}
