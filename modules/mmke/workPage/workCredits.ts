// R-36: who made a musical work, in ONE pure place: its composers in stated order (co-composers), its lyricists, arrangers and translators,
// how they read on the public pages, how they appear in JSON-LD, and how a Studio editor reorders them. Pure; unit-tested with fake data.
//
//   composers     musical_work_composers rows by position; position 1 is MusicalWork.composerId (the primary composer), which is always listed
//                 first even if its row is missing (a work created before the backfill);
//   contributors  musical_work_contributors rows (LYRICIST, ARRANGER, TRANSLATOR), each a Person;
//   archived      an archived co-composer or contributor is left out of public lists (a public page never links to a page that would 404).

export interface CreditedEntity {
  id: string;
  slug: string;
  name: string;
}

type Archivable = { archivedAt?: Date | null };

export type ContributorRole = "LYRICIST" | "ARRANGER" | "TRANSLATOR";
export const CONTRIBUTOR_ROLES: readonly ContributorRole[] = ["LYRICIST", "ARRANGER", "TRANSLATOR"];
/** How a contributor line reads on a work page ("Words — Nicole Elsey"). */
export const CONTRIBUTOR_LABELS: Readonly<Record<ContributorRole, string>> = { LYRICIST: "Words", ARRANGER: "Arrangement", TRANSLATOR: "Translation" };
/** The public page a contributor links to: one person page per human; /arrangers and /lyricists are canonical to /people. */
export const personHref = (slug: string) => `/people/${slug}`;

/** The work's composers in stated order: the primary first, then co-composers by position; duplicates and archived co-composers dropped. */
export function orderWorkComposers(primary: CreditedEntity, credits: ReadonlyArray<{ position: number; composer: CreditedEntity & Archivable }>): CreditedEntity[] {
  const out: CreditedEntity[] = [{ id: primary.id, slug: primary.slug, name: primary.name }];
  for (const c of [...credits].sort((a, b) => a.position - b.position || a.composer.name.localeCompare(b.composer.name))) {
    if (c.composer.archivedAt || out.some((x) => x.id === c.composer.id)) continue;
    out.push({ id: c.composer.id, slug: c.composer.slug, name: c.composer.name });
  }
  return out;
}

export interface WorkContributor {
  role: ContributorRole;
  label: string;
  person: CreditedEntity;
}

/** The work's contributors, lyricists first, then arrangers, then translators, each by name; archived people dropped. */
export function orderContributors(rows: ReadonlyArray<{ role: ContributorRole; person: CreditedEntity & Archivable }>): WorkContributor[] {
  return rows
    .filter((r) => !r.person.archivedAt)
    .map((r) => ({ role: r.role, label: CONTRIBUTOR_LABELS[r.role], person: { id: r.person.id, slug: r.person.slug, name: r.person.name } }))
    .sort((a, b) => CONTRIBUTOR_ROLES.indexOf(a.role) - CONTRIBUTOR_ROLES.indexOf(b.role) || a.person.name.localeCompare(b.person.name));
}

/** "A", "A and B", "A, B and C". */
export const listNames = (names: readonly string[]): string => (names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);

/**
 * The work page's MusicComposition JSON-LD: `composer` is ALWAYS an array (one Person per composer, in order); lyricists are `lyricist`;
 * arrangers and translators are `contributor` (schema.org has no arranger property); the alternate titles are `alternateName` (an array,
 * only when there are any, in the stored order and spelling: original script and transliterations alike).
 */
export function workJsonLd(input: { title: string; url: string; composers: readonly CreditedEntity[]; contributors?: readonly WorkContributor[]; alternateTitles?: readonly string[] }): Record<string, unknown> {
  const person = (p: CreditedEntity) => ({ "@type": "Person", name: p.name });
  const lyricists = (input.contributors ?? []).filter((c) => c.role === "LYRICIST").map((c) => person(c.person));
  const others = (input.contributors ?? []).filter((c) => c.role !== "LYRICIST").map((c) => person(c.person));
  return {
    "@context": "https://schema.org",
    "@type": "MusicComposition",
    name: input.title,
    ...((input.alternateTitles ?? []).length ? { alternateName: [...input.alternateTitles!] } : {}),
    url: input.url,
    composer: input.composers.map(person),
    ...(lyricists.length ? { lyricist: lyricists } : {}),
    ...(others.length ? { contributor: others } : {}),
  };
}

export interface ComposerWorkRow {
  id: string;
  slug: string;
  title: string;
  composerId: string;
  composerCredits: ReadonlyArray<{ composerId: string; position: number }>;
}

/** A composer's works for their page: every work they composed OR co-composed, once each, by title; `coComposed` when they are not position 1. */
export function composerWorks(composerId: string, works: readonly ComposerWorkRow[]): Array<{ id: string; slug: string; title: string; coComposed: boolean }> {
  const seen = new Set<string>();
  return works
    .filter((w) => w.composerId === composerId || w.composerCredits.some((c) => c.composerId === composerId))
    .filter((w) => (seen.has(w.id) ? false : (seen.add(w.id), true)))
    .map((w) => ({ id: w.id, slug: w.slug, title: w.title, coComposed: w.composerId !== composerId }))
    .sort((a, b) => a.title.localeCompare(b.title));
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Studio: add, remove and reorder a work's composers

export type ComposerOrderChange = { kind: "add"; composerId: string } | { kind: "remove"; composerId: string } | { kind: "up"; composerId: string } | { kind: "down"; composerId: string };

/** The new composer order after one Studio change. A work always keeps at least one composer; the first is the primary composer. */
export function changeComposerOrder(current: readonly string[], change: ComposerOrderChange): { ok: true; order: string[] } | { ok: false; reason: string } {
  const order = [...new Set(current)];
  const i = order.indexOf(change.composerId);
  switch (change.kind) {
    case "add":
      if (!change.composerId) return { ok: false, reason: "Choose a composer to add." };
      if (i >= 0) return { ok: false, reason: "That composer is already credited on this work." };
      return { ok: true, order: [...order, change.composerId] };
    case "remove":
      if (i < 0) return { ok: false, reason: "That composer is not credited on this work." };
      if (order.length === 1) return { ok: false, reason: "A work needs at least one composer: add another before removing this one." };
      return { ok: true, order: order.filter((id) => id !== change.composerId) };
    case "up":
    case "down": {
      const j = change.kind === "up" ? i - 1 : i + 1;
      if (i < 0) return { ok: false, reason: "That composer is not credited on this work." };
      if (j < 0 || j >= order.length) return { ok: true, order };
      [order[i], order[j]] = [order[j], order[i]];
      return { ok: true, order };
    }
  }
}
