import type { Prisma, WorkContributorRole } from "@prisma/client";
import { prisma } from "../client";
import { isPlausibleSlug } from "../../mmke/slug/isPlausibleSlug";
import { eligibleArtistWhere, eligibleComposerWhere, eligibleConductorWhere, eligiblePerformanceWhere, eligibleWorkWhere } from "./publicEligibility";
import { resolveRelatedContent, type RelatedContent } from "./entityRelationshipsRepository";
import { assemblePersonPageParts } from "../../mmke/people/personPage";

// R-34: the public person and ensemble pages (/people/[slug], /arrangers/[slug], /lyricists/[slug], /ensembles/[slug]). Same visibility rule as
// every other catalogue page (publicEligibility.ts): an entity is public only while some PUBLISHED, not-held Recording reaches it. A person is
// reachable through any of their roles: composer (works composed or co-composed), arranger, lyricist or translator (MusicalWorkContributor),
// conductor, or performer. The page itself is assembled by modules/mmke/people/personPage.ts (pure, unit-tested).

export const eligiblePersonWhere: Prisma.PersonWhereInput = {
  archivedAt: null,
  OR: [
    { composers: { some: eligibleComposerWhere } },
    { conductors: { some: eligibleConductorWhere } },
    { artists: { some: eligibleArtistWhere } },
    { workContributions: { some: { musicalWork: eligibleWorkWhere } } },
  ],
};

export const eligibleEnsembleWhere: Prisma.EnsembleWhereInput = {
  archivedAt: null,
  performances: { some: { performance: eligiblePerformanceWhere } },
};

export interface PersonPageData {
  id: string;
  slug: string;
  name: string;
  biography: string | null;
  /** The public role records of this person, each with its own page. */
  roles: Array<{ role: "Composer" | "Conductor" | "Performer"; name: string; href: string }>;
  contributions: Array<{ role: WorkContributorRole; workTitle: string; workHref: string }>;
  related: RelatedContent;
}

export async function getPersonPageData(slug: string, onlyRole?: WorkContributorRole): Promise<PersonPageData | null> {
  if (!isPlausibleSlug(slug)) return null;
  const person = await prisma.person.findFirst({
    where: { AND: [{ slug }, eligiblePersonWhere, ...(onlyRole ? [{ workContributions: { some: { role: onlyRole, musicalWork: eligibleWorkWhere } } }] : [])] },
    include: {
      composers: { where: eligibleComposerWhere, select: { slug: true, name: true, works: { where: eligibleWorkWhere, select: { id: true } }, workCredits: { where: { work: eligibleWorkWhere }, select: { work: { select: { id: true } } } } } },
      conductors: { where: eligibleConductorWhere, select: { slug: true, name: true, performances: { select: { performanceId: true } } } },
      artists: { where: eligibleArtistWhere, select: { slug: true, name: true, performances: { select: { performanceId: true } } } },
      workContributions: { where: { musicalWork: eligibleWorkWhere, ...(onlyRole ? { role: onlyRole } : {}) }, select: { role: true, musicalWork: { select: { id: true, slug: true, title: true } } } },
    },
  });
  if (!person) return null;
  const parts = assemblePersonPageParts(person);
  const related = await resolveRelatedContent({ workIds: parts.workIds, performanceIds: parts.performanceIds });
  return { id: person.id, slug: person.slug, name: person.name, biography: person.biography, roles: parts.roles, contributions: parts.contributions, related };
}

export interface EnsemblePageData {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  related: RelatedContent;
}

export async function getEnsemblePageData(slug: string): Promise<EnsemblePageData | null> {
  if (!isPlausibleSlug(slug)) return null;
  const ensemble = await prisma.ensemble.findFirst({ where: { AND: [{ slug }, eligibleEnsembleWhere] }, include: { performances: { select: { performanceId: true } } } });
  if (!ensemble) return null;
  const related = await resolveRelatedContent({ performanceIds: ensemble.performances.map((p) => p.performanceId) });
  return { id: ensemble.id, slug: ensemble.slug, name: ensemble.name, description: ensemble.description, related };
}
