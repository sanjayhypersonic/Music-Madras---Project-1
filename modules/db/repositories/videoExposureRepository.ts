import { writeAuditLog } from "../../audit/writeAuditLog";
import type { ActiveApproval, ExposureScopeName } from "../../mmke/catalogue/videoExposure";
import {
  ApprovalBlockedByHoldError,
  ApprovalInvalidError,
  ApprovalNotApplicableError,
  ApprovalPageArchivedError,
  ApprovalPrerequisiteError,
  ExposurePageNotFoundError,
  VideoNotAvailableError,
} from "../../mmke/catalogue/videoExposureErrors";
import { prisma } from "../client";
import { endMetadataReviewIn, recordMetadataBaselineIn } from "./videoMetadataReviewRepository";
import type { Prisma, VideoExposureApproval, VideoExposureRevokeReason } from "@prisma/client";

// Phase 6K-2 — recorded, scoped, revocable approvals to expose an UNLISTED video's Music Madras page (see modules/mmke/catalogue/videoExposure.ts
// for the surfaces and the rules). Rules enforced here, all inside one transaction that first locks the page row (so approvals for a page are
// serialized and "at most one active approval per scope" holds without a partial index):
//   - only an UNLISTED, currently OBSERVED video can be approved (public needs none; private never can);
//   - a recorded hold (rights, copyright, ...) on the video blocks approval;
//   - DISCOVERY and PLAYLIST need an active PAGE approval first; PLAYLIST names its playlist page, the others must not;
//   - an ARCHIVED page cannot be approved (archiving revokes approvals and restoring never brings them back: approve after restoring);
//   - a PAGE approval records the metadata baseline an editor is approving; ending one voids any pending metadata review (F12);
//   - every approval/revocation is audited with the approver and, for a revocation, its reason; revoking the PAGE approval revokes every other scope with it;
//   - the legacy flag youtube_video_pages.unlistedPublicationApprovedAt is kept in step as the cache of "an active PAGE approval exists"
//     (the public queries still read it); findApprovalFlagInconsistencies proves they agree.
// Nothing here writes to YouTube or changes YouTube privacy. Authorization is decided by the calling Server Action (RECORDING_PUBLISH).

type Client = Prisma.TransactionClient | typeof prisma;

export interface ApproveExposureInput {
  videoPageId: string;
  scope: ExposureScopeName;
  playlistPageId?: string | null;
  actorId: string;
  note?: string | null;
}

async function lockPage(tx: Prisma.TransactionClient, videoPageId: string): Promise<void> {
  await tx.$queryRaw`select id from youtube_video_pages where id = ${videoPageId} for update`;
}

function checkScopeShape(scope: ExposureScopeName, playlistPageId: string | null): void {
  if (scope === "PLAYLIST" && !playlistPageId) throw new ApprovalInvalidError("A playlist approval must name the playlist page.");
  if (scope !== "PLAYLIST" && playlistPageId) throw new ApprovalInvalidError("Only a playlist approval names a playlist page.");
}

const sameTarget = (scope: ExposureScopeName, playlistPageId: string | null) => ({
  scope,
  playlistPageId: scope === "PLAYLIST" ? playlistPageId : null,
  revokedAt: null,
});

