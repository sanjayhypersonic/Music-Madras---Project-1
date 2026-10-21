import { prisma } from "../client";
import { writeAuditLog } from "../../audit/writeAuditLog";
import { generateVideoSlug } from "../../mmke/slug/generateVideoSlug";
import { isVideoExposed, type ActiveApproval, type ExposureHoldName } from "../../mmke/catalogue/videoExposure";
import { exposedVideoPageWhere } from "../../mmke/catalogue/videoExposureQuery";
import { approveExposure, revokeExposure } from "./videoExposureRepository";
import { revokeForArchiveIn } from "./videoLifecycleRepository";
import { canPublishVideoPage, canUnpublishVideoPage } from "../../publishing/videoPageTransitions";
import type { YouTubeVideo, YouTubeVideoPage } from "@prisma/client";

// YouTubeVideoPage persistence (Phase 6G-1B, pre-flight §4). This is the
// Music Madras-owned catalogue/publication wrapper around a synchronized
// YouTubeVideo — this module NEVER writes to YouTubeVideo itself (title,
// description, thumbnailUrl, statistics, privacyStatus, channelId,
// observabilityState all remain exclusively the sync engine's to write;
// see modules/db/repositories/youtubeVideoRepository.ts). Nothing here is
// called by, or calls into, modules/youtube/sync-engine.

export interface CreateDraftVideoPageInput {
  /** The internal YouTubeVideo.id (not the raw YouTube video ID) this page wraps. */
  youtubeVideoId: string;
  actorId: string;
}

export async function createDraftVideoPage(input: CreateDraftVideoPageInput): Promise<YouTubeVideoPage> {
  return prisma.$transaction(async (tx) => {
    const video = await tx.youTubeVideo.findUnique({ where: { id: input.youtubeVideoId } });
    if (!video) {
      throw new Error(`YouTubeVideo ${input.youtubeVideoId} does not exist.`);
    }

    const existing = await tx.youTubeVideoPage.findUnique({ where: { youtubeVideoId: input.youtubeVideoId } });
    if (existing) {
      throw new Error(`A YouTubeVideoPage already exists for YouTubeVideo ${input.youtubeVideoId}.`);
    }

    // Generated exactly once, here, from whatever the title currently is —
    // never regenerated afterward (brief §4/§3).
    const slug = generateVideoSlug(video.title, video.youtubeVideoId);

    const page = await tx.youTubeVideoPage.create({
      data: {
        slug,
        youtubeVideoId: input.youtubeVideoId,
        createdById: input.actorId,
        updatedById: input.actorId,
      },
    });

    await writeAuditLog(
      {
        actorId: input.actorId,
        action: "VIDEO_PAGE_CREATED",
        entityType: "YouTubeVideoPage",
        entityId: page.id,
        afterSnapshot: page,
      },
      tx
    );

    return page;
  });
}

export function findById(id: string): Promise<YouTubeVideoPage | null> {
  return prisma.youTubeVideoPage.findUnique({ where: { id } });
}

export function findByYouTubeVideoId(youtubeVideoId: string): Promise<YouTubeVideoPage | null> {
  return prisma.youTubeVideoPage.findUnique({ where: { youtubeVideoId } });
}

export function findBySlug(slug: string): Promise<YouTubeVideoPage | null> {
  return prisma.youTubeVideoPage.findUnique({ where: { slug } });
}

export interface PublicVideoPageResult {
  page: YouTubeVideoPage;
  youtubeVideo: YouTubeVideo;
  /** Phase 6K-2: whether the video may also be LISTED (catalogue, search, sitemap, homepage). False for an approved-but-unlisted-from-discovery video, which is reachable by its URL only. */
  discoverable: boolean;
}

type PageWithApprovals = YouTubeVideoPage & {
  youtubeVideo: YouTubeVideo & { exposureReview: { holdReason: ExposureHoldName | null } | null };
  exposureApprovals: { scope: ActiveApproval["scope"]; playlistPageId: string | null }[];
};

const ACTIVE_APPROVALS = { where: { revokedAt: null }, select: { scope: true, playlistPageId: true } } as const;
/** The video plus the one fact the shared rule needs from its review row: an active hold. */
const VIDEO_WITH_HOLD = { include: { exposureReview: { select: { holdReason: true } } } } as const;

