// R-36: the public person page (/people, /arrangers, /lyricists) assembled from one person's role records. Pure; the repository
// (personPageRepository.getPersonPageData) loads only ELIGIBLE records (publicEligibility.ts) and passes them here.
//
// One page per human: every role record linked to the person (Composer, Conductor, Artist through personId) is listed once with its own page,
// every work they composed, co-composed, arranged, wrote words for or translated feeds the related recordings, and every performance they
// conducted or performed in does too.

import type { ContributorRole } from "../workPage/workCredits";

export interface RawPersonRoles {
  composers: ReadonlyArray<{ slug: string; name: string; works: ReadonlyArray<{ id: string }>; workCredits: ReadonlyArray<{ work: { id: string } }> }>;
  conductors: ReadonlyArray<{ slug: string; name: string; performances: ReadonlyArray<{ performanceId: string }> }>;
  artists: ReadonlyArray<{ slug: string; name: string; performances: ReadonlyArray<{ performanceId: string }> }>;
  workContributions: ReadonlyArray<{ role: ContributorRole; musicalWork: { id: string; slug: string; title: string } }>;
}

export interface PersonPageParts {
  roles: Array<{ role: "Composer" | "Conductor" | "Performer"; name: string; href: string }>;
  contributions: Array<{ role: ContributorRole; workTitle: string; workHref: string }>;
  workIds: string[];
  performanceIds: string[];
}

const ROLE_ORDER: readonly ContributorRole[] = ["LYRICIST", "ARRANGER", "TRANSLATOR"];

export function assemblePersonPageParts(raw: RawPersonRoles): PersonPageParts {
  const uniq = (xs: string[]) => [...new Set(xs)];
  const seenRole = new Set<string>();
  const roles: PersonPageParts["roles"] = [];
  const addRole = (role: PersonPageParts["roles"][number]["role"], name: string, href: string) => {
    if (seenRole.has(href)) return;
    seenRole.add(href);
    roles.push({ role, name, href });
  };
  for (const c of raw.composers) addRole("Composer", c.name, `/composers/${c.slug}`);
  for (const c of raw.conductors) addRole("Conductor", c.name, `/conductors/${c.slug}`);
  for (const a of raw.artists) addRole("Performer", a.name, `/artists/${a.slug}`);
  const seenContribution = new Set<string>();
  const contributions = raw.workContributions
    .filter((c) => {
      const k = `${c.role}\u0000${c.musicalWork.id}`;
      return seenContribution.has(k) ? false : (seenContribution.add(k), true);
    })
    .map((c) => ({ role: c.role, workTitle: c.musicalWork.title, workHref: `/works/${c.musicalWork.slug}` }))
    .sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || a.workTitle.localeCompare(b.workTitle));
  return {
    roles,
    contributions,
    workIds: uniq([...raw.composers.flatMap((c) => [...c.works.map((w) => w.id), ...c.workCredits.map((w) => w.work.id)]), ...raw.workContributions.map((c) => c.musicalWork.id)]),
    performanceIds: uniq([...raw.conductors.flatMap((c) => c.performances.map((p) => p.performanceId)), ...raw.artists.flatMap((a) => a.performances.map((p) => p.performanceId))]),
  };
}
