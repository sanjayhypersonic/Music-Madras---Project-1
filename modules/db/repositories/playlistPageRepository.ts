import { writeAuditLog } from "../../audit/writeAuditLog";
import { isVideoExposed, type ExposureHoldName, type VideoExposureFacts } from "../../mmke/catalogue/videoExposure";
import { exposedVideoPageWhere } from "../../mmke/catalogue/videoExposureQuery";
import { PlaylistArchivedError, PlaylistConflictError, PlaylistInvalidError, PlaylistMemberError, PlaylistNotFoundError, PlaylistQualityError } from "../../mmke/playlists/playlistErrors";
import { PLAYLIST_LIMITS, normalisePlaylistFields, validatePlaylistFieldLimits } from "../../mmke/playlists/playlistFields";
import { evaluatePlaylistQuality, normaliseTitle, type PlaylistQualityConfig, type PlaylistQualityResult } from "../../mmke/playlists/playlistQuality";
import { slugify } from "../../mmke/slug/slugify";
import { prisma } from "../client";
import { isUniqueConstraintViolation } from "../isUniqueConstraintViolation";
import { loadResolvedSettings } from "./siteSettingRepository";
import { raiseNotification, refreshOpenNotificationText, resolveNotification } from "./studioNotificationRepository";
import { approveExposureIn, revokeExposureIn } from "./videoExposureRepository";
import type { Prisma, PlaylistPage, PlaylistPageItem, VideoExposureApproval, YouTubeVideo, YouTubeVideoPage } from "@prisma/client";

// Phase 6K-4 — playlist pages: curated, editorial pages about a themed set of videos.
//
//  - Membership is CURATED here (playlist_page_items). It is a separate fact from YouTube's own playlist membership, which grants nothing.
//  - The draft (title, summary, body, search fields, members) is edited freely and counted by `version`; the PUBLISHED SNAPSHOT (published*
//    columns, including the ordered member ids, the per-member notes and the context the page was published with) is the only thing the public
//    site reads, and the only thing the quality sweep judges a live page by. Editing a draft changes nothing a visitor sees, and nothing about when
//    the page was last published (sitemap lastmod is the publication time, not the last edit).
//  - An ARCHIVED page cannot be edited, have members changed or moved, take context, be proposed drafts or be published: restore it first.
//    Archiving is one transaction under the page's row lock (unpublish + archive + audit), so publishing can never race with archiving into a
//    contradictory state.
//  - A page's published title is unique among live pages, guaranteed by the database (publishedTitleKey), so two pages cannot go live under one title
//    even when published at the same moment; drafts are compared with nothing.
//  - Reordering (members) renumbers through a temporary position, because positions are unique per page.
//  - Publishing needs the version the editor reviewed AND a passing quality rubric on that current draft (playlistQuality.ts; thresholds are
//    settings). A page that fails stays a draft, nothing is written, and the failure is raised as ONE deduplicated Studio notification.
//  - What a visitor sees of a member is decided by the shared exposure rule on the PLAYLIST surface (exposedVideoPageWhere): public videos are
//    shown; an unlisted video only with a recorded, revocable approval for THIS playlist; anything private/unavailable/draft never.
//  - A published page is re-checked (runPlaylistQualitySweep) so a page that stops meeting the rubric after a material change (an approval
//    revoked, a video made private) raises a warning instead of silently degrading.
// Authorization is decided by the calling Server Action: editing is CATALOGUE_WRITE; publishing, unpublishing and approving inclusion change
// what visitors see, so they need RECORDING_PUBLISH.

type Client = Prisma.TransactionClient | typeof prisma;

export const PLAYLIST_FAILED_DEDUPE = (id: string) => `playlist-quality-failed:${id}`;
export const PLAYLIST_REGRESSION_DEDUPE = (id: string) => `playlist-quality-regression:${id}`;
const studioHref = (id: string) => `/studio/catalogue/playlists/${id}`;

async function lockPlaylist(tx: Prisma.TransactionClient, id: string): Promise<void> {
  await tx.$queryRaw`select id from playlist_pages where id = ${id} for update`;
}

/** Locks the page and returns it, refusing a missing or ARCHIVED page: every edit goes through this. */
async function lockEditablePlaylist(tx: Prisma.TransactionClient, id: string): Promise<PlaylistPage> {
  await lockPlaylist(tx, id);
  const page = await tx.playlistPage.findUnique({ where: { id } });
  if (!page) throw new PlaylistNotFoundError();
  if (page.archivedAt) throw new PlaylistArchivedError();
  return page;
}

/** The key a published title is stored under (exactly normaliseTitle); null for a blank title. */
const titleKeyOf = (title: string): string | null => {
  const key = normaliseTitle(title);
  return key === "" ? null : key;
};

async function uniqueSlug(client: Client, title: string): Promise<string> {
  const base = slugify(title).slice(0, 80) || "playlist";
  for (let n = 1; n < 1000; n++) {
    const candidate = n === 1 ? base : `${base}-${n}`;
    if (!(await client.playlistPage.findUnique({ where: { slug: candidate }, select: { id: true } }))) return candidate;
  }
  throw new PlaylistInvalidError(["A unique address for this playlist page could not be generated."]);
}