function facts(page: PageWithApprovals) {
  return {
    page: { status: page.status, archivedAt: page.archivedAt, unlistedPublicationApprovedAt: page.unlistedPublicationApprovedAt },
    youtubeVideo: { privacyStatus: page.youtubeVideo.privacyStatus, observabilityState: page.youtubeVideo.observabilityState },
    activeApprovals: page.exposureApprovals,
    hold: page.youtubeVideo.exposureReview?.holdReason ?? null,
  };
}

/** Public callers get the plain video row, never the review row that carries the hold. */
function stripReview(video: PageWithApprovals["youtubeVideo"]): YouTubeVideo {
  const { exposureReview: _review, ...plain } = video;
  void _review;
  return plain;
}

/**
 * The only sanctioned "is this safe to render publicly" lookup (brief §6).
 * Deliberately does not stop at `status === "PUBLISHED"` — it re-evaluates
 * the full three-axis gate (modules/mmke/catalogue/isYouTubeVideoPagePublic)
 * against the video's CURRENT synced state on every call, so a video that
 * has drifted to unlisted/private/unavailable since publish stops being
 * returned here without anyone needing to remember to unpublish it.
 */
export async function findPublishedBySlug(slug: string): Promise<PublicVideoPageResult | null> {
  const found = await prisma.youTubeVideoPage.findUnique({ where: { slug }, include: { youtubeVideo: VIDEO_WITH_HOLD, exposureApprovals: ACTIVE_APPROVALS } });
  if (!found) return null;

  // The PAGE surface: reachable by its URL. Whether it is also LISTED is `discoverable`.
  if (!isVideoExposed(facts(found), { kind: "PAGE" })) return null;

  const { youtubeVideo, exposureApprovals: _approvals, ...page } = found;
  void _approvals;
  return { page, youtubeVideo: stripReview(youtubeVideo), discoverable: isVideoExposed(facts(found), { kind: "DISCOVERY" }) };
}

/**
 * The list-shaped sibling of findPublishedBySlug (Phase 6G-3, homepage
 * discovery surface). Same re-evaluated three-axis eligibility check —
 * never trusts page.status alone — so a page that has drifted to
 * unlisted/private/unavailable since publish is silently excluded here
 * too, without anyone needing to remember to unpublish it. Ordered by
 * most-recently-updated so a newly published or newly approved page
 * surfaces without depending on a separate "featured" concept.
 */
export async function listPublishedVideoPages(limit: number): Promise<PublicVideoPageResult[]> {
  // DISCOVERY surface (homepage, sitemap): an unlisted video additionally needs its own recorded DISCOVERY approval. Filtered in SQL by the
  // twin of isVideoExposed (modules/mmke/catalogue/videoExposureQuery.ts; parity-tested), so the limit applies to eligible rows only.
  const pages = await prisma.youTubeVideoPage.findMany({
    where: exposedVideoPageWhere({ kind: "DISCOVERY" }),
    include: { youtubeVideo: true },
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    take: Number.isFinite(limit) && limit < 1_000_000 ? Math.max(0, Math.floor(limit)) : undefined,
  });
  return pages.map(({ youtubeVideo, ...page }) => ({ page, youtubeVideo, discoverable: true }));
}

/**
 * The scoped-by-id sibling of listPublishedVideoPages (Phase 6G-4A, entity
 * relationship/media-aggregation layer). Given a specific set of
 * YouTubeVideo ids reached through a canonical MMKE relationship (e.g.
 * Recording -> MediaResource), returns only the ones that are genuinely
 * public right now — same isYouTubeVideoPagePublic gate, never a second
 * competing predicate. An empty input returns an empty result without
 * querying, so callers never need to special-case "no candidates."
 */
export async function findPublicVideoPagesByYouTubeVideoIds(youtubeVideoIds: string[]): Promise<PublicVideoPageResult[]> {
  if (youtubeVideoIds.length === 0) return [];

  // Related-video sections on entity pages are a DISCOVERY surface.
  const pages = await prisma.youTubeVideoPage.findMany({
    where: { AND: [{ youtubeVideoId: { in: youtubeVideoIds } }, exposedVideoPageWhere({ kind: "DISCOVERY" })] },
    include: { youtubeVideo: true },
  });
  return pages.map(({ youtubeVideo, ...page }) => ({ page, youtubeVideo, discoverable: true }));
}

