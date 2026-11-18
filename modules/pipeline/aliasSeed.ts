// Upload-to-draft pipeline (R-34): the APPROVED ALIAS TABLE, seeded from the editor's decisions in review-names.csv. Pure.
//
// A row of review-names.csv becomes standing decisions only when the editor decided it:
//   accept + canonicalName   every spelling seen (and the row's name) is an alias of the canonical name;
//   merge  + canonicalName   the same (several rows may merge into one canonical name, e.g. three spellings of one combined church choir);
//   accept, no canonicalName, one spelling   nothing to record (exact matching already finds it);
//   reject, or no decision   nothing.
// A spelling that two decisions map to different canonical names is refused (and listed), never guessed. "choir/ensemble" rows are recorded for
// both CHOIR and ENSEMBLE; a lyricist or arranger is a PERSON. Nothing here touches the database: scripts/seedEntityAliases.ts writes the result.

import { csvRecords } from "../jobs/videoCreditsApproved";
import { NAMES_HEADER } from "../jobs/videoCreditsReview";
import { nameKey, type AliasDecision, type EntityKind } from "./resolve";

const ROLE_KINDS: Readonly<Record<string, EntityKind[]>> = {
  work: ["WORK"],
  composer: ["COMPOSER", "PERSON"],
  lyricist: ["PERSON"],
  arranger: ["PERSON"],
  conductor: ["CONDUCTOR", "PERSON"],
  "choir/ensemble": ["CHOIR", "ENSEMBLE"],
  performer: ["ARTIST", "PERSON"],
  venue: ["VENUE"],
  institution: ["ORGANISATION"],
};

export interface AliasSeedRow extends AliasDecision {
  alias: string;
  source: string;
}

export interface AliasSeed {
  aliases: AliasSeedRow[];
  decidedRows: number;
  undecidedRows: number;
  conflicts: string[];
  problems: string[];
}

export function aliasesFromReviewNames(namesCsv: string): AliasSeed {
  const sheet = csvRecords(namesCsv, NAMES_HEADER, "review-names.csv");
  if (!sheet.ok) return { aliases: [], decidedRows: 0, undecidedRows: 0, conflicts: [], problems: [sheet.problem] };
  const byKey = new Map<string, AliasSeedRow>();
  const conflicts: string[] = [];
  let decided = 0;
  let undecided = 0;
  for (const r of sheet.rows) {
    const decision = (r.decision ?? "").trim().toLowerCase();
    const canonical = (r.canonicalName ?? "").trim();
    if (!decision) {
      undecided++;
      continue;
    }
    decided++;
    if (decision === "reject" || !canonical || (decision !== "accept" && decision !== "merge")) continue;
    const spellings = new Set([(r.name ?? "").trim(), ...(r.spellingsSeen ?? "").split(" | ").map((s) => s.trim())].filter(Boolean));
    for (const kind of ROLE_KINDS[(r.role ?? "").trim()] ?? []) {
      for (const alias of spellings) {
        if (nameKey(alias) === nameKey(canonical)) continue;
        const key = `${kind}\u0000${nameKey(alias)}`;
        const prior = byKey.get(key);
        if (prior && nameKey(prior.canonicalName) !== nameKey(canonical)) {
          conflicts.push(`${kind} "${alias}" is decided as both "${prior.canonicalName}" and "${canonical}"; neither is recorded.`);
          byKey.delete(key);
          continue;
        }
        byKey.set(key, { kind, alias, aliasKey: nameKey(alias), canonicalName: canonical, entityId: null, source: `review-names.csv (${decision})` });
      }
    }
  }
  const conflicted = new Set(conflicts.map((c) => c.split('"')[1]));
  return { aliases: [...byKey.values()].filter((a) => !conflicted.has(a.alias)), decidedRows: decided, undecidedRows: undecided, conflicts, problems: [] };
}
