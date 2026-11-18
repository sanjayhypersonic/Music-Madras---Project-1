// Upload-to-draft pipeline (R-34), item 8: RECONCILE the records the staging content loader created (R-30) with the editor's decisions. Plan is
// pure; the executor uses only the existing repository functions (updateMusicalWork, changeMusicalWorkComposer, createComposer) and is run by
// scripts/reconcileStagingRecords.ts behind the staging guard, DRY RUN by default.
//
// The Dingiri Dingalae decision (owner, 2026-11-18): the Work's title of record is the Tamil டிங்கிரி டிங்காலே, with "Dingiri Dingalae" kept as an
// alternate title (an original-script title is never replaced, only added to: docs/content-editorial-standard.md section 5), and its composer is
// Vedha (the description's credit), not the loader's placeholder "Traditional". The slug does not change (slugs are immutable). The placeholder
// Composer "Traditional" is left in place (other works may use it); the report says whether it is now unused. A Work that any PUBLISHED revision
// shows is refused: changing it would change a live page without review.

import { normalizeNameForComparison } from "../mmke/duplicate-detection/detectDuplicateName";

export interface WorkReconciliation {
  workSlug: string;
  title: string;
  /** Alternate titles to ADD (existing ones are kept). */
  addAlternateTitles: string[];
  composerName: string;
}

export const DINGIRI_DINGALAE_RECONCILIATION: WorkReconciliation = {
  workSlug: "dingiri-dingalae",
  title: "டிங்கிரி டிங்காலே",
  addAlternateTitles: ["Dingiri Dingalae"],
  composerName: "Vedha",
};

export interface WorkState {
  id: string;
  slug: string;
  title: string;
  alternateTitles: string[];
  composerId: string;
  composerName: string;
  inPublishedContent: boolean;
}

export type ReconcileAction =
  | { kind: "REFUSE"; reason: string }
  | { kind: "SET_TITLE"; from: string; to: string }
  | { kind: "ADD_ALTERNATE_TITLES"; titles: string[] }
  | { kind: "SET_COMPOSER"; from: string; to: string; composer: "EXISTING" | "CREATE" }
  | { kind: "NOTHING_TO_DO" };

export function planWorkReconciliation(target: WorkReconciliation, state: WorkState | null, composers: ReadonlyArray<{ id: string; name: string }>): ReconcileAction[] {
  if (!state) return [{ kind: "REFUSE", reason: `no Work with slug "${target.workSlug}"` }];
  if (state.inPublishedContent) return [{ kind: "REFUSE", reason: `"${state.title}" is shown by a published Recording; change it through Studio's review instead` }];
  const actions: ReconcileAction[] = [];
  if (state.title !== target.title) actions.push({ kind: "SET_TITLE", from: state.title, to: target.title });
  const wanted = [...target.addAlternateTitles, ...(state.title !== target.title ? [state.title] : [])].filter((t) => normalizeNameForComparison(t) !== normalizeNameForComparison(target.title));
  const missing = [...new Set(wanted)].filter((t) => !state.alternateTitles.some((a) => normalizeNameForComparison(a) === normalizeNameForComparison(t)));
  if (missing.length) actions.push({ kind: "ADD_ALTERNATE_TITLES", titles: missing });
  if (normalizeNameForComparison(state.composerName) !== normalizeNameForComparison(target.composerName)) {
    const existing = composers.some((c) => normalizeNameForComparison(c.name) === normalizeNameForComparison(target.composerName));
    actions.push({ kind: "SET_COMPOSER", from: state.composerName, to: target.composerName, composer: existing ? "EXISTING" : "CREATE" });
  }
  return actions.length ? actions : [{ kind: "NOTHING_TO_DO" }];
}

export function describeReconcileAction(a: ReconcileAction): string {
  switch (a.kind) {
    case "REFUSE":
      return `REFUSED: ${a.reason}`;
    case "SET_TITLE":
      return `Work title "${a.from}" -> "${a.to}"`;
    case "ADD_ALTERNATE_TITLES":
      return `add alternate title(s): ${a.titles.map((t) => `"${t}"`).join(", ")}`;
    case "SET_COMPOSER":
      return `composer "${a.from}" -> "${a.to}" (${a.composer === "EXISTING" ? "existing Composer, exact normalised name" : "new Composer"})`;
    case "NOTHING_TO_DO":
      return "nothing to do (already reconciled)";
  }
}
