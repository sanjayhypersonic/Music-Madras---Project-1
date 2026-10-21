import { writeAuditLog } from "../../audit/writeAuditLog";
import { exposedVideoPageWhere } from "../../mmke/catalogue/videoExposureQuery";
import { selectFeatured, type FeaturedSlot, type RankingCandidate } from "../../mmke/featured/featuredRanking";
import { FeaturedNotEligibleError, FeaturedNotFoundError } from "../../mmke/featured/featuredErrors";
import { prisma } from "../client";
import { isUniqueConstraintViolation } from "../isUniqueConstraintViolation";
import { loadResolvedSettings } from "./siteSettingRepository";
import type { FeaturedVideo, Prisma, YouTubeVideo, YouTubeVideoPage } from "@prisma/client";

// Phase 6K-3 — featured videos: editorial pins (table featured_videos) plus an automatic, explainable fill (modules/mmke/featured). Pinning and
// ordering change what visitors see, so the calling Server Actions need RECORDING_PUBLISH. A pin never overrides eligibility: the pinned list
// is filtered through the same DISCOVERY rule as every other listing (exposedVideoPageWhere), so a pinned video that stops being listable
// simply disappears from the public site (Studio shows it as "not currently shown", with the pin kept for when it returns).

/** A technical bound, not editorial: automatic fill ranks at most this many of the most-viewed and this many of the newest eligible videos. */
export const FEATURED_CANDIDATE_POOL = 300;

const DISCOVERY = exposedVideoPageWhere({ kind: "DISCOVERY" });

// Phase 6K lifecycle hardening (F16) — the pinned list is ONE ordered list (positions 1..n, unique in the database), so every change to it is
// serialised by one transaction-scoped advisory lock (released at commit or rollback; safe behind a transaction pooler). Without it two editors pinning
// at once both read the same "last position", and a move racing an unpin renumbers from a stale list. A reorder moves rows through a temporary position
// (0, never a real one) because positions are unique and PostgreSQL checks a unique index row by row.
const FEATURED_LIST_LOCK = "featured_videos:list";

async function lockFeaturedList(tx: Prisma.TransactionClient): Promise<void> {
  // The function returns `void`, which the query layer cannot deserialise, so its result is cast to text (it is ignored; the lock is the effect).
  await tx.$queryRaw`select pg_advisory_xact_lock(hashtextextended(${FEATURED_LIST_LOCK}, 0))::text as locked`;
}

export async function pinFeaturedVideo(input: { videoPageId: string; actorId: string; note?: string | null }): Promise<{ pinned: boolean }> {
  const note = input.note?.trim() ? input.note.trim().slice(0, 1000) : null;
  try {
    return await prisma.$transaction(async (tx) => {
      await lockFeaturedList(tx);
      const page = await tx.youTubeVideoPage.findUnique({ where: { id: input.videoPageId }, select: { id: true } });
      if (!page) throw new FeaturedNotFoundError();
      const eligible = await tx.youTubeVideoPage.findFirst({ where: { AND: [{ id: input.videoPageId }, DISCOVERY] }, select: { id: true } });
      if (!eligible) throw new FeaturedNotEligibleError();
      const existing = await tx.featuredVideo.findUnique({ where: { videoPageId: input.videoPageId }, select: { id: true } });
      if (existing) return { pinned: false }; // already featured
      const last = await tx.featuredVideo.aggregate({ _max: { position: true } });
      await tx.featuredVideo.create({ data: { videoPageId: input.videoPageId, position: (last._max.position ?? 0) + 1, note, pinnedById: input.actorId } });
      await writeAuditLog({ actorId: input.actorId, action: "FEATURED_VIDEO_PINNED", entityType: "YouTubeVideoPage", entityId: input.videoPageId, afterSnapshot: { note } }, tx);
      return { pinned: true };
    });
  } catch (err) {
    if (isUniqueConstraintViolation(err)) return { pinned: false }; // a concurrent pin of the same video won
    throw err;
  }
}