/** Runs inside the caller's transaction (the review decision composes it with its own writes so both commit or neither does). */
export async function approveExposureIn(tx: Prisma.TransactionClient, input: ApproveExposureInput): Promise<{ approvalId: string; created: boolean }> {
  const playlistPageId = input.playlistPageId ?? null;
  checkScopeShape(input.scope, playlistPageId);
  const note = input.note?.trim() ? input.note.trim().slice(0, 2000) : null;

  {
    await lockPage(tx, input.videoPageId);
    const page = await tx.youTubeVideoPage.findUnique({
      where: { id: input.videoPageId },
      include: { youtubeVideo: true },
    });
    if (!page) throw new ExposurePageNotFoundError();
    if (page.archivedAt) throw new ApprovalPageArchivedError();
    if (page.youtubeVideo.privacyStatus !== "unlisted") throw new ApprovalNotApplicableError(page.youtubeVideo.privacyStatus);
    if (page.youtubeVideo.observabilityState !== "OBSERVED") throw new VideoNotAvailableError();

    const review = await tx.videoExposureReview.findUnique({
      where: { youtubeVideoId: page.youtubeVideoId },
      select: { holdReason: true },
    });
    if (review?.holdReason) throw new ApprovalBlockedByHoldError(review.holdReason);

    if (input.scope !== "PAGE") {
      const pageApproval = await tx.videoExposureApproval.findFirst({
        where: { videoPageId: page.id, scope: "PAGE", revokedAt: null },
        select: { id: true },
      });
      if (!pageApproval) throw new ApprovalPrerequisiteError();
    }

    if (input.scope === "PLAYLIST") {
      const playlist = await tx.playlistPage.findUnique({ where: { id: playlistPageId! }, select: { archivedAt: true } });
      if (!playlist || playlist.archivedAt) throw new ApprovalInvalidError("That playlist page does not exist or is archived.");
      const member = await tx.playlistPageItem.findUnique({
        where: { playlistPageId_videoPageId: { playlistPageId: playlistPageId!, videoPageId: page.id } },
        select: { id: true },
      });
      if (!member) throw new ApprovalInvalidError("Add the video to that playlist page before approving it for that playlist.");
    }

    const existing = await tx.videoExposureApproval.findFirst({
      where: {
        videoPageId: page.id,
        ...sameTarget(input.scope, playlistPageId),
      },
      select: { id: true },
    });
    if (existing) return { approvalId: existing.id, created: false }; // idempotent: already approved, nothing new recorded

    const approval = await tx.videoExposureApproval.create({
      data: {
        videoPageId: page.id,
        scope: input.scope,
        playlistPageId,
        approvedById: input.actorId,
        note,
      },
    });
    if (input.scope === "PAGE") {
      await tx.youTubeVideoPage.update({
        where: { id: page.id },
        data: {
          unlistedPublicationApprovedAt: approval.approvedAt,
          updatedById: input.actorId,
        },
      });
      // What the editor is approving is the metadata as it is now: that is the baseline later changes are compared with.
      await recordMetadataBaselineIn(tx, page.id);
    }
    await writeAuditLog(
      {
        actorId: input.actorId,
        action: "VIDEO_EXPOSURE_APPROVED",
        entityType: "YouTubeVideoPage",
        entityId: page.id,
        afterSnapshot: {
          scope: input.scope,
          playlistPageId,
          approvalId: approval.id,
        },
      },
      tx,
    );
    if (input.scope === "PAGE") {
      await writeAuditLog(
        {
          actorId: input.actorId,
          action: "VIDEO_PAGE_UNLISTED_PUBLICATION_APPROVED",
          entityType: "YouTubeVideoPage",
          entityId: page.id,
          beforeSnapshot: {
            unlistedPublicationApprovedAt: page.unlistedPublicationApprovedAt,
          },
          afterSnapshot: { unlistedPublicationApprovedAt: approval.approvedAt },
        },
        tx,
      );
    }
    return { approvalId: approval.id, created: true };
  }
}

export function approveExposure(input: ApproveExposureInput): Promise<{ approvalId: string; created: boolean }> {
  return prisma.$transaction((tx) => approveExposureIn(tx, input));
}

export interface RevokeExposureInput {
  videoPageId: string;
  scope: ExposureScopeName;
  playlistPageId?: string | null;
  /** The person who decided, or null when the platform revokes on a lifecycle change (the video went private, the page was archived). */
  actorId: string | null;
  note?: string | null;
  /** Why. Defaults to EDITOR (a person withdrew it). */
  reason?: VideoExposureRevokeReason;
}