export interface UpdateVideoPageEditorialFieldsInput {
  // Deliberately no `slug`, `youtubeVideoId`, or `status` field here —
  // this function must never be able to change identity or publication
  // state (brief §4/§7 — those go through the dedicated functions below).
  curatorNote?: string | null;
  seoMetaTitle?: string | null;
  seoMetaDescription?: string | null;
  actorId: string;
}

export async function updateEditorialFields(id: string, input: UpdateVideoPageEditorialFieldsInput): Promise<YouTubeVideoPage> {
  const before = await prisma.youTubeVideoPage.findUnique({ where: { id } });
  if (!before) {
    throw new Error(`YouTubeVideoPage ${id} does not exist.`);
  }

  const updated = await prisma.youTubeVideoPage.update({
    where: { id },
    data: {
      curatorNote: input.curatorNote,
      seoMetaTitle: input.seoMetaTitle,
      seoMetaDescription: input.seoMetaDescription,
      updatedById: input.actorId,
    },
  });

  await writeAuditLog({
    actorId: input.actorId,
    action: "VIDEO_PAGE_EDITORIAL_FIELDS_UPDATED",
    entityType: "YouTubeVideoPage",
    entityId: id,
    beforeSnapshot: { curatorNote: before.curatorNote, seoMetaTitle: before.seoMetaTitle, seoMetaDescription: before.seoMetaDescription },
    afterSnapshot: { curatorNote: updated.curatorNote, seoMetaTitle: updated.seoMetaTitle, seoMetaDescription: updated.seoMetaDescription },
  });

  return updated;
}

export async function publishVideoPage(id: string, actorId: string): Promise<YouTubeVideoPage> {
  return prisma.$transaction(async (tx) => {
    const page = await tx.youTubeVideoPage.findUnique({ where: { id } });
    if (!page) {
      throw new Error(`YouTubeVideoPage ${id} does not exist.`);
    }
    if (!canPublishVideoPage({ status: page.status, archivedAt: page.archivedAt })) {
      throw new Error(`YouTubeVideoPage ${id} cannot be published from its current state (${page.status}${page.archivedAt ? ", archived" : ""}).`);
    }

    // Phase 6G-2A (locked product decision): publishing is Music Madras's
    // own editorial decision and is independent of YouTube's current
    // visibility — it no longer requires isYouTubeVideoPagePublic
    // eligibility. A page CAN become PUBLISHED while its video is
    // unlisted or even private; whether that page is actually exposed
    // publicly is entirely findPublishedBySlug/isYouTubeVideoPagePublic's
    // decision at read time, never this function's.

    const updated = await tx.youTubeVideoPage.update({
      where: { id },
      data: { status: "PUBLISHED", updatedById: actorId },
    });

    await writeAuditLog(
      {
        actorId,
        action: "VIDEO_PAGE_PUBLISHED",
        entityType: "YouTubeVideoPage",
        entityId: id,
        beforeSnapshot: { status: page.status },
        afterSnapshot: { status: "PUBLISHED" },
      },
      tx
    );

    return updated;
  });
}

export async function unpublishVideoPage(id: string, actorId: string): Promise<YouTubeVideoPage> {
  return prisma.$transaction(async (tx) => {
    const page = await tx.youTubeVideoPage.findUnique({ where: { id } });
    if (!page) {
      throw new Error(`YouTubeVideoPage ${id} does not exist.`);
    }
    if (!canUnpublishVideoPage({ status: page.status, archivedAt: page.archivedAt })) {
      throw new Error(`YouTubeVideoPage ${id} cannot be unpublished from its current state (${page.status}${page.archivedAt ? ", archived" : ""}).`);
    }

    const updated = await tx.youTubeVideoPage.update({
      where: { id },
      data: { status: "DRAFT", updatedById: actorId },
    });

    await writeAuditLog(
      {
        actorId,
        action: "VIDEO_PAGE_UNPUBLISHED",
        entityType: "YouTubeVideoPage",
        entityId: id,
        beforeSnapshot: { status: "PUBLISHED" },
        afterSnapshot: { status: "DRAFT" },
      },
      tx
    );

    return updated;
  });
}