export async function unpinFeaturedVideo(input: { videoPageId: string; actorId: string }): Promise<{ unpinned: boolean }> {
  return prisma.$transaction(async (tx) => {
    await lockFeaturedList(tx);
    const row = await tx.featuredVideo.findUnique({ where: { videoPageId: input.videoPageId } });
    if (!row) return { unpinned: false };
    await tx.featuredVideo.delete({ where: { id: row.id } });
    // Each later pin moves up into a position that has just been freed, in ascending order, so the unique index is never tripped.
    const rest = await tx.featuredVideo.findMany({ orderBy: [{ position: "asc" }, { id: "asc" }], select: { id: true, position: true } });
    for (const [index, item] of rest.entries()) if (item.position !== index + 1) await tx.featuredVideo.update({ where: { id: item.id }, data: { position: index + 1 } });
    await writeAuditLog({ actorId: input.actorId, action: "FEATURED_VIDEO_UNPINNED", entityType: "YouTubeVideoPage", entityId: input.videoPageId, beforeSnapshot: { position: row.position } }, tx);
    return { unpinned: true };
  });
}

/** Moves a pin one place earlier or later and renumbers the list 1..n. Returns false when it is already at that end. */
export async function moveFeaturedVideo(input: { videoPageId: string; direction: "up" | "down"; actorId: string }): Promise<{ moved: boolean }> {
  return prisma.$transaction(async (tx) => {
    await lockFeaturedList(tx);
    const rows = await tx.featuredVideo.findMany({ orderBy: [{ position: "asc" }, { id: "asc" }], select: { id: true, videoPageId: true, position: true } });
    const index = rows.findIndex((r) => r.videoPageId === input.videoPageId);
    if (index === -1) throw new FeaturedNotFoundError();
    const target = input.direction === "up" ? index - 1 : index + 1;
    if (target < 0 || target >= rows.length) return { moved: false };
    // The two neighbours exchange the positions they hold, through the temporary position 0, so no third pin can collide.
    const [a, b] = [rows[index], rows[target]];
    await tx.featuredVideo.update({ where: { id: a.id }, data: { position: 0 } });
    await tx.featuredVideo.update({ where: { id: b.id }, data: { position: a.position } });
    await tx.featuredVideo.update({ where: { id: a.id }, data: { position: b.position } });
    await writeAuditLog({ actorId: input.actorId, action: "FEATURED_VIDEO_REORDERED", entityType: "YouTubeVideoPage", entityId: input.videoPageId, afterSnapshot: { direction: input.direction, position: target + 1 } }, tx);
    return { moved: true };
  });
}

export interface FeaturedEntry {
  slot: FeaturedSlot;
  page: YouTubeVideoPage;
  youtubeVideo: YouTubeVideo;
}

export interface PinnedRowStatus {
  row: FeaturedVideo;
  page: YouTubeVideoPage;
  youtubeVideo: YouTubeVideo;
  /** Whether the shared rule currently lets this video be listed (and therefore featured). */
  currentlyShown: boolean;
}

export interface FeaturedPlan {
  /** What the homepage shows now, in order. */
  entries: FeaturedEntry[];
  pinned: PinnedRowStatus[];
  settings: { count: number; autoFill: boolean; recencyWeightPercent: number; recencyHalfLifeDays: number };
}

async function loadCandidates(): Promise<Array<RankingCandidate & { id: string }>> {
  const select = { id: true, youtubeVideo: { select: { currentViewCount: true, publishedAt: true } } } as const;
  const [byViews, byNewest] = await Promise.all([
    prisma.youTubeVideoPage.findMany({ where: DISCOVERY, select, orderBy: [{ youtubeVideo: { currentViewCount: { sort: "desc", nulls: "last" } } }, { id: "asc" }], take: FEATURED_CANDIDATE_POOL }),
    prisma.youTubeVideoPage.findMany({ where: DISCOVERY, select, orderBy: [{ youtubeVideo: { publishedAt: { sort: "desc", nulls: "last" } } }, { id: "asc" }], take: FEATURED_CANDIDATE_POOL }),
  ]);
  const seen = new Map<string, RankingCandidate & { id: string }>();
  for (const row of [...byViews, ...byNewest]) {
    if (!seen.has(row.id)) seen.set(row.id, { id: row.id, pageId: row.id, viewCount: row.youtubeVideo.currentViewCount, publishedAt: row.youtubeVideo.publishedAt });
  }
  return [...seen.values()];
}