export async function loadQualityConfig(client: Client = prisma): Promise<PlaylistQualityConfig> {
  const settings = await loadResolvedSettings(client);
  return {
    requireSummary: settings.get("playlistQuality.requireSummary"),
    minEligibleVideos: settings.get("playlistQuality.minEligibleVideos"),
    requireSeoDescription: settings.get("playlistQuality.requireSeoDescription"),
    minContextInputs: settings.get("playlistQuality.minContextInputs"),
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Creation and drafting
// ---------------------------------------------------------------------------------------------------------------------------------

export async function createPlaylistPage(input: { title: string; youtubePlaylistId?: string | null; seedMembersFromYouTube?: boolean; actorId: string }): Promise<PlaylistPage> {
  const fields = normalisePlaylistFields({ title: input.title });
  const problems = validatePlaylistFieldLimits(fields);
  if (problems.length > 0) throw new PlaylistInvalidError(problems);

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        if (input.youtubePlaylistId) {
          const source = await tx.youTubePlaylist.findUnique({ where: { id: input.youtubePlaylistId }, select: { id: true } });
          if (!source) throw new PlaylistInvalidError(["That YouTube playlist is not in the synchronized catalogue."]);
          if (await tx.playlistPage.findUnique({ where: { youtubePlaylistId: input.youtubePlaylistId }, select: { id: true } })) {
            throw new PlaylistInvalidError(["A playlist page already exists for that YouTube playlist."]);
          }
        }
        const slug = await uniqueSlug(tx, fields.title);
        const page = await tx.playlistPage.create({ data: { slug, title: fields.title, youtubePlaylistId: input.youtubePlaylistId ?? null, createdById: input.actorId, updatedById: input.actorId } });
        let seeded = 0;
        if (input.youtubePlaylistId && input.seedMembersFromYouTube) {
          const items = await tx.youTubePlaylistItem.findMany({ where: { playlistId: input.youtubePlaylistId }, orderBy: [{ position: "asc" }, { id: "asc" }], select: { youtubeVideoId: true } });
          const pages = await tx.youTubeVideoPage.findMany({ where: { youtubeVideoId: { in: items.map((i) => i.youtubeVideoId) } }, select: { id: true, youtubeVideoId: true } });
          const byVideo = new Map(pages.map((p) => [p.youtubeVideoId, p.id]));
          for (const item of items) {
            const videoPageId = byVideo.get(item.youtubeVideoId);
            if (!videoPageId) continue; // a video with no Music Madras page cannot be a member
            await tx.playlistPageItem.create({ data: { playlistPageId: page.id, videoPageId, position: seeded + 1, addedById: input.actorId } });
            seeded += 1;
          }
        }
        await writeAuditLog({ actorId: input.actorId, action: "PLAYLIST_PAGE_CREATED", entityType: "PlaylistPage", entityId: page.id, afterSnapshot: { title: page.title, slug: page.slug, seededMembers: seeded } }, tx);
        return page;
      });
    } catch (err) {
      if (isUniqueConstraintViolation(err) && attempt < 2) continue; // a concurrent create took the slug: try the next free one
      throw err;
    }
  }
  throw new PlaylistInvalidError(["The playlist page could not be created."]);
}

