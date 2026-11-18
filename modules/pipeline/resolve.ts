// Upload-to-draft pipeline (R-34), stage 3: ENTITY RESOLUTION. Pure.
//
// Every credit the validators accepted is matched to the catalogue by EXACT NORMALISED NAME (the same rule as every create form and the credits
// tool: modules/mmke/duplicate-detection/detectDuplicateName.ts), after applying the APPROVED ALIAS TABLE (EntityAlias: a spelling an editor has
// already decided is another name of one entity). Nothing is matched fuzzily:
//   MAPPED     exactly one existing record: the video will only be LINKED to it (its public page then lists the recording);
//   NEW        no record: it will be created on approval, and researched first;
//   EXCEPTION  more than one record with that name, a near-miss (same letters apart from case, punctuation, a leading "The" or a parenthetical
//              alias, but not an exact match), or a work with no composer credit. Exceptions are listed for the owner, never guessed.
// A work is matched within its composer (two composers may both have a "Magnificat"), by its title or one of its alternate titles.

import { normalizeNameForComparison } from "../mmke/duplicate-detection/detectDuplicateName";
import type { CheckedVideoCredits, VideoCredit } from "../ai/structuredOutput/validateVideoCreditsOutput";
import type { VideoCreditRole } from "../ai/prompts/videoCredits/videoCreditsPromptV1";
import { looseNameKey } from "../jobs/videoCreditsApproved";

export const ENTITY_KINDS = ["COMPOSER", "WORK", "CONDUCTOR", "CHOIR", "ARTIST", "VENUE", "ENSEMBLE", "PERSON", "ORGANISATION"] as const;
export type EntityKind = (typeof ENTITY_KINDS)[number];

/** Which catalogue entity each credit role is. Arrangers and lyricists are people (Person + MusicalWorkContributor). */
export const ROLE_ENTITY: Readonly<Record<VideoCreditRole, EntityKind>> = {
  COMPOSER: "COMPOSER",
  WORK: "WORK",
  PERFORMER: "ARTIST",
  ENSEMBLE: "ENSEMBLE",
  CHOIR: "CHOIR",
  CONDUCTOR: "CONDUCTOR",
  VENUE: "VENUE",
  ARRANGER: "PERSON",
  LYRICIST: "PERSON",
};

export interface CatalogueRecord {
  id: string;
  name: string;
  /** Works only: the composer's name and the work's alternate titles. */
  composerName?: string;
  alternateTitles?: string[];
}

export type CatalogueIndex = Readonly<Partial<Record<EntityKind, readonly CatalogueRecord[]>>>;

export interface AliasDecision {
  kind: EntityKind;
  /** normalizeNameForComparison(alias). */
  aliasKey: string;
  canonicalName: string;
  entityId: string | null;
}

export type ResolutionStatus = "MAPPED" | "NEW" | "EXCEPTION";

export interface ResolvedEntity {
  /** Stable within a video: kind + normalised canonical name (+ work for credits that belong to a work). */
  key: string;
  role: VideoCreditRole;
  kind: EntityKind;
  nameInVideo: string;
  canonicalName: string;
  aliasApplied: boolean;
  status: ResolutionStatus;
  entityId: string | null;
  workTitle: string | null;
  reason: string | null;
  quote: string;
  field: string;
}

export interface Resolution {
  entities: ResolvedEntity[];
  exceptions: string[];
}

export const nameKey = (name: string) => normalizeNameForComparison(name);

export function buildAliasMap(aliases: readonly AliasDecision[]): Map<string, AliasDecision> {
  return new Map(aliases.map((a) => [`${a.kind}\u0000${a.aliasKey}`, a]));
}

function matchRecords(kind: EntityKind, name: string, catalogue: CatalogueIndex, preferId: string | null): { exact: CatalogueRecord[]; nearMiss: CatalogueRecord[] } {
  const records = catalogue[kind] ?? [];
  if (preferId) {
    const byId = records.filter((r) => r.id === preferId);
    if (byId.length === 1) return { exact: byId, nearMiss: [] };
  }
  const key = nameKey(name);
  const exact = records.filter((r) => nameKey(r.name) === key);
  const loose = looseNameKey(name);
  const nearMiss = exact.length > 0 ? [] : records.filter((r) => looseNameKey(r.name) === loose);
  return { exact, nearMiss };
}