/** The complete picture for Studio and the homepage: settings, pins (with whether each is shown), and the resolved featured list. */
export async function loadFeaturedPlan(now: Date = new Date()): Promise<FeaturedPlan> {
  const settings = await loadResolvedSettings();
  const resolvedSettings = {
    count: settings.get("featured.homepage.count"),
    autoFill: settings.get("featured.autoFill.enabled"),
    recencyWeightPercent: settings.get("featured.autoFill.recencyWeightPercent"),
    recencyHalfLifeDays: settings.get("featured.autoFill.recencyHalfLifeDays"),
  };

  const pinnedRows = await prisma.featuredVideo.findMany({ orderBy: [{ position: "asc" }, { id: "asc" }], include: { videoPage: { include: { youtubeVideo: true } } } });
  const eligiblePinnedIds = new Set(
    pinnedRows.length === 0 ? [] : (await prisma.youTubeVideoPage.findMany({ where: { AND: [{ id: { in: pinnedRows.map((r) => r.videoPageId) } }, DISCOVERY] }, select: { id: true } })).map((p) => p.id)
  );
  const pinned: PinnedRowStatus[] = pinnedRows.map(({ videoPage, ...row }) => {
    const { youtubeVideo, ...page } = videoPage;
    return { row, page, youtubeVideo, currentlyShown: eligiblePinnedIds.has(row.videoPageId) };
  });

  const candidates = resolvedSettings.autoFill ? await loadCandidates() : [];
  const slots = selectFeatured({
    pinned: pinned.filter((p) => p.currentlyShown).map((p) => p.row.videoPageId),
    candidates,
    count: resolvedSettings.count,
    autoFill: resolvedSettings.autoFill,
    params: { halfLifeDays: resolvedSettings.recencyHalfLifeDays, recencyWeight: resolvedSettings.recencyWeightPercent / 100, now },
  });

  const pages = slots.length === 0 ? [] : await prisma.youTubeVideoPage.findMany({ where: { id: { in: slots.map((s) => s.pageId) } }, include: { youtubeVideo: true } });
  const byId = new Map(pages.map((p) => [p.id, p]));
  const entries: FeaturedEntry[] = [];
  for (const slot of slots) {
    const found = byId.get(slot.pageId);
    if (!found) continue;
    const { youtubeVideo, ...page } = found;
    entries.push({ slot, page, youtubeVideo });
  }
  return { entries, pinned, settings: resolvedSettings };
}

/** The homepage's featured videos: only ever videos the Museum may list. */
export async function getHomepageFeatured(now: Date = new Date()): Promise<FeaturedEntry[]> {
  return (await loadFeaturedPlan(now)).entries;
}

export interface PinCandidate {
  pageId: string;
  title: string | null;
}

/** Videos that could be pinned (eligible and not already pinned), most viewed first — for the Studio picker. */
export async function listPinCandidates(limit = 200): Promise<PinCandidate[]> {
  const rows = await prisma.youTubeVideoPage.findMany({
    where: { AND: [DISCOVERY, { featured: null }] },
    select: { id: true, youtubeVideo: { select: { title: true } } },
    orderBy: [{ youtubeVideo: { currentViewCount: { sort: "desc", nulls: "last" } } }, { id: "asc" }],
    take: limit,
  });
  return rows.map((r) => ({ pageId: r.id, title: r.youtubeVideo.title }));
}