export async function updatePlaylistDraft(input: { id: string; expectedVersion: number; fields: Parameters<typeof normalisePlaylistFields>[0]; actorId: string }): Promise<{ version: number; changed: boolean }> {
  const fields = normalisePlaylistFields(input.fields);
  const problems = validatePlaylistFieldLimits(fields);
  if (problems.length > 0) throw new PlaylistInvalidError(problems);
  const result = await prisma.$transaction(async (tx) => {
    const existing = await lockEditablePlaylist(tx, input.id);
    if (existing.version !== input.expectedVersion) throw new PlaylistConflictError();
    const changedFields = (["title", "summary", "body", "seoTitle", "seoDescription"] as const).filter((f) => (existing[f] ?? null) !== (fields[f] ?? null));
    if (changedFields.length === 0) return { version: existing.version, changed: false };
    await tx.playlistPage.update({ where: { id: existing.id }, data: { ...fields, version: { increment: 1 }, updatedById: input.actorId } });
    await writeAuditLog({ actorId: input.actorId, action: "PLAYLIST_PAGE_DRAFT_UPDATED", entityType: "PlaylistPage", entityId: existing.id, afterSnapshot: { version: existing.version + 1, changedFields } }, tx);
    return { version: existing.version + 1, changed: true };
  });
  if (result.changed) await syncPlaylistQualityNotificationSafely(input.id);
  return result;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Curated membership (every change is a draft edit: it bumps `version`, so a publish must name the version that includes it)
// ---------------------------------------------------------------------------------------------------------------------------------

export async function addPlaylistMember(input: { playlistPageId: string; videoPageId: string; note?: string | null; actorId: string }): Promise<{ added: boolean }> {
  const note = input.note?.trim() ? input.note.trim().slice(0, PLAYLIST_LIMITS.note) : null;
  const result = await prisma.$transaction(async (tx) => {
    await lockEditablePlaylist(tx, input.playlistPageId);
    const video = await tx.youTubeVideoPage.findUnique({ where: { id: input.videoPageId }, select: { id: true } });
    if (!video) throw new PlaylistMemberError("That video page does not exist.");
    if (await tx.playlistPageItem.findUnique({ where: { playlistPageId_videoPageId: { playlistPageId: input.playlistPageId, videoPageId: input.videoPageId } }, select: { id: true } })) return { added: false };
    const last = await tx.playlistPageItem.aggregate({ where: { playlistPageId: input.playlistPageId }, _max: { position: true } });
    await tx.playlistPageItem.create({ data: { playlistPageId: input.playlistPageId, videoPageId: input.videoPageId, position: (last._max.position ?? 0) + 1, note, addedById: input.actorId } });
    await tx.playlistPage.update({ where: { id: input.playlistPageId }, data: { version: { increment: 1 }, updatedById: input.actorId } });
    await writeAuditLog({ actorId: input.actorId, action: "PLAYLIST_PAGE_MEMBER_ADDED", entityType: "PlaylistPage", entityId: input.playlistPageId, afterSnapshot: { videoPageId: input.videoPageId } }, tx);
    return { added: true };
  });
  if (result.added) await syncPlaylistQualityNotificationSafely(input.playlistPageId);
  return result;
}

export async function removePlaylistMember(input: { playlistPageId: string; videoPageId: string; actorId: string }): Promise<{ removed: boolean }> {
  const result = await prisma.$transaction(async (tx) => {
    await lockEditablePlaylist(tx, input.playlistPageId);
    const row = await tx.playlistPageItem.findUnique({ where: { playlistPageId_videoPageId: { playlistPageId: input.playlistPageId, videoPageId: input.videoPageId } } });
    if (!row) return { removed: false };
    await tx.playlistPageItem.delete({ where: { id: row.id } });
    // Closing the gap: each later member moves up into a position that has just been freed, in ascending order, so the unique index is never tripped.
    const rest = await tx.playlistPageItem.findMany({ where: { playlistPageId: input.playlistPageId }, orderBy: [{ position: "asc" }, { id: "asc" }], select: { id: true, position: true } });
    for (const [i, item] of rest.entries()) if (item.position !== i + 1) await tx.playlistPageItem.update({ where: { id: item.id }, data: { position: i + 1 } });
    await tx.playlistPage.update({ where: { id: input.playlistPageId }, data: { version: { increment: 1 }, updatedById: input.actorId } });
    await writeAuditLog({ actorId: input.actorId, action: "PLAYLIST_PAGE_MEMBER_REMOVED", entityType: "PlaylistPage", entityId: input.playlistPageId, beforeSnapshot: { videoPageId: input.videoPageId } }, tx);
    return { removed: true };
  });
  if (result.removed) await syncPlaylistQualityNotificationSafely(input.playlistPageId);
  return result;
}

export async function movePlaylistMember(input: { playlistPageId: string; videoPageId: string; direction: "up" | "down"; actorId: string }): Promise<{ moved: boolean }> {
  return prisma.$transaction(async (tx) => {
    await lockEditablePlaylist(tx, input.playlistPageId);
    const rows = await tx.playlistPageItem.findMany({ where: { playlistPageId: input.playlistPageId }, orderBy: [{ position: "asc" }, { id: "asc" }], select: { id: true, videoPageId: true, position: true } });
    const index = rows.findIndex((r) => r.videoPageId === input.videoPageId);
    if (index === -1) throw new PlaylistMemberError("That video is not in this playlist page.");
    const target = input.direction === "up" ? index - 1 : index + 1;
    if (target < 0 || target >= rows.length) return { moved: false };
    // Positions are unique per page, so the two neighbours cannot swap directly: park one on a temporary position (0 is never a real one), move the
    // other into its place, then settle the first. They exchange the positions they actually hold, so no third member can collide.
    const [a, b] = [rows[index], rows[target]];
    await tx.playlistPageItem.update({ where: { id: a.id }, data: { position: 0 } });
    await tx.playlistPageItem.update({ where: { id: b.id }, data: { position: a.position } });
    await tx.playlistPageItem.update({ where: { id: a.id }, data: { position: b.position } });
    await tx.playlistPage.update({ where: { id: input.playlistPageId }, data: { version: { increment: 1 }, updatedById: input.actorId } });
    await writeAuditLog({ actorId: input.actorId, action: "PLAYLIST_PAGE_MEMBER_MOVED", entityType: "PlaylistPage", entityId: input.playlistPageId, afterSnapshot: { videoPageId: input.videoPageId, direction: input.direction } }, tx);
    return { moved: true };
  });
}

/** Records, revocably, that this UNLISTED member may be shown on THIS playlist page. Needs the video's page approval first; never changes YouTube. */
export async function approvePlaylistInclusion(input: { playlistPageId: string; videoPageId: string; actorId: string; note?: string | null }): Promise<{ created: boolean }> {
  const result = await prisma.$transaction(async (tx) => {
    const approved = await approveExposureIn(tx, { videoPageId: input.videoPageId, scope: "PLAYLIST", playlistPageId: input.playlistPageId, actorId: input.actorId, note: input.note });
    return { created: approved.created };
  });
  if (result.created) await syncPlaylistQualityNotificationSafely(input.playlistPageId);
  return result;
}

export async function revokePlaylistInclusion(input: { playlistPageId: string; videoPageId: string; actorId: string; note?: string | null }): Promise<{ revoked: number }> {
  const result = await prisma.$transaction((tx) => revokeExposureIn(tx, { videoPageId: input.videoPageId, scope: "PLAYLIST", playlistPageId: input.playlistPageId, actorId: input.actorId, note: input.note }));
  if (result.revoked > 0) await syncPlaylistQualityNotificationSafely(input.playlistPageId);
  return result;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Quality
// ---------------------------------------------------------------------------------------------------------------------------------

async function eligibleVideoPageIds(client: Client, playlistPageId: string, videoPageIds: string[]): Promise<Set<string>> {
  if (videoPageIds.length === 0) return new Set();
  const rows = await client.youTubeVideoPage.findMany({ where: { AND: [{ id: { in: videoPageIds } }, exposedVideoPageWhere({ kind: "PLAYLIST", playlistPageId })] }, select: { id: true } });
  return new Set(rows.map((r) => r.id));
}

/**
 * Whether ANOTHER live page is already published under this title. Only published, non-archived pages hold a title key, so a draft elsewhere (or an
 * archived page) is never a conflict; the database's unique index on the key is what actually guarantees it (see publishPlaylistPage).
 */
async function liveTitleTaken(client: Client, id: string, title: string): Promise<boolean> {
  const key = titleKeyOf(title);
  if (key === null) return false;
  return (await client.playlistPage.count({ where: { id: { not: id }, publishedTitleKey: key } })) > 0;
}

async function activeContextTexts(client: Client, playlistPageId: string): Promise<string[]> {
  const rows = await client.playlistContextInput.findMany({ where: { playlistPageId, status: "ACTIVE" }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { body: true } });
  return rows.map((r) => r.body ?? "");
}

/** The rubric result for the page's CURRENT DRAFT. */
export async function evaluateDraftQuality(id: string, client: Client = prisma): Promise<PlaylistQualityResult> {
  const page = await client.playlistPage.findUnique({ where: { id }, include: { items: { select: { videoPageId: true } } } });
  if (!page) throw new PlaylistNotFoundError();
  const memberIds = page.items.map((i) => i.videoPageId);
  const eligible = await eligibleVideoPageIds(client, id, memberIds);
  const config = await loadQualityConfig(client);
  return evaluatePlaylistQuality(
    {
      title: page.title,
      summary: page.summary,
      seoDescription: page.seoDescription,
      eligibleMemberCount: eligible.size,
      totalMemberCount: memberIds.length,
      contextTexts: await activeContextTexts(client, id),
      titleTakenByAnotherPage: await liveTitleTaken(client, id, page.title),
    },
    config
  );
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Keeping the "cannot be published yet" notification true (F6)
// ---------------------------------------------------------------------------------------------------------------------------------

export type QualitySyncOutcome = "RAISED" | "UNCHANGED" | "RESOLVED" | "NONE";

/**
 * Brings the page's single "cannot be published yet" notification in line with its CURRENT draft: raised when a check finds the draft failing (on a
 * save, a change to its videos, context or approvals, an explicit check, or a failed publish attempt), updated only when the SET of missing items
 * changes, and resolved the moment the draft passes (or the page is archived). It never needs a publish attempt, and an unchanged failure never
 * notifies twice. A page that has not been touched since it was created raises nothing.
 */
export async function syncPlaylistQualityNotification(id: string): Promise<QualitySyncOutcome> {
  const page = await prisma.playlistPage.findUnique({ where: { id }, select: { title: true, status: true, archivedAt: true } });
  const key = PLAYLIST_FAILED_DEDUPE(id);
  if (!page || page.archivedAt) return (await resolveNotification(key, "The playlist page was archived.")) ? "RESOLVED" : "NONE";
  const quality = await evaluateDraftQuality(id);
  if (quality.passed) return (await resolveNotification(key, "The draft now passes the publication checks.")) ? "RESOLVED" : "NONE";
  const live = page.status === "PUBLISHED";
  const title = `“${page.title.slice(0, 100)}” ${live ? "has changes that cannot be published yet" : "cannot be published yet"}`;
  const body = `${quality.failing.map((c) => `• ${c.detail}`).join("\n")}${live ? "\n\nThe live page is unchanged." : ""}`;
  const raised = await raiseNotification({ kind: "PLAYLIST_QUALITY_FAILED", dedupeKey: key, title, body, href: studioHref(id), contentFingerprint: `${quality.fingerprint}:${live ? "live" : "draft"}` });
  if (raised.outcome !== "UNCHANGED") return "RAISED";
  // The same things are still missing, so nothing is announced again — but the figures in the text (how many videos, how much context) may have
  // moved, and a standing notification must not describe a state that no longer exists.
  await refreshOpenNotificationText(key, { title, body });
  return "UNCHANGED";
}

/** For callers whose own work has already succeeded: a failure to update the notification must never undo or fail that work. */
export async function syncPlaylistQualityNotificationSafely(id: string): Promise<void> {
  try {
    await syncPlaylistQualityNotification(id);
  } catch (err) {
    console.error("Playlist quality notification could not be updated:", err instanceof Error ? err.message : "unknown error");
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Publication
// ---------------------------------------------------------------------------------------------------------------------------------

export async function publishPlaylistPage(input: { id: string; expectedVersion: number; actorId: string }): Promise<PlaylistPage> {
  let failure: PlaylistQualityError | null = null;
  let published: PlaylistPage | null = null;
  try {
    published = await prisma.$transaction(async (tx) => {
      await lockEditablePlaylist(tx, input.id);
      const page = await tx.playlistPage.findUnique({ where: { id: input.id }, include: { items: { orderBy: [{ position: "asc" }, { id: "asc" }], select: { videoPageId: true, note: true } } } });
      if (!page) throw new PlaylistNotFoundError();
      if (page.version !== input.expectedVersion) throw new PlaylistConflictError();
      // Exactly once per version: publishing the same unchanged draft again is a no-op, not a second history entry.
      if (page.status === "PUBLISHED" && page.publishedVersion === page.version) return page;

      const quality = await evaluateDraftQuality(page.id, tx);
      if (!quality.passed) throw new PlaylistQualityError(quality);

      const memberIds = page.items.map((i) => i.videoPageId);
      // The editor's per-member notes, as published: the public page reads THESE, so a later draft edit never changes what visitors see.
      const memberNotes = Object.fromEntries(page.items.filter((i) => i.note).map((i) => [i.videoPageId, i.note as string]));
      const contextTexts = await activeContextTexts(tx, page.id);
      const now = new Date();
      // `publishedTitleKey` is unique: if another page went live under this title a moment ago, this update fails and is reported as a title conflict.
      const updated = await tx.playlistPage.update({
        where: { id: page.id },
        data: {
          status: "PUBLISHED",
          publishedTitle: page.title,
          publishedTitleKey: titleKeyOf(page.title),
          publishedSummary: page.summary,
          publishedBody: page.body,
          publishedSeoTitle: page.seoTitle,
          publishedSeoDescription: page.seoDescription,
          publishedMemberIds: memberIds,
          publishedMemberNotes: memberNotes as Prisma.InputJsonValue,
          publishedContextTexts: contextTexts as Prisma.InputJsonValue,
          publishedVersion: page.version,
          publishedAt: now,
          publishedById: input.actorId,
        },
      });
      await tx.playlistPagePublication.create({
        data: {
          playlistPageId: page.id,
          kind: "PUBLISHED",
          version: page.version,
          actorId: input.actorId,
          snapshot: { title: page.title, summary: page.summary, body: page.body, seoTitle: page.seoTitle, seoDescription: page.seoDescription, memberIds, memberNotes, contextTexts, qualityPassed: true },
        },
      });
      await writeAuditLog({ actorId: input.actorId, action: "PLAYLIST_PAGE_PUBLISHED", entityType: "PlaylistPage", entityId: page.id, beforeSnapshot: { status: page.status }, afterSnapshot: { status: "PUBLISHED", version: page.version, members: memberIds.length } }, tx);
      return updated;
    });
  } catch (err) {
    if (err instanceof PlaylistQualityError) failure = err;
    else if (isUniqueConstraintViolation(err)) {
      // Another page was published under this title at the same moment and won. Report it like any other quality failure (the page stays a draft).
      const result = await evaluateDraftQuality(input.id);
      if (result.passed) throw new PlaylistConflictError();
      failure = new PlaylistQualityError(result);
    } else throw err;
  }

  if (failure) {
    // The page stays a draft. One notification per distinct set of failing checks; an unchanged repeat does not notify again.
    await syncPlaylistQualityNotificationSafely(input.id);
    throw failure;
  }
  await resolveNotification(PLAYLIST_FAILED_DEDUPE(input.id), "The playlist page was published.");
  await resolveNotification(PLAYLIST_REGRESSION_DEDUPE(input.id), "The playlist page was re-published and passes its checks.");
  return published!;
}

/** Takes a published page offline inside the caller's transaction (the page row must be locked). The snapshot is kept as history; the public site reads it only while PUBLISHED. */
async function unpublishIn(tx: Prisma.TransactionClient, page: PlaylistPage, actorId: string): Promise<boolean> {
  if (page.status !== "PUBLISHED") return false;
  await tx.playlistPage.update({ where: { id: page.id }, data: { status: "DRAFT", publishedTitleKey: null } });
  await tx.playlistPagePublication.create({ data: { playlistPageId: page.id, kind: "UNPUBLISHED", version: page.publishedVersion ?? page.version, actorId, snapshot: { title: page.publishedTitle } } });
  await writeAuditLog({ actorId, action: "PLAYLIST_PAGE_UNPUBLISHED", entityType: "PlaylistPage", entityId: page.id, beforeSnapshot: { status: "PUBLISHED" }, afterSnapshot: { status: "DRAFT" } }, tx);
  return true;
}

export async function unpublishPlaylistPage(input: { id: string; actorId: string }): Promise<boolean> {
  const done = await prisma.$transaction(async (tx) => {
    await lockPlaylist(tx, input.id);
    const page = await tx.playlistPage.findUnique({ where: { id: input.id } });
    if (!page) throw new PlaylistNotFoundError();
    return unpublishIn(tx, page, input.actorId);
  });
  if (done) await resolveNotification(PLAYLIST_REGRESSION_DEDUPE(input.id), "The playlist page was unpublished.");
  return done;
}

/**
 * Archives a page: unpublish (if live), archive and audit in ONE transaction under the page's row lock. A publish that raced with this either commits
 * first (and is then unpublished here) or waits and is refused as archived, so the page can never end up both live and archived.
 */
export async function archivePlaylistPage(input: { id: string; actorId: string }): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await lockPlaylist(tx, input.id);
    const page = await tx.playlistPage.findUnique({ where: { id: input.id } });
    if (!page) throw new PlaylistNotFoundError();
    if (page.archivedAt) return;
    await unpublishIn(tx, page, input.actorId);
    await tx.playlistPage.update({ where: { id: page.id }, data: { archivedAt: new Date(), status: "DRAFT", publishedTitleKey: null, updatedById: input.actorId } });
    await writeAuditLog({ actorId: input.actorId, action: "PLAYLIST_PAGE_ARCHIVED", entityType: "PlaylistPage", entityId: page.id }, tx);
  });
  await resolveNotification(PLAYLIST_REGRESSION_DEDUPE(input.id), "The playlist page was archived.");
  await resolveNotification(PLAYLIST_FAILED_DEDUPE(input.id), "The playlist page was archived.");
}

/** Restores an archived page as a DRAFT: restoring never republishes anything, so it must pass the checks and be published again by a person. */
export async function unarchivePlaylistPage(input: { id: string; actorId: string }): Promise<void> {
  const restored = await prisma.$transaction(async (tx) => {
    await lockPlaylist(tx, input.id);
    const page = await tx.playlistPage.findUnique({ where: { id: input.id } });
    if (!page) throw new PlaylistNotFoundError();
    if (!page.archivedAt) return false;
    await tx.playlistPage.update({ where: { id: page.id }, data: { archivedAt: null, status: "DRAFT", publishedTitleKey: null, updatedById: input.actorId } });
    await writeAuditLog({ actorId: input.actorId, action: "PLAYLIST_PAGE_UNARCHIVED", entityType: "PlaylistPage", entityId: page.id }, tx);
    return true;
  });
  if (restored) await syncPlaylistQualityNotificationSafely(input.id);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Revalidation of live pages after material change
// ---------------------------------------------------------------------------------------------------------------------------------

export interface PlaylistSweepResult {
  /** Published pages checked, and how many of them regressed or recovered. */
  checked: number;
  regressions: number;
  recovered: number;
  /** "Cannot be published yet" notifications re-checked, and how many of those re-checks failed. */
  notificationsChecked: number;
  notificationFailures: number;
  /** Batches processed and failed across both phases; `completed` is false when any failed or the deadline was reached. */
  batches: number;
  failedBatches: number;
  completed: boolean;
}

/** A technical bound: published pages (or notifications) handled per batch. Pages are read in a stable order by id, so no page is skipped or repeated. */
export const PLAYLIST_SWEEP_BATCH = 50;

const EXPOSURE_FACTS_SELECT = {
  id: true,
  status: true,
  archivedAt: true,
  unlistedPublicationApprovedAt: true,
  youtubeVideo: { select: { privacyStatus: true, observabilityState: true, exposureReview: { select: { holdReason: true } } } },
  exposureApprovals: { where: { revokedAt: null }, select: { scope: true, playlistPageId: true } },
} satisfies Prisma.YouTubeVideoPageSelect;

type ExposureRow = Prisma.YouTubeVideoPageGetPayload<{ select: typeof EXPOSURE_FACTS_SELECT }>;

/** The shared eligibility facts, for evaluating MANY pages' members in memory with the pure rule (isVideoExposed), which a parity test proves equals the SQL one. */
function exposureFactsOf(row: ExposureRow): VideoExposureFacts {
  return {
    page: { status: row.status, archivedAt: row.archivedAt, unlistedPublicationApprovedAt: row.unlistedPublicationApprovedAt },
    youtubeVideo: { privacyStatus: row.youtubeVideo.privacyStatus, observabilityState: row.youtubeVideo.observabilityState },
    activeApprovals: row.exposureApprovals.map((a) => ({ scope: a.scope, playlistPageId: a.playlistPageId })),
    hold: (row.youtubeVideo.exposureReview?.holdReason ?? null) as ExposureHoldName | null,
  };
}

const stringList = (value: unknown): string[] | null => (Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : null);

/**
 * Re-checks every PUBLISHED page against the rubric, judged by its PUBLISHED SNAPSHOT (the published title, summary, search description and context)
 * and by what visitors can currently see of its published members. It never reads draft text, and never compares a live page with another page's
 * draft (a live title is unique by construction). A page that no longer passes (an approval revoked, a video made private, a threshold raised) raises
 * one deduplicated warning; one that passes again resolves it. It never unpublishes anything by itself.
 *
 * It runs in bounded batches in a stable order, with the members of a whole batch evaluated from ONE query, so the cost grows with the number of
 * batches, not pages × queries. A failing batch is counted and left for the next run; the result says whether everything completed.
 */
export async function runPlaylistQualitySweep(options: { batchSize?: number; deadline?: Date } = {}): Promise<PlaylistSweepResult> {
  const batchSize = options.batchSize ?? PLAYLIST_SWEEP_BATCH;
  const config = await loadQualityConfig();
  const result: PlaylistSweepResult = { checked: 0, regressions: 0, recovered: 0, notificationsChecked: 0, notificationFailures: 0, batches: 0, failedBatches: 0, completed: true };
  const pastDeadline = () => options.deadline !== undefined && Date.now() > options.deadline.getTime();

  // Phase 1: the live pages.
  let cursor: string | undefined;
  for (;;) {
    if (pastDeadline()) {
      result.completed = false;
      return result;
    }
    // Keyset pagination (id greater than the last one handled): stable however the set changes while it is processed.
    const pages = await prisma.playlistPage.findMany({ where: { status: "PUBLISHED", archivedAt: null, ...(cursor ? { id: { gt: cursor } } : {}) }, orderBy: { id: "asc" }, take: batchSize });
    if (pages.length === 0) break;
    result.batches += 1;
    cursor = pages[pages.length - 1].id;
    try {
      const memberIdsByPage = new Map(pages.map((p) => [p.id, stringList(p.publishedMemberIds) ?? []]));
      const allIds = [...new Set([...memberIdsByPage.values()].flat())];
      const rows = allIds.length === 0 ? [] : await prisma.youTubeVideoPage.findMany({ where: { id: { in: allIds } }, select: EXPOSURE_FACTS_SELECT });
      const factsById = new Map(rows.map((r) => [r.id, exposureFactsOf(r)]));
      for (const page of pages) {
        const memberIds = memberIdsByPage.get(page.id) ?? [];
        const eligible = memberIds.filter((id) => {
          const facts = factsById.get(id);
          return facts !== undefined && isVideoExposed(facts, { kind: "PLAYLIST", playlistPageId: page.id });
        }).length;
        const quality = evaluatePlaylistQuality(
          {
            title: page.publishedTitle ?? page.title,
            summary: page.publishedSummary,
            seoDescription: page.publishedSeoDescription,
            eligibleMemberCount: eligible,
            totalMemberCount: memberIds.length,
            contextTexts: stringList(page.publishedContextTexts), // null for a page published before this was recorded: not judged
            titleTakenByAnotherPage: false, // a live title is unique: publishedTitleKey is a unique index
          },
          config
        );
        result.checked += 1;
        if (quality.passed) {
          if (await resolveNotification(PLAYLIST_REGRESSION_DEDUPE(page.id), "The playlist page meets its checks again.")) result.recovered += 1;
          continue;
        }
        result.regressions += 1;
        await raiseNotification({
          kind: "PLAYLIST_QUALITY_REGRESSION",
          dedupeKey: PLAYLIST_REGRESSION_DEDUPE(page.id),
          title: `“${(page.publishedTitle ?? page.title).slice(0, 100)}” no longer meets the publication checks`,
          body: `${quality.failing.map((c) => `• ${c.detail}`).join("\n")}\n\nThe page is still live. Fix the above or unpublish it.`,
          href: studioHref(page.id),
          contentFingerprint: quality.fingerprint,
        });
      }
    } catch (err) {
      result.failedBatches += 1;
      result.completed = false;
      console.error(`Playlist page checks: batch ${result.batches} failed and will be retried by the next run:`, err instanceof Error ? err.name : "unknown error");
    }
    if (pages.length < batchSize) break;
  }

  // Phase 2: "cannot be published yet" notifications are re-checked too, so a threshold changed in settings (or an approval changed elsewhere) cannot
  // leave one standing for a draft that now passes, or describing what is no longer missing. They are visited in id order in batches; each one that
  // no longer applies (page archived or gone, draft now passing) is resolved by the re-check, so it does not recur.
  let notificationCursor: string | undefined;
  for (;;) {
    if (pastDeadline()) {
      result.completed = false;
      return result;
    }
    const rows = await prisma.studioNotification.findMany({ where: { kind: "PLAYLIST_QUALITY_FAILED", ...(notificationCursor ? { id: { gt: notificationCursor } } : {}) }, select: { id: true, dedupeKey: true }, orderBy: { id: "asc" }, take: batchSize });
    if (rows.length === 0) break;
    result.batches += 1;
    notificationCursor = rows[rows.length - 1].id;
    for (const n of rows) {
      const id = n.dedupeKey.slice(PLAYLIST_FAILED_DEDUPE("").length);
      if (!id) continue;
      try {
        await syncPlaylistQualityNotification(id);
        result.notificationsChecked += 1;
      } catch (err) {
        result.notificationFailures += 1;
        result.completed = false;
        console.error("Playlist quality notification could not be re-checked:", err instanceof Error ? err.name : "unknown error");
      }
    }
    if (rows.length < batchSize) break;
  }
  return result;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Reads: Studio
// ---------------------------------------------------------------------------------------------------------------------------------

export interface StudioPlaylistMember {
  item: PlaylistPageItem;
  page: YouTubeVideoPage;
  video: YouTubeVideo;
  /** Whether the Museum may show this member on THIS playlist page right now. */
  shown: boolean;
  /** Why not (or "" when shown) — for the editor. */
  whyNot: string;
  playlistApproval: VideoExposureApproval | null;
}

export interface StudioPlaylistView {
  page: PlaylistPage;
  members: StudioPlaylistMember[];
  quality: PlaylistQualityResult;
  orphanApprovals: Array<{ approval: VideoExposureApproval; title: string | null }>;
  publications: Array<{ id: string; kind: string; version: number; createdAt: Date }>;
}

function whyNotShown(video: YouTubeVideo, page: YouTubeVideoPage, hasPlaylistApproval: boolean, hasPageApproval: boolean): string {
  if (video.observabilityState !== "OBSERVED") return "The video is not currently available on YouTube.";
  if (page.status !== "PUBLISHED" || page.archivedAt) return "The video's page is not published.";
  if (video.privacyStatus === "public") return "";
  if (video.privacyStatus === "unlisted") {
    if (!hasPageApproval) return "Unlisted on YouTube: its page has not been approved for the public Museum yet.";
    if (!hasPlaylistApproval) return "Unlisted on YouTube: not yet approved for this playlist page.";
    return "";
  }
  return "The video is private on YouTube and can never be shown.";
}

export async function loadPlaylistForStudio(id: string): Promise<StudioPlaylistView | null> {
  const page = await prisma.playlistPage.findUnique({ where: { id }, include: { items: { orderBy: [{ position: "asc" }, { id: "asc" }], include: { videoPage: { include: { youtubeVideo: true, exposureApprovals: { where: { revokedAt: null } } } } } } } });
  if (!page) return null;
  const eligible = await eligibleVideoPageIds(prisma, id, page.items.map((i) => i.videoPageId));
  const members: StudioPlaylistMember[] = page.items.map(({ videoPage, ...item }) => {
    const { youtubeVideo, exposureApprovals, ...vp } = videoPage;
    const playlistApproval = exposureApprovals.find((a) => a.scope === "PLAYLIST" && a.playlistPageId === id) ?? null;
    const shown = eligible.has(vp.id);
    return { item, page: vp, video: youtubeVideo, shown, whyNot: shown ? "" : whyNotShown(youtubeVideo, vp, playlistApproval !== null, exposureApprovals.some((a) => a.scope === "PAGE")), playlistApproval };
  });
  const memberIds = new Set(page.items.map((i) => i.videoPageId));
  const orphans = await prisma.videoExposureApproval.findMany({ where: { scope: "PLAYLIST", playlistPageId: id, revokedAt: null, videoPageId: { notIn: [...memberIds] } }, include: { videoPage: { include: { youtubeVideo: { select: { title: true } } } } } });
  const publications = await prisma.playlistPagePublication.findMany({ where: { playlistPageId: id }, orderBy: { createdAt: "desc" }, select: { id: true, kind: true, version: true, createdAt: true } });
  const { items: _items, ...bare } = page;
  void _items;
  return {
    page: bare,
    members,
    quality: await evaluateDraftQuality(id),
    orphanApprovals: orphans.map(({ videoPage, ...approval }) => ({ approval, title: videoPage.youtubeVideo.title })),
    publications,
  };
}

export interface StudioPlaylistRow {
  id: string;
  title: string;
  status: PlaylistPage["status"];
  archived: boolean;
  version: number;
  publishedVersion: number | null;
  memberCount: number;
}

export async function listPlaylistPagesForStudio(): Promise<StudioPlaylistRow[]> {
  const rows = await prisma.playlistPage.findMany({ orderBy: [{ archivedAt: { sort: "asc", nulls: "first" } }, { updatedAt: "desc" }], include: { _count: { select: { items: true } } }, take: 500 });
  return rows.map((r) => ({ id: r.id, title: r.title, status: r.status, archived: r.archivedAt !== null, version: r.version, publishedVersion: r.publishedVersion, memberCount: r._count.items }));
}

/** Synced YouTube playlists that have no playlist page yet (to start one from). */
export async function listYouTubePlaylistsWithoutPage(): Promise<Array<{ id: string; title: string | null; itemCount: number }>> {
  const rows = await prisma.youTubePlaylist.findMany({ where: { playlistPage: null, observabilityState: "OBSERVED" }, orderBy: { title: "asc" }, include: { _count: { select: { items: true } } }, take: 500 });
  return rows.map((r) => ({ id: r.id, title: r.title, itemCount: r._count.items }));
}

/** Video pages that could be added to a playlist page (not already members), newest first. */
export async function listAddableVideoPages(playlistPageId: string, limit = 300): Promise<Array<{ pageId: string; title: string | null; status: string; privacy: string | null }>> {
  const rows = await prisma.youTubeVideoPage.findMany({
    where: { archivedAt: null, playlistItems: { none: { playlistPageId } } },
    select: { id: true, status: true, youtubeVideo: { select: { title: true, privacyStatus: true } } },
    orderBy: [{ youtubeVideo: { publishedAt: { sort: "desc", nulls: "last" } } }, { id: "asc" }],
    take: limit,
  });
  return rows.map((r) => ({ pageId: r.id, title: r.youtubeVideo.title, status: r.status, privacy: r.youtubeVideo.privacyStatus }));
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Reads: public (published snapshot only; members through the shared PLAYLIST-surface rule)
// ---------------------------------------------------------------------------------------------------------------------------------

export interface PublicPlaylistMember {
  page: YouTubeVideoPage;
  video: YouTubeVideo;
  note: string | null;
}

export interface PublicPlaylistPage {
  slug: string;
  title: string;
  summary: string | null;
  body: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  /** When the CURRENT published version went live. Draft edits never change it. */
  publishedAt: Date | null;
  members: PublicPlaylistMember[];
}

/** The per-member notes as published ({ videoPageId: note }); a page published before notes were part of the snapshot has none (a draft note is never shown instead). */
function publishedNotes(value: unknown): Map<string, string> {
  const out = new Map<string, string>();
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    for (const [id, note] of Object.entries(value as Record<string, unknown>)) if (typeof note === "string" && note.trim() !== "") out.set(id, note);
  }
  return out;
}

async function publicMembers(playlist: Pick<PlaylistPage, "id" | "publishedMemberIds" | "publishedMemberNotes">): Promise<PublicPlaylistMember[]> {
  const ids = Array.isArray(playlist.publishedMemberIds) ? (playlist.publishedMemberIds as string[]) : [];
  if (ids.length === 0) return [];
  const rows = await prisma.youTubeVideoPage.findMany({ where: { AND: [{ id: { in: ids } }, exposedVideoPageWhere({ kind: "PLAYLIST", playlistPageId: playlist.id })] }, include: { youtubeVideo: true } });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const notes = publishedNotes(playlist.publishedMemberNotes);
  const out: PublicPlaylistMember[] = [];
  for (const id of ids) {
    const row = byId.get(id);
    if (!row) continue;
    const { youtubeVideo, ...page } = row;
    out.push({ page, video: youtubeVideo, note: notes.get(id) ?? null });
  }
  return out;
}

/** The only sanctioned public lookup: a published, non-archived page with at least one member visitors may see. Reads the published snapshot only; never the draft. */
export async function findPublishedPlaylistBySlug(slug: string): Promise<PublicPlaylistPage | null> {
  const page = await prisma.playlistPage.findUnique({ where: { slug } });
  if (!page || page.status !== "PUBLISHED" || page.archivedAt !== null || page.publishedTitle === null) return null;
  const members = await publicMembers(page);
  if (members.length === 0) return null;
  return { slug: page.slug, title: page.publishedTitle, summary: page.publishedSummary, body: page.publishedBody, seoTitle: page.publishedSeoTitle, seoDescription: page.publishedSeoDescription, publishedAt: page.publishedAt, members };
}

export interface PublicPlaylistSummary {
  slug: string;
  title: string;
  summary: string | null;
  /** When the current published version went live: what the sitemap reports as `lastmod`. Draft edits never change it. */
  lastModified: Date;
  memberCount: number;
  thumbnailUrl: string | null;
}

export async function listPublishedPlaylistPages(limit = 200): Promise<PublicPlaylistSummary[]> {
  const pages = await prisma.playlistPage.findMany({ where: { status: "PUBLISHED", archivedAt: null, publishedTitle: { not: null } }, orderBy: [{ publishedAt: { sort: "desc", nulls: "last" } }, { id: "asc" }], take: limit });
  const out: PublicPlaylistSummary[] = [];
  for (const page of pages) {
    const members = await publicMembers(page);
    if (members.length === 0) continue;
    out.push({ slug: page.slug, title: page.publishedTitle!, summary: page.publishedSummary, lastModified: page.publishedAt ?? page.createdAt, memberCount: members.length, thumbnailUrl: members[0].video.thumbnailUrl });
  }
  return out;
}

/** A technical bound on how many published pages the existence check looks at (it only needs ONE with a visible member). */
const PRESENCE_CHECK_PAGES = 25;

/**
 * Whether any published playlist page has a visitor-visible member (drives whether the Playlists link is shown). Runs on every public page view
 * through the Museum shell, so it is exactly two cheap queries however many playlist pages exist: one for the published pages' member ids, and one
 * `findFirst` across ALL of them at once with each page's own PLAYLIST-surface rule (the same fragment every list uses). It stops at the first hit
 * and loads no page content.
 */
export async function hasPublishedPlaylistPage(): Promise<boolean> {
  const pages = await prisma.playlistPage.findMany({
    where: { status: "PUBLISHED", archivedAt: null, publishedTitle: { not: null } },
    select: { id: true, publishedMemberIds: true },
    orderBy: [{ publishedAt: { sort: "desc", nulls: "last" } }, { id: "asc" }],
    take: PRESENCE_CHECK_PAGES,
  });
  const branches = pages.flatMap((page) => {
    const ids = Array.isArray(page.publishedMemberIds) ? (page.publishedMemberIds as string[]) : [];
    return ids.length === 0 ? [] : [{ AND: [{ id: { in: ids } }, exposedVideoPageWhere({ kind: "PLAYLIST" as const, playlistPageId: page.id })] }];
  });
  if (branches.length === 0) return false;
  return (await prisma.youTubeVideoPage.findFirst({ where: { OR: branches }, select: { id: true } })) !== null;
}