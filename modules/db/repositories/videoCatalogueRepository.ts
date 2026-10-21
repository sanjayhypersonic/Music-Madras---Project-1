import { exposedVideoPageWhere } from "../../mmke/catalogue/videoExposureQuery";
import { SEARCH_MAX_LENGTH, escapeLikePattern, normaliseSearchText } from "../../mmke/search/searchText";
import { prisma } from "../client";
import type { Prisma, YouTubeVideo, YouTubeVideoPage } from "@prisma/client";

// Phase 6K-3 — the public /videos catalogue. A DISCOVERY surface: every row is selected by exposedVideoPageWhere({kind:"DISCOVERY"}), the SQL twin
// of isVideoExposed (parity-tested), so an unlisted video appears here only with its own recorded listing approval, and never when private,
// unavailable, draft, archived or on a rights hold. Filtering, ordering and pagination all happen in the database, bounded by `pageSize`.

export type VideoCatalogueSort = "newest" | "mostViewed";

export interface VideoCatalogueQuery {
  q?: string;
  page: number;
  pageSize: number;
  sort: VideoCatalogueSort;
}

export interface VideoCatalogueItem {
  page: YouTubeVideoPage;
  youtubeVideo: YouTubeVideo;
}

export interface VideoCataloguePage {
  items: VideoCatalogueItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export const VIDEO_SEARCH_MAX_LENGTH = SEARCH_MAX_LENGTH;

export function normaliseVideoSearch(raw: string | undefined): string | undefined {
  return normaliseSearchText(raw);
}

export function normaliseVideoSort(raw: string | undefined): VideoCatalogueSort {
  return raw === "mostViewed" ? "mostViewed" : "newest";
}

// Prisma's `contains` does not escape LIKE wildcards: the shared search preparation (modules/mmke/search/searchText.ts) makes "%" and "_" literal.
export { escapeLikePattern };

function catalogueWhere(rawQuery: string | undefined): Prisma.YouTubeVideoPageWhereInput {
  const base = exposedVideoPageWhere({ kind: "DISCOVERY" });
  if (!rawQuery) return base;
  const q = escapeLikePattern(rawQuery);
  return {
    AND: [
      base,
      { OR: [{ youtubeVideo: { title: { contains: q, mode: "insensitive" } } }, { youtubeVideo: { description: { contains: q, mode: "insensitive" } } }] },
    ],
  };
}

function orderFor(sort: VideoCatalogueSort): Prisma.YouTubeVideoPageOrderByWithRelationInput[] {
  const newest: Prisma.YouTubeVideoPageOrderByWithRelationInput = { youtubeVideo: { publishedAt: { sort: "desc", nulls: "last" } } };
  const views: Prisma.YouTubeVideoPageOrderByWithRelationInput = { youtubeVideo: { currentViewCount: { sort: "desc", nulls: "last" } } };
  return sort === "mostViewed" ? [views, newest, { id: "asc" }] : [newest, { id: "asc" }];
}

export async function searchPublicVideoCatalogue(input: VideoCatalogueQuery): Promise<VideoCataloguePage> {
  const pageSize = Math.max(1, Math.min(100, Math.floor(input.pageSize)));
  const page = Math.max(1, Math.floor(input.page));
  const where = catalogueWhere(normaliseVideoSearch(input.q));
  const [total, rows] = await Promise.all([
    prisma.youTubeVideoPage.count({ where }),
    prisma.youTubeVideoPage.findMany({ where, include: { youtubeVideo: true }, orderBy: orderFor(input.sort), skip: (page - 1) * pageSize, take: pageSize }),
  ]);
  return { items: rows.map(({ youtubeVideo, ...p }) => ({ page: p, youtubeVideo })), total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

/** How many videos the catalogue lists in total (for navigation that appears only when there is something to show). */
export function countPublicCatalogueVideos(): Promise<number> {
  return prisma.youTubeVideoPage.count({ where: exposedVideoPageWhere({ kind: "DISCOVERY" }) });
}
