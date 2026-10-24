import { prisma } from "../client";
import { isRecordingPubliclyVisible } from "../../mmke/catalogue/isRecordingPublished";
import {
  PUBLIC_RECORDING_WHERE,
  eligibleArtistWhere,
  eligibleChoirWhere,
  eligibleComposerWhere,
  eligibleConductorWhere,
  eligibleOrganisationWhere,
  eligiblePerformanceWhere,
  eligibleProgrammeWhere,
  eligibleVenueWhere,
  eligibleWorkWhere,
} from "./publicEligibility";

// app/sitemap.ts's sole data source for the catalogue entity types.
//
// Phase 6J-1: no entity is listed merely because it exists. Each list uses
// the SAME eligibility fragment (publicEligibility.ts) as the entity's own
// public page and as archive search, so the sitemap, search and a direct URL
// can never disagree: a draft-only or orphan entity is in none of them, and a
// listed URL always resolves. Recording uses isRecordingPublished
// (Phase 6G-5A); Collection, LearningGuide and video pages keep their own
// existing public gates (listPublishedCollections etc.).

export interface SitemapSlugEntry {
  slug: string;
  updatedAt: Date;
}

const slugEntry = { slug: true, updatedAt: true } as const;

export function listPublicComposerSitemapEntries(): Promise<SitemapSlugEntry[]> {
  return prisma.composer.findMany({ where: eligibleComposerWhere, select: slugEntry });
}

export function listPublicArtistSitemapEntries(): Promise<SitemapSlugEntry[]> {
  return prisma.artist.findMany({ where: eligibleArtistWhere, select: slugEntry });
}

export function listPublicChoirSitemapEntries(): Promise<SitemapSlugEntry[]> {
  return prisma.choir.findMany({ where: eligibleChoirWhere, select: slugEntry });
}

export function listPublicConductorSitemapEntries(): Promise<SitemapSlugEntry[]> {
  return prisma.conductor.findMany({ where: eligibleConductorWhere, select: slugEntry });
}

export function listPublicVenueSitemapEntries(): Promise<SitemapSlugEntry[]> {
  return prisma.venue.findMany({ where: eligibleVenueWhere, select: slugEntry });
}

export function listPublicOrganisationSitemapEntries(): Promise<SitemapSlugEntry[]> {
  return prisma.organisation.findMany({ where: eligibleOrganisationWhere, select: slugEntry });
}

export function listPublicWorkSitemapEntries(): Promise<SitemapSlugEntry[]> {
  return prisma.musicalWork.findMany({ where: eligibleWorkWhere, select: slugEntry });
}

export function listPublicProgrammeSitemapEntries(): Promise<SitemapSlugEntry[]> {
  return prisma.programme.findMany({ where: eligibleProgrammeWhere, select: slugEntry });
}

export function listPublicPerformanceSitemapEntries(): Promise<SitemapSlugEntry[]> {
  return prisma.performance.findMany({ where: eligiblePerformanceWhere, select: slugEntry });
}

/**
 * Recording: the where-clause is the SQL twin of isRecordingPubliclyVisible
 * (PUBLISHED and not held, R-20) and the function is re-applied as the
 * authoritative gate afterward — never a second, independently
 * invented publication rule.
 */
export async function listPublicRecordingSitemapEntries(): Promise<SitemapSlugEntry[]> {
  const rows = await prisma.recording.findMany({
    where: PUBLIC_RECORDING_WHERE,
    select: { slug: true, updatedAt: true, status: true, currentPublishedRevisionId: true, holdReason: true },
  });

  return rows.filter(isRecordingPubliclyVisible).map((row) => ({ slug: row.slug, updatedAt: row.updatedAt }));
}
