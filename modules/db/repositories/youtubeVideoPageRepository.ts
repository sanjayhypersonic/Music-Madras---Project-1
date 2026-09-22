import { prisma } from "../client";
import { writeAuditLog } from "../../audit/writeAuditLog";
import { generateVideoSlug } from "../../mmke/slug/generateVideoSlug";
import { isYouTubeVideoPagePublic } from "../../mmke/catalogue/isYouTubeVideoPagePublic";
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
  const page = await prisma.youTubeVideoPage.findUnique({ where: { slug }, include: { youtubeVideo: true } });
  if (!page) return null;

  const eligible = isYouTubeVideoPagePublic({
    page: { status: page.status, archivedAt: page.archivedAt, unlistedPublicationApprovedAt: page.unlistedPublicationApprovedAt },
    youtubeVideo: {
      privacyStatus: page.youtubeVideo.privacyStatus,
      observabilityState: page.youtubeVideo.observabilityState,
    },
  });
  if (!eligible) return null;

  return { page, youtubeVideo: page.youtubeVideo };
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
  const pages = await prisma.youTubeVideoPage.findMany({
    where: { status: "PUBLISHED", archivedAt: null },
    include: { youtubeVideo: true },
    orderBy: { updatedAt: "desc" },
  });

  return pages
    .filter((page) =>
      isYouTubeVideoPagePublic({
        page: { status: page.status, archivedAt: page.archivedAt, unlistedPublicationApprovedAt: page.unlistedPublicationApprovedAt },
        youtubeVideo: { privacyStatus: page.youtubeVideo.privacyStatus, observabilityState: page.youtubeVideo.observabilityState },
      })
    )
    .slice(0, limit)
    .map((page) => ({ page, youtubeVideo: page.youtubeVideo }));
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

  const pages = await prisma.youTubeVideoPage.findMany({
    where: { youtubeVideoId: { in: youtubeVideoIds }, status: "PUBLISHED", archivedAt: null },
    include: { youtubeVideo: true },
  });

  return pages
    .filter((page) =>
      isYouTubeVideoPagePublic({
        page: { status: page.status, archivedAt: page.archivedAt, unlistedPublicationApprovedAt: page.unlistedPublicationApprovedAt },
        youtubeVideo: { privacyStatus: page.youtubeVideo.privacyStatus, observabilityState: page.youtubeVideo.observabilityState },
      })
    )
    .map((page) => ({ page, youtubeVideo: page.youtubeVideo }));
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
  return prisma.$transaction(async (tx) => {
    const page = await tx.youTubeVideoPage.findUnique({ where: { id }, include: { youtubeVideo: true } });
    if (!page) {
      throw new Error(`YouTubeVideoPage ${id} does not exist.`);
    }
    if (page.youtubeVideo.privacyStatus !== "unlisted") {
      throw new Error(
        `YouTubeVideoPage ${id} cannot be approved for unlisted publication: the linked YouTube video's privacy status is "${page.youtubeVideo.privacyStatus}", not "unlisted".`
      );
    }

    const approvedAt = new Date();
    const updated = await tx.youTubeVideoPage.update({
      where: { id },
      data: { unlistedPublicationApprovedAt: approvedAt, updatedById: actorId },
    });

    await writeAuditLog(
      {
        actorId,
        action: "VIDEO_PAGE_UNLISTED_PUBLICATION_APPROVED",
        entityType: "YouTubeVideoPage",
        entityId: id,
        beforeSnapshot: { unlistedPublicationApprovedAt: page.unlistedPublicationApprovedAt },
        afterSnapshot: { unlistedPublicationApprovedAt: approvedAt },
      },
      tx
    );

    return updated;
  });
}

/** Revoking never touches status/archivedAt — only the approval timestamp. */
export async function revokeUnlistedApproval(id: string, actorId: string): Promise<YouTubeVideoPage> {
  const before = await prisma.youTubeVideoPage.findUnique({ where: { id } });
  if (!before) {
    throw new Error(`YouTubeVideoPage ${id} does not exist.`);
  }

  const updated = await prisma.youTubeVideoPage.update({
    where: { id },
    data: { unlistedPublicationApprovedAt: null, updatedById: actorId },
  });

  await writeAuditLog({
    actorId,
    action: "VIDEO_PAGE_UNLISTED_PUBLICATION_REVOKED",
    entityType: "YouTubeVideoPage",
    entityId: id,
    beforeSnapshot: { unlistedPublicationApprovedAt: before.unlistedPublicationApprovedAt },
    afterSnapshot: { unlistedPublicationApprovedAt: null },
  });

  return updated;
}

export async function archiveVideoPage(id: string, actorId: string): Promise<YouTubeVideoPage> {
  const before = await prisma.youTubeVideoPage.findUnique({ where: { id } });
  if (!before) {
    throw new Error(`YouTubeVideoPage ${id} does not exist.`);
  }

  const updated = await prisma.youTubeVideoPage.update({
    where: { id },
    data: { archivedAt: new Date(), updatedById: actorId },
  });

  await writeAuditLog({
    actorId,
    action: "VIDEO_PAGE_ARCHIVED",
    entityType: "YouTubeVideoPage",
    entityId: id,
    beforeSnapshot: { archivedAt: before.archivedAt },
    afterSnapshot: { archivedAt: updated.archivedAt },
  });

  return updated;
}

export async function unarchiveVideoPage(id: string, actorId: string): Promise<YouTubeVideoPage> {
  const before = await prisma.youTubeVideoPage.findUnique({ where: { id } });
  if (!before) {
    throw new Error(`YouTubeVideoPage ${id} does not exist.`);
  }

  const updated = await prisma.youTubeVideoPage.update({
    where: { id },
    data: { archivedAt: null, updatedById: actorId },
  });

  await writeAuditLog({
    actorId,
    action: "VIDEO_PAGE_UNARCHIVED",
    entityType: "YouTubeVideoPage",
    entityId: id,
    beforeSnapshot: { archivedAt: before.archivedAt },
    afterSnapshot: { archivedAt: null },
  });

  return updated;
}

/** Studio-facing list (Phase 6G-1B): every catalogue page regardless of status, mirroring listCollections's "drafts too" convention. */
export function listVideoPages(): Promise<YouTubeVideoPage[]> {
  return prisma.youTubeVideoPage.findMany({ orderBy: { updatedAt: "desc" } });
}
