import type { Prisma } from "@prisma/client";

// Credits extraction, route 2: the read the staging export performs, written against a transaction client so it can be unit-tested with a fake
// one. It is READ-ONLY by construction:
//   1. its first statement is SET TRANSACTION READ ONLY, so PostgreSQL itself refuses any write for the rest of the transaction;
//   2. after that it only counts and selects (youTubeVideo.count, youTubeVideo.findMany): no create, update, upsert, delete or other raw SQL.
// The transaction is opened by videoCreditsExportRepository.ts; this file never imports the database client.

/** One exported video as read: what the description-reading session will see. */
export interface VideoCreditsExportRow {
  youtubeVideoId: string;
  title: string | null;
  description: string | null;
  publishedAt: Date | null;
  playlistTitles: Array<string | null>;
}

export const READ_ONLY_STATEMENT = "SET TRANSACTION READ ONLY";

/** Public, still listed (OBSERVED in the latest sync), with a description that is not empty. Whitespace-only descriptions are dropped later. */
export const VIDEO_CREDITS_EXPORT_WHERE = {
  privacyStatus: "public",
  observabilityState: "OBSERVED",
  description: { not: null },
  NOT: [{ description: "" }],
} satisfies Prisma.YouTubeVideoWhereInput;

/** Stable order, so --limit / --offset batches do not overlap while the data is unchanged. */
export const VIDEO_CREDITS_EXPORT_ORDER = [{ publishedAt: "asc" }, { youtubeVideoId: "asc" }] satisfies Prisma.YouTubeVideoOrderByWithRelationInput[];

/** Playlist titles come only from memberships and playlists that are observed, and from public playlists. */
export const VIDEO_CREDITS_EXPORT_SELECT = {
  youtubeVideoId: true,
  title: true,
  description: true,
  publishedAt: true,
  playlistItems: {
    where: { observabilityState: "OBSERVED", playlist: { observabilityState: "OBSERVED", privacyStatus: "public" } },
    select: { playlist: { select: { title: true } } },
  },
} satisfies Prisma.YouTubeVideoSelect;

/** The part of a transaction client this read may use. */
export type VideoCreditsExportClient = Pick<Prisma.TransactionClient, "$executeRawUnsafe" | "youTubeVideo">;

export async function readVideoCreditsExportBatch(
  tx: VideoCreditsExportClient,
  options: { limit: number | null; offset: number }
): Promise<{ totalMatching: number; rows: VideoCreditsExportRow[] }> {
  await tx.$executeRawUnsafe(READ_ONLY_STATEMENT);
  const totalMatching = await tx.youTubeVideo.count({ where: VIDEO_CREDITS_EXPORT_WHERE });
  const found = await tx.youTubeVideo.findMany({
    where: VIDEO_CREDITS_EXPORT_WHERE,
    orderBy: VIDEO_CREDITS_EXPORT_ORDER,
    skip: options.offset,
    ...(options.limit === null ? {} : { take: options.limit }),
    select: VIDEO_CREDITS_EXPORT_SELECT,
  });
  return {
    totalMatching,
    rows: found.map((v) => ({
      youtubeVideoId: v.youtubeVideoId,
      title: v.title,
      description: v.description,
      publishedAt: v.publishedAt,
      playlistTitles: v.playlistItems.map((item) => item.playlist.title),
    })),
  };
}
