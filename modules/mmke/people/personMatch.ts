// R-36: which Person a name is. Pure; the repository (peopleRepository.ensurePerson) supplies the active persons and the approved PERSON aliases.
//
// One human has ONE person page across roles (composer, conductor, performer, lyricist, arranger, translator), so every role record is linked to
// a Person found by:
//   1. EXACT normalised name (the same rule as every create form: trimmed, case-insensitive, white space collapsed);
//   2. else the APPROVED ALIAS TABLE (EntityAlias, kind PERSON): a spelling an editor decided is another name of someone, then exact match on the
//      canonical name;
//   3. else a new Person, named with the canonical spelling when an alias gave one.
// Nothing is matched fuzzily: "Ebenezer ArunKumar" and "Ebenezer Arunkumar" are the same name; "Allen Samuel" is "Allan Samuel" only through an
// approved alias.

import { normalizeNameForComparison } from "../duplicate-detection/detectDuplicateName";

export interface PersonCandidate {
  id: string;
  name: string;
}

export interface PersonAlias {
  /** normalizeNameForComparison(alias spelling). */
  aliasKey: string;
  canonicalName: string;
}

export type PersonMatch<P extends PersonCandidate> = { kind: "exact" | "alias"; person: P } | { kind: "new"; name: string; viaAlias: boolean };

export function matchPerson<P extends PersonCandidate>(name: string, persons: readonly P[], aliases: readonly PersonAlias[]): PersonMatch<P> {
  const key = normalizeNameForComparison(name);
  const exact = persons.find((p) => normalizeNameForComparison(p.name) === key);
  if (exact) return { kind: "exact", person: exact };
  const alias = aliases.find((a) => a.aliasKey === key);
  if (alias) {
    const canonical = persons.find((p) => normalizeNameForComparison(p.name) === normalizeNameForComparison(alias.canonicalName));
    return canonical ? { kind: "alias", person: canonical } : { kind: "new", name: alias.canonicalName.trim(), viaAlias: true };
  }
  return { kind: "new", name: name.trim(), viaAlias: false };
}
