import { prisma } from "../client";
import { isRecordingPublished } from "../../mmke/catalogue/isRecordingPublished";

// Phase 6G-11 — app/sitemap.ts's sole data source for the four entity
// types that don't already have a public "list all" repository function
// (Composer/Artist/Choir/Conductor/Venue already have listActive*;
// Collection already has listPublishedCollections; Video already has
// listPublishedVideoPages). No new visibility system: every where-clause
// here is copied verbatim from modules/db/repositories/archiveSearchRepository.ts's
// equivalent search function (archivedAt-null for Work/Programme/Performance,
// isRecordingPublished — Phase 6G-5A — for Recording), never re-invented.

export interface SitemapSlugEntry {
  slug: string;
  updatedAt: Date;
}

export function listPublicWorkSitemapEntries(): Promise<SitemapSlugEntry[]> {
  return prisma.musicalWork.findMany({
    where: { archivedAt: null },
    select: { slug: true, updatedAt: true },
  });
}

export function listPublicProgrammeSitemapEntries(): Promise<SitemapSlugEntry[]> {
  return prisma.programme.findMany({
    where: { archivedAt: null },
    select: { slug: true, updatedAt: true },
  });
}

export function listPublicPerformanceSitemapEntries(): Promise<SitemapSlugEntry[]> {
  return prisma.performance.findMany({
    where: { archivedAt: null },
    select: { slug: true, updatedAt: true },
  });
}

/**
 * Recording: the where-clause's `status: "PUBLISHED"` is the same cheap
 * coarse filter searchRecordings uses; isRecordingPublished is re-applied
 * as the authoritative gate afterward — never a second, independently
 * invented publication rule.
 */
export async function listPublicRecordingSitemapEntries(): Promise<SitemapSlugEntry[]> {
  const rows = await prisma.recording.findMany({
    where: { status: "PUBLISHED" },
    select: { slug: true, updatedAt: true, status: true, currentPublishedRevisionId: true },
  });

  return rows.filter(isRecordingPublished).map((row) => ({ slug: row.slug, updatedAt: row.updatedAt }));
}