/** Revokes one scope. Revoking PAGE revokes every other scope with it. Returns how many approvals were revoked (0 when none was active). */
export async function revokeExposureIn(tx: Prisma.TransactionClient, input: RevokeExposureInput): Promise<{ revoked: number }> {
  const playlistPageId = input.playlistPageId ?? null;
  checkScopeShape(input.scope, playlistPageId);
  const note = input.note?.trim() ? input.note.trim().slice(0, 2000) : null;

  {
    await lockPage(tx, input.videoPageId);
    const page = await tx.youTubeVideoPage.findUnique({
      where: { id: input.videoPageId },
    });
    if (!page) throw new ExposurePageNotFoundError();

    const where: Prisma.VideoExposureApprovalWhereInput = input.scope === "PAGE" ? { videoPageId: page.id, revokedAt: null } : { videoPageId: page.id, ...sameTarget(input.scope, playlistPageId) };
    const active = await tx.videoExposureApproval.findMany({
      where,
      select: { id: true, scope: true, playlistPageId: true },
    });
    const revokedAt = new Date();
    const reason: VideoExposureRevokeReason = input.reason ?? "EDITOR";
    if (active.length > 0) {
      await tx.videoExposureApproval.updateMany({
        where: { id: { in: active.map((a) => a.id) } },
        data: {
          revokedAt,
          revokedById: input.actorId,
          revokedReason: reason,
          revokeNote: note ?? (input.scope === "PAGE" && active.length > 1 ? "Revoked together with the page approval." : null),
        },
      });
    }
    let clearedFlag = false;
    if (input.scope === "PAGE" && page.unlistedPublicationApprovedAt !== null) {
      await tx.youTubeVideoPage.update({
        where: { id: page.id },
        data: {
          unlistedPublicationApprovedAt: null,
          // updatedBy is the last human editor; a platform revocation leaves it as it was.
          ...(input.actorId ? { updatedById: input.actorId } : {}),
        },
      });
      clearedFlag = true;
    }
    if (input.scope === "PAGE" && (active.length > 0 || clearedFlag)) {
      // The approval ended, so a pending metadata review no longer applies and the reviewed baseline goes with it.
      await endMetadataReviewIn(tx, page.id, `The approval ended (${reason.toLowerCase().replace(/_/g, " ")}) before this change was reviewed.`);
    }
    if (active.length > 0 || clearedFlag) {
      await writeAuditLog(
        {
          actorId: input.actorId,
          action: "VIDEO_EXPOSURE_REVOKED",
          entityType: "YouTubeVideoPage",
          entityId: page.id,
          beforeSnapshot: {
            scopes: active.map((a) => ({
              scope: a.scope,
              playlistPageId: a.playlistPageId,
            })),
          },
          afterSnapshot: { revoked: active.length, reason },
        },
        tx,
      );
    }
    if (input.scope === "PAGE" && clearedFlag) {
      await writeAuditLog(
        {
          actorId: input.actorId,
          action: "VIDEO_PAGE_UNLISTED_PUBLICATION_REVOKED",
          entityType: "YouTubeVideoPage",
          entityId: page.id,
          beforeSnapshot: {
            unlistedPublicationApprovedAt: page.unlistedPublicationApprovedAt,
          },
          afterSnapshot: { unlistedPublicationApprovedAt: null },
        },
        tx,
      );
    }
    return { revoked: active.length };
  }
}

export function revokeExposure(input: RevokeExposureInput): Promise<{ revoked: number }> {
  return prisma.$transaction((tx) => revokeExposureIn(tx, input));
}

/** The unrevoked approvals of several pages, keyed by page id. */
export async function listActiveApprovals(videoPageIds: readonly string[], client: Client = prisma): Promise<Map<string, ActiveApproval[]>> {
  const out = new Map<string, ActiveApproval[]>();
  if (videoPageIds.length === 0) return out;
  const rows = await client.videoExposureApproval.findMany({
    where: { videoPageId: { in: [...videoPageIds] }, revokedAt: null },
    select: { videoPageId: true, scope: true, playlistPageId: true },
  });
  for (const row of rows) {
    const list = out.get(row.videoPageId) ?? [];
    list.push({ scope: row.scope, playlistPageId: row.playlistPageId });
    out.set(row.videoPageId, list);
  }
  return out;
}

export type VideoExposureApprovalWithActors = VideoExposureApproval & {
  /** Null for an approval carried over from the legacy flag (no approver was ever recorded). */
  approvedBy: { name: string } | null;
  revokedBy: { name: string } | null;
};

export function listApprovalHistory(videoPageId: string): Promise<VideoExposureApprovalWithActors[]> {
  return prisma.videoExposureApproval.findMany({
    where: { videoPageId },
    orderBy: { approvedAt: "asc" },
    include: {
      approvedBy: { select: { name: true } },
      revokedBy: { select: { name: true } },
    },
  });
}

/** Pages where the legacy flag and the approval history disagree (must always be empty). */
export async function findApprovalFlagInconsistencies(client: Client = prisma): Promise<{ flagWithoutApproval: string[]; approvalWithoutFlag: string[] }> {
  const flagged = await client.youTubeVideoPage.findMany({
    where: { unlistedPublicationApprovedAt: { not: null } },
    select: { id: true },
  });
  const withActive = await client.videoExposureApproval.findMany({
    where: { scope: "PAGE", revokedAt: null },
    select: { videoPageId: true },
  });
  const flaggedIds = new Set(flagged.map((p) => p.id));
  const activeIds = new Set(withActive.map((a) => a.videoPageId));
  return {
    flagWithoutApproval: [...flaggedIds].filter((id) => !activeIds.has(id)),
    approvalWithoutFlag: [...activeIds].filter((id) => !flaggedIds.has(id)),
  };
}