export function resolveEntities(checked: CheckedVideoCredits, catalogue: CatalogueIndex, aliases: readonly AliasDecision[]): Resolution {
  const aliasMap = buildAliasMap(aliases);
  const entities: ResolvedEntity[] = [];
  const exceptions: string[] = [];
  const seen = new Set<string>();
  const works = checked.accepted.filter((c) => c.role === "WORK");

  const canonical = (kind: EntityKind, name: string) => {
    const alias = aliasMap.get(`${kind}\u0000${nameKey(name)}`);
    return { name: alias?.canonicalName ?? name, aliasApplied: !!alias && nameKey(alias.canonicalName) !== nameKey(name), entityId: alias?.entityId ?? null };
  };

  const push = (c: VideoCredit, e: Omit<ResolvedEntity, "role" | "nameInVideo" | "quote" | "field">) => {
    if (seen.has(e.key)) return;
    seen.add(e.key);
    entities.push({ ...e, role: c.role, nameInVideo: c.name, quote: c.quote, field: c.field });
    if (e.status === "EXCEPTION") exceptions.push(`${c.role} "${c.name}": ${e.reason}`);
  };

  // Everything except works first, so a work can be matched within its resolved composer.
  for (const c of checked.accepted.filter((x) => x.role !== "WORK")) {
    const kind = ROLE_ENTITY[c.role];
    const canon = canonical(kind, c.name);
    const { exact, nearMiss } = matchRecords(kind, canon.name, catalogue, canon.entityId);
    const key = `${kind}\u0000${nameKey(canon.name)}${c.role === "ARRANGER" || c.role === "LYRICIST" ? `\u0000${c.role}\u0000${nameKey(c.workTitle ?? "")}` : ""}`;
    const base = { key, kind, canonicalName: canon.name, aliasApplied: canon.aliasApplied, workTitle: c.workTitle };
    if (exact.length === 1) push(c, { ...base, status: "MAPPED", entityId: exact[0].id, reason: null });
    else if (exact.length > 1) push(c, { ...base, status: "EXCEPTION", entityId: null, reason: `${exact.length} existing ${kind.toLowerCase()} records are named "${canon.name}"; choose one (or merge them) before linking.` });
    else if (nearMiss.length > 0) push(c, { ...base, status: "EXCEPTION", entityId: null, reason: `not an exact match, but close to ${nearMiss.map((r) => `"${r.name}"`).join(", ")}; add an approved alias to link it, or confirm it is new.` });
    else push(c, { ...base, status: "NEW", entityId: null, reason: null });
  }

  for (const w of works) {
    const composerCredits = checked.accepted.filter((c) => c.role === "COMPOSER" && (c.workTitle ? nameKey(c.workTitle) === nameKey(w.name) : works.length === 1));
    const composers = composerCredits.map((c) => entities.find((e) => e.kind === "COMPOSER" && nameKey(e.nameInVideo) === nameKey(c.name))).filter((e): e is ResolvedEntity => !!e);
    const canon = canonical("WORK", w.name);
    const key = `WORK\u0000${nameKey(canon.name)}`;
    const base = { key, kind: "WORK" as const, canonicalName: canon.name, aliasApplied: canon.aliasApplied, workTitle: null };
    if (composers.length !== 1) {
      push(w, { ...base, status: "EXCEPTION", entityId: null, reason: composers.length === 0 ? "no composer credit for this work (a composer is never invented); it cannot be catalogued yet." : "several composers are credited; the catalogue holds one per work." });
      continue;
    }
    const composer = composers[0];
    if (composer.status !== "MAPPED") {
      push(w, { ...base, status: composer.status === "NEW" ? "NEW" : "EXCEPTION", entityId: null, reason: composer.status === "NEW" ? null : "its composer is unresolved." });
      continue;
    }
    const ofComposer = (catalogue.WORK ?? []).filter((r) => r.composerName !== undefined && nameKey(r.composerName) === nameKey(composer.canonicalName));
    const key2 = nameKey(canon.name);
    const exact = canon.entityId ? ofComposer.filter((r) => r.id === canon.entityId) : ofComposer.filter((r) => nameKey(r.name) === key2 || (r.alternateTitles ?? []).some((t) => nameKey(t) === key2));
    if (exact.length === 1) push(w, { ...base, status: "MAPPED", entityId: exact[0].id, reason: null });
    else if (exact.length > 1) push(w, { ...base, status: "EXCEPTION", entityId: null, reason: `${exact.length} works by ${composer.canonicalName} have this title.` });
    else {
      const near = ofComposer.filter((r) => looseNameKey(r.name) === looseNameKey(canon.name));
      push(w, near.length > 0 ? { ...base, status: "EXCEPTION", entityId: null, reason: `close to ${near.map((r) => `"${r.name}"`).join(", ")} by ${composer.canonicalName}; add an alias or confirm it is new.` } : { ...base, status: "NEW", entityId: null, reason: null });
    }
  }

  return { entities, exceptions };
}