/**
 * Explicit Music Madras editorial approval to expose an UNLISTED video's
 * page publicly (Phase 6G-2A, locked product decision). Deliberately
 * independent of publish/unpublish: approving does not publish, and
 * publishing does not approve. Only ever legal while the linked
 * YouTubeVideo is currently "unlisted" — there is no approval path for
 * "private" or any other privacy status, matching
 * isYouTubeVideoPagePublic's own refusal to even consult this field for
 * those cases.
 */
export async function approveUnlistedPublication(id: string, actorId: string): Promise<YouTubeVideoPage> {
  // Phase 6K-2: this is the PAGE-scope approval (a recorded, revocable approval row plus the legacy flag). It does NOT list the video on
  // discovery surfaces or in any playlist: those are separate scopes (videoExposureRepository.approveExposure).
  await approveExposure({ videoPageId: id, scope: "PAGE", actorId });
  return prisma.youTubeVideoPage.findUniqueOrThrow({ where: { id } });
}

/** Revoking never touches status/archivedAt — it revokes the PAGE approval and, with it, every other exposure scope of the page. */
export async function revokeUnlistedApproval(id: string, actorId: string): Promise<YouTubeVideoPage> {
  await revokeExposure({ videoPageId: id, scope: "PAGE", actorId });
  return prisma.youTubeVideoPage.findUniqueOrThrow({ where: { id } });
}
/**
 * Archives a page. One transaction, under the page's row lock: the archive, the end of the page's public-exposure approvals (Phase 6K F11: an archived
 * page cannot hold an approval, and restoring it never brings one back), and every audit entry commit together or not at all. Archiving an already
 * archived page changes nothing.
 */
export async function archiveVideoPage(id: string, actorId: string): Promise<YouTubeVideoPage> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`select id from youtube_video_pages where id = ${id} for update`;
    const before = await tx.youTubeVideoPage.findUnique({ where: { id } });
    if (!before) {
      throw new Error(`YouTubeVideoPage ${id} does not exist.`);
    }
    if (before.archivedAt) return before;

    const updated = await tx.youTubeVideoPage.update({
      where: { id },
      data: { archivedAt: new Date(), updatedById: actorId },
    });
    await revokeForArchiveIn(tx, id, actorId);

    await writeAuditLog(
      {
        actorId,
        action: "VIDEO_PAGE_ARCHIVED",
        entityType: "YouTubeVideoPage",
        entityId: id,
        beforeSnapshot: { archivedAt: before.archivedAt },
        afterSnapshot: { archivedAt: updated.archivedAt },
      },
      tx
    );

    return updated;
  });
}

/** Restores an archived page. It does NOT restore any approval: exposure of an unlisted video needs a fresh, explicit approval afterwards. */
export async function unarchiveVideoPage(id: string, actorId: string): Promise<YouTubeVideoPage> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`select id from youtube_video_pages where id = ${id} for update`;
    const before = await tx.youTubeVideoPage.findUnique({ where: { id } });
    if (!before) {
      throw new Error(`YouTubeVideoPage ${id} does not exist.`);
    }
    if (!before.archivedAt) return before;

    const updated = await tx.youTubeVideoPage.update({
      where: { id },
      data: { archivedAt: null, updatedById: actorId },
    });

    await writeAuditLog(
      {
        actorId,
        action: "VIDEO_PAGE_UNARCHIVED",
        entityType: "YouTubeVideoPage",
        entityId: id,
        beforeSnapshot: { archivedAt: before.archivedAt },
        afterSnapshot: { archivedAt: null, note: "Restoring does not restore any approval; an unlisted video needs a fresh approval." },
      },
      tx
    );

    return updated;
  });
}

/** Studio-facing list (Phase 6G-1B): every catalogue page regardless of status, mirroring listCollections's "drafts too" convention. */
export function listVideoPages(): Promise<YouTubeVideoPage[]> {
  return prisma.youTubeVideoPage.findMany({ orderBy: { updatedAt: "desc" } });
}
